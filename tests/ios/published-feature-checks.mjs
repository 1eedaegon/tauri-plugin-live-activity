// Run against an installed Tauri app with the published JS API passed as `api`.
// Native results are observed; visibility is deliberately not inferred from acceptance.
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const codeOf = error => error && typeof error === 'object' ? error.code : undefined;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function expectCode(code, operation) {
  try { await operation(); }
  catch (error) {
    assert(codeOf(error) === code, `Expected ${code}; received ${codeOf(error) ?? String(error)}`);
    return;
  }
  throw new Error(`Expected ${code}; native call succeeded`);
}

async function waitForState(api, id, state, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const record = (await api.list()).find(candidate => candidate.id === id);
    if (record?.state === state) return record;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error(`Activity did not report ${state} within ${timeoutMs} ms`);
}

export async function runIOSFeatureChecks(api, suffix = String(Date.now()), observeStale = false) {
  let report = { suite: observeStale ? 'ios-stale-observation' : 'ios-features', status: 'failed', platform: 'ios', checks: [], visibility: 'unknown' };
  let created = [];
  const check = async (name, operation) => {
    await operation();
    report = { ...report, checks: [...report.checks, { name, passed: true }] };
  };
  const progress = key => ({ activityKey: `ios:${suffix}:${key}`, schemaVersion: 1, template: 'progress', fallback: 'none',
    snapshot: { revision: 0, title: 'Mochi snack', status: 'Ready to enjoy', progress: 1 } });
  try {
    await check('iOS separates Live Activities from ordinary notification permission', async () => {
      const permissions = await api.checkPermissions();
      assert(permissions.liveActivities === 'granted', 'Enable Live Activities before testing');
      assert(permissions.notifications === 'notApplicable' && permissions.promotion === 'notApplicable', 'Unexpected iOS permission mapping');
    });
    await check('unsupported permission requests return stable errors', async () => {
      await expectCode('UNSUPPORTED_FEATURE', () => api.requestPermissions('notifications'));
      await expectCode('UNSUPPORTED_FEATURE', () => api.requestPermissions('promotion'));
    });
    const now = Date.now();
    const input = { activityKey: `ios:${suffix}:nap`, schemaVersion: 1, template: 'timer', fallback: 'none',
      snapshot: { revision: 0, title: 'Mochi nap', status: 'Soft dreams', timer: { startedAt: now, endsAt: now + 60000 }, staleAt: now + (observeStale ? 2000 : 60000) } };
    let timer;
    await check('timer start preserves epoch millisecond bounds', async () => {
      timer = await api.start(input); created = [...created, timer.id];
      assert(timer.snapshot.timer.startedAt === now && timer.snapshot.timer.endsAt === now + 60000 && timer.snapshot.staleAt === input.snapshot.staleAt, 'Timer serialization changed the bounds or stale date');
    });
    await check('timer duplicate start preserves its generation', async () => {
      assert((await api.start(input)).id === timer.id, 'Duplicate timer has another handle');
    });
    await check('existing timer cannot switch to progress', () => expectCode('INVALID_INPUT', () => api.update({ id: timer.id,
      snapshot: { revision: 1, title: 'Mochi nap', status: 'Still resting', progress: 0.5 } })));
    if (observeStale) await check('staleAt produces an observed ActivityKit stale state', () => waitForState(api, timer.id, 'stale'));
    await check('updating timer advances its revision and returns active', async () => {
      const snapshot = { ...input.snapshot, revision: 1, staleAt: Date.now() + 60000 };
      assert((await api.update({ id: timer.id, snapshot })).snapshot.revision === 1, 'Timer update lost revision');
      await waitForState(api, timer.id, 'active');
    });
    await check('timer ends immediately', async () => {
      assert((await api.end({ id: timer.id, policy: { kind: 'immediate' } })).state === 'ended', 'Timer did not end');
    });
    const after = await api.start(progress('after')); created = [...created, after.id];
    await check('after dismissal rejects timestamps beyond four hours', () => expectCode('INVALID_INPUT', () => api.end({ id: after.id,
      policy: { kind: 'after', at: Date.now() + 14460000 } })));
    const policy = { kind: 'after', at: Date.now() + 1000 };
    await check('after dismissal is accepted and remains idempotent after its date', async () => {
      assert((await api.end({ id: after.id, policy })).state === 'ended', 'After end did not end');
      await delay(1500);
      assert((await api.end({ id: after.id, policy })).state === 'ended', 'Expired known end lost idempotence');
    });
    const normal = await api.start(progress('default')); created = [...created, normal.id];
    await check('default dismissal reports ended without claiming visibility', async () => {
      const result = await api.end({ id: normal.id, policy: { kind: 'default' } });
      assert(result.state === 'ended' && result.visibility === 'unknown', 'Default policy result was incorrect');
    });
    report = { ...report, status: 'passed' };
  } catch (error) {
    report = { ...report, error: String(error?.message ?? error) };
  } finally {
    for (const id of created) {
      try { await api.end({ id, policy: { kind: 'immediate' } }); }
      catch (error) { report = { ...report, cleanupError: String(error?.message ?? error) }; }
    }
  }
  return report;
}

// Kept separate because iOS 27.2 simulator did not produce a stale OS state,
// including after backgrounding. Its failed result remains release evidence.
export const runIOSStaleObservation = (api, suffix) => runIOSFeatureChecks(api, suffix, true);

export async function runUnicodeRevisionRegression(api, suffix = String(Date.now())) {
  let activity;
  const report = { suite: 'ios-unicode-revision', platform: 'ios', visibility: 'unknown' };
  try {
    activity = await api.start({ activityKey: `ios:${suffix}:unicode`, schemaVersion: 1, template: 'progress', fallback: 'none',
      snapshot: { revision: 0, title: 'Caf\u00e9 for Mochi', status: 'Ready', progress: 0.5 } });
    await expectCode('CONFLICT', () => api.update({ id: activity.id,
      snapshot: { revision: 0, title: 'Cafe\u0301 for Mochi', status: 'Ready', progress: 0.5 } }));
    return { ...report, status: 'passed', checks: [{ name: 'different encoded Unicode text conflicts at the same revision', passed: true }] };
  } catch (error) {
    return { ...report, status: 'failed', error: String(error?.message ?? error) };
  } finally {
    if (activity) await api.end({ id: activity.id, policy: { kind: 'immediate' } });
  }
}
