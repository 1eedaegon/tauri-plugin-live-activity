import type * as PublicAPI from '../../../guest-js/index.js';

type API = typeof PublicAPI;
type Record = PublicAPI.ActivityRecord;
type Check = (name: string, task: () => Promise<void>) => Promise<void>;

export interface SelfTestReport {
  readonly status: 'passed' | 'failed' | 'unsupported';
  readonly platform: string;
  readonly checks: readonly { readonly name: string; readonly passed: boolean }[];
  readonly visibility: 'unknown';
  readonly error?: string;
  readonly cleanupError?: string;
}

export function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const message = 'message' in error ? String(error.message) : 'Operation failed';
    return `${String(error.code)}: ${message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function ensure(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function rejectsCode(operation: Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await operation;
  } catch (error) {
    ensure(typeof error === 'object' && error !== null && 'code' in error
      && error.code === expectedCode, `Expected ${expectedCode}; received ${describeError(error)}`);
    return;
  }
  throw new Error(`Expected ${expectedCode}; operation unexpectedly succeeded`);
}

function request(runId: string): PublicAPI.StartInput {
  return {
    activityKey: `integration:${runId}`, schemaVersion: 1, template: 'progress', fallback: 'notification',
    snapshot: { revision: 0, title: 'Integration test', status: 'Starting', progress: 0.1 },
  };
}

async function checkActive(api: API, initial: Record, input: PublicAPI.StartInput, check: Check): Promise<Record> {
  const changed = { revision: 1, title: 'Integration test', status: 'Updated', progress: 0.5 };
  await check('duplicate start keeps its handle', async () => {
    ensure((await api.start(input)).id === initial.id, 'Duplicate start created another generation');
  });
  const updated = await api.update({ id: initial.id, snapshot: changed });
  await check('newer revision replaces the full snapshot', async () => {
    ensure(updated.snapshot.revision === 1 && 'progress' in updated.snapshot
      && updated.snapshot.progress === 0.5, 'Updated snapshot did not match the request');
  });
  await check('identical update is idempotent', async () => {
    ensure((await api.update({ id: initial.id, snapshot: changed })).id === initial.id, 'Update changed the handle');
  });
  await check('stale revision is rejected', () => rejectsCode(api.update({ id: initial.id, snapshot: input.snapshot }), 'STALE_REVISION'));
  await check('conflicting revision is rejected', () => rejectsCode(api.update({ id: initial.id, snapshot: { ...changed, progress: 0.9 } }), 'CONFLICT'));
  await check('list reconciles the current generation', async () => {
    const observed = (await api.list()).find(item => item.id === initial.id);
    ensure(observed?.snapshot.revision === 1, 'List did not return the updated generation');
  });
  return updated;
}

async function checkEnded(api: API, current: Record, check: Check): Promise<void> {
  const input = { id: current.id, policy: { kind: 'immediate' as const } };
  await check('immediate end ends the generation', async () => {
    ensure((await api.end(input)).state === 'ended', 'End did not report ended');
  });
  await check('repeated end is idempotent', async () => {
    ensure((await api.end(input)).state === 'ended', 'Repeated end did not report ended');
  });
  await check('late update cannot revive an ended handle', () => rejectsCode(
    api.update({ id: current.id, snapshot: { ...current.snapshot, revision: 2 } }), 'NOT_FOUND',
  ));
}

function checkPermission(platform: string, permissions: PublicAPI.Permissions): void {
  const permission = platform === 'ios' ? permissions.liveActivities : permissions.notifications;
  ensure(permission === 'granted', `Grant the ${platform} activity/notification permission before running the test (${permission})`);
}

/** Tests real public API calls when invoked inside the Tauri app; never substitutes a backend. */
export async function runLifecycleChecks(api: API, runId: string): Promise<SelfTestReport> {
  let report: SelfTestReport = { status: 'failed', platform: 'unknown', checks: [], visibility: 'unknown' };
  let liveId: string | undefined;
  const check: Check = async (name, task) => {
    await task();
    report = { ...report, checks: [...report.checks, { name, passed: true }] };
  };
  try {
    const capabilities = await api.getCapabilities();
    report = { ...report, platform: capabilities.platform };
    if (capabilities.start !== 'supported') return { ...report, status: 'unsupported' };
    checkPermission(capabilities.platform, await api.checkPermissions());
    const input = request(runId);
    const initial = await api.start(input);
    liveId = initial.id;
    await check('start returns an opaque nonterminal handle', async () => {
      ensure(initial.id.length > 0 && ['active', 'stale', 'unknown'].includes(initial.state),
        'Start did not return an accepted nonterminal handle');
    });
    const updated = await checkActive(api, initial, input, check);
    await checkEnded(api, updated, check);
    liveId = undefined;
    const next = await api.start(input);
    liveId = next.id;
    await check('a new start receives a new generation', async () => {
      ensure(next.id !== initial.id, 'A new generation reused an ended handle');
    });
    await check('old handles cannot modify the new generation', () => rejectsCode(
      api.update({ id: initial.id, snapshot: { ...input.snapshot, revision: 2 } }), 'NOT_FOUND',
    ));
    await check('the final generation is cleaned up', async () => {
      ensure((await api.end({ id: next.id, policy: { kind: 'immediate' } })).state === 'ended', 'Cleanup failed');
    });
    liveId = undefined;
    report = { ...report, status: 'passed' };
  } catch (error) {
    report = { ...report, error: describeError(error) };
  }
  if (liveId !== undefined) {
    try { await api.end({ id: liveId, policy: { kind: 'immediate' } }); }
    catch (error) { report = { ...report, cleanupError: describeError(error) }; }
  }
  return report;
}
