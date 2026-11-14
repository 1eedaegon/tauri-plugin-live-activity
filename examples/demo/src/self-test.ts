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

function layoutRequest(runId: string): PublicAPI.LayoutStartInput {
  return {
    activityKey: `integration-layout:${runId}`, schemaVersion: 2, fallback: 'notification',
    layout: { lockScreen: { type: 'text', bind: 'status' } },
    snapshot: { revision: 0, values: { status: 'Starting' } },
  };
}

/** How long an iOS layout stays on screen after its `after` end: briefly, so that it leaves the Lock Screen at once. */
const AFTER_END_MS = 1000;

/**
 * The layout API: a start, an update that jumps revisions, a stale one, an end with final content at its revision, a
 * repeated end and a late update. iOS ends `after` a time; Android, which answers `after` with UNSUPPORTED_FEATURE,
 * with the default policy. `live` learns the id that the cleanup must end while it is running.
 */
async function checkLayout(api: API, runId: string, platform: string, check: Check, live: (id?: string) => void): Promise<void> {
  const started = await api.startLayout(layoutRequest(runId));
  live(started.id);
  const { id } = started;
  await check('a layout starts at the revision of its request', async () => {
    ensure(started.snapshot.revision === 0 && started.snapshot.values.status === 'Starting', 'The layout record did not match the start');
  });
  const jumped = await api.updateLayout({ id, snapshot: { revision: 5, values: { status: 'Jumped' } } });
  await check('a layout update may jump revisions', async () => {
    ensure(jumped.snapshot.revision === 5 && jumped.snapshot.values.status === 'Jumped', 'The update did not keep its revision');
  });
  await check('a layout revision below the accepted one is rejected', () => rejectsCode(
    api.updateLayout({ id, snapshot: { revision: 3, values: { status: 'Old' } } }), 'STALE_REVISION',
  ));
  const policy: PublicAPI.EndPolicy = platform === 'ios' ? { kind: 'after', at: Date.now() + AFTER_END_MS } : { kind: 'default' };
  const ended = await api.endLayout({ id, policy, snapshot: { revision: 6, values: { status: 'Done' } } });
  live(undefined);
  await check('a layout ends with its final content at its revision', async () => {
    ensure(ended.state === 'ended' && ended.snapshot.revision === 6 && ended.snapshot.values.status === 'Done',
      'The end did not report its final content');
  });
  await check('a repeated layout end answers the record', async () => {
    ensure((await api.endLayout({ id, policy: { kind: 'immediate' } })).state === 'ended', 'A repeated end did not report ended');
  });
  await check('a late layout update cannot revive the ended activity', () => rejectsCode(
    api.updateLayout({ id, snapshot: { revision: 7, values: { status: 'Late' } } }), 'NOT_FOUND',
  ));
}

/** A layout with a switch, a link and one line for fresh and one for stale content. */
function interactionRequest(runId: string): PublicAPI.LayoutStartInput {
  return {
    activityKey: `integration-nodes:${runId}`, schemaVersion: 2, fallback: 'notification',
    layout: {
      lockScreen: {
        type: 'vstack', children: [
          { type: 'text', bind: 'status', ifStale: false },
          { type: 'text', value: 'Out of date', ifStale: true },
          { type: 'toggle', actionId: 'mute', bind: 'muted', child: { type: 'text', value: 'Mute' } },
          { type: 'link', url: 'mochi://integration', child: { type: 'text', value: 'Open' } },
        ],
      },
    },
    snapshot: { revision: 0, values: { status: 'Starting', muted: false } },
  };
}

/**
 * The nodes a person acts on and the ones that follow staleness, through the real plugin: iOS draws all of them,
 * and Android, whose notification is drawn once, names `layout.ifStale`. An update sets the switch's flag.
 */
async function checkInteraction(api: API, runId: string, platform: string, check: Check, live: (id?: string) => void): Promise<void> {
  const started = await api.startLayout(interactionRequest(runId));
  live(started.id);
  await check('a layout with a switch, a link and nodes that follow staleness starts', async () => {
    const leftOut = started.degradedFeatures;
    ensure(platform === 'ios' ? leftOut.length === 0 : leftOut.includes('layout.ifStale'),
      `The start left out ${JSON.stringify(leftOut)}`);
  });
  await check('an update sets the flag that a switch shows', async () => {
    const updated = await api.updateLayout({ id: started.id, snapshot: { revision: 1, values: { status: 'Muted', muted: true } } });
    ensure(updated.snapshot.values.muted === true, 'The update did not set the flag');
  });
  await check('the layout with a switch and a link ends', async () => {
    ensure((await api.endLayout({ id: started.id, policy: { kind: 'immediate' } })).state === 'ended', 'The end did not report ended');
  });
  live(undefined);
}

/** How far ahead the scheduled start of the test is: it ends long before it would begin. */
const SCHEDULED_AHEAD_MS = 600_000;

/**
 * A start at a later time, through the real plugin. Where the system begins an activity by itself (iOS 26) it is
 * pending until then: it holds its key, takes no update, is listed and can be ended. Android, and an older iOS, start
 * an activity only when they are asked to, and refuse.
 */
async function checkScheduled(api: API, runId: string, check: Check, live: (id?: string) => void): Promise<void> {
  const at = Date.now() + SCHEDULED_AHEAD_MS;
  const request: PublicAPI.LayoutStartInput = {
    ...layoutRequest(runId), activityKey: `integration-later:${runId}`,
    scheduled: { at, alert: { title: 'Integration test', body: 'A scheduled start began.' } },
  };
  let pending: PublicAPI.LayoutActivityRecord;
  try {
    pending = await api.startLayout(request);
  } catch (error) {
    await check('a scheduled start is refused where the system starts nothing later', () => rejectsCode(Promise.reject(error), 'UNSUPPORTED_FEATURE'));
    return;
  }
  live(pending.id);
  const { id } = pending;
  await check('a scheduled start is pending until its time', async () => {
    ensure(pending.state === 'pending', `The scheduled start is ${pending.state}`);
  });
  await check('a pending activity holds its key, whatever the time of the same start', async () => {
    const again = await api.startLayout({ ...request, scheduled: { ...request.scheduled!, at: at + 60_000 } });
    ensure(again.id === id && again.state === 'pending', 'The same start made another activity');
  });
  await check('a pending activity takes no update', () => rejectsCode(
    api.updateLayout({ id, snapshot: { revision: 1, values: { status: 'Early' } } }), 'CONFLICT',
  ));
  await check('a pending activity is listed as pending', async () => {
    ensure((await api.listLayout()).find(item => item.id === id)?.state === 'pending', 'The list did not say pending');
  });
  await check('a pending activity can be ended', async () => {
    ensure((await api.endLayout({ id, policy: { kind: 'immediate' } })).state === 'ended', 'The end did not report ended');
  });
  live(undefined);
}

function checkPermission(platform: string, permissions: PublicAPI.Permissions): void {
  const permission = platform === 'ios' ? permissions.liveActivities : permissions.notifications;
  ensure(permission === 'granted', `Grant the ${platform} activity/notification permission before running the test (${permission})`);
}

/**
 * A start that asks for a push token, through the real plugin: where there are pushes the demo lacks the Push
 * Notifications capability, so ActivityKit refuses it, and the plugin holds no token; where there are none, the
 * push is ignored and the start is a plain one.
 */
async function checkPush(api: API, runId: string, push: PublicAPI.FeatureSupport, check: Check, live: (id?: string) => void): Promise<void> {
  const request: PublicAPI.LayoutStartInput = { ...layoutRequest(`${runId}-push`), activityKey: `integration-push:${runId}`, push: 'token' };
  if (push === 'supported') {
    await check('a start that asks for a push token needs the Push Notifications capability', () => rejectsCode(
      api.startLayout(request), 'CONFIGURATION_REQUIRED',
    ));
    await check('the plugin holds no push token', async () => {
      const held = await api.pushTokens();
      ensure(held.activities.length === 0 && held.pushToStart === undefined, 'A token was held without pushes');
    });
    return;
  }
  const started = await api.startLayout(request);
  live(started.id);
  await check('a start that asks for a push token is a plain start where there are no pushes', async () => {
    ensure(started.snapshot.revision === 0 && started.snapshot.values.status === 'Starting', 'The start with a push did not match');
    ensure((await api.pushTokens()).activities.length === 0, 'A token was held where there are no pushes');
  });
  await api.endLayout({ id: started.id, policy: { kind: 'immediate' } });
  live(undefined);
}

/** Tests real public API calls when invoked inside the Tauri app; never substitutes a backend. */
export async function runLifecycleChecks(api: API, runId: string): Promise<SelfTestReport> {
  let report: SelfTestReport = { status: 'failed', platform: 'unknown', checks: [], visibility: 'unknown' };
  let liveId: string | undefined;
  let liveLayout: string | undefined;
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
    await checkLayout(api, runId, capabilities.platform, check, id => { liveLayout = id; });
    await checkPush(api, runId, capabilities.push, check, id => { liveLayout = id; });
    await checkInteraction(api, runId, capabilities.platform, check, id => { liveLayout = id; });
    await checkScheduled(api, runId, check, id => { liveLayout = id; });
    report = { ...report, status: 'passed' };
  } catch (error) {
    report = { ...report, error: describeError(error) };
  }
  if (liveId !== undefined) {
    try { await api.end({ id: liveId, policy: { kind: 'immediate' } }); }
    catch (error) { report = { ...report, cleanupError: describeError(error) }; }
  }
  if (liveLayout !== undefined) {
    try { await api.endLayout({ id: liveLayout, policy: { kind: 'immediate' } }); }
    catch (error) { report = { ...report, cleanupError: describeError(error) }; }
  }
  return report;
}
