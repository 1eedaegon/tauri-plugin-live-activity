import { invoke } from '@tauri-apps/api/core';
import * as activity from '../../../guest-js/index.js';
import { describeError, runLifecycleChecks } from './self-test.js';
import { permissionAction, selectCurrent } from './ui-state.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing demo element: ${id}`);
  return found as T;
}

let current: activity.ActivityRecord | undefined;
let supported = false;
let platform = 'unknown';
let busy = false;
const show = (id: string, value: unknown) => { element(id).textContent = JSON.stringify(value, null, 2); };
const message = (text: string) => { element('message').textContent = text; };
const value = (id: string) => element<HTMLInputElement>(id).value;

function updateButtons(): void {
  for (const button of document.querySelectorAll('button')) button.disabled = busy;
  element<HTMLButtonElement>('start').disabled = busy || !supported || current !== undefined;
  element<HTMLButtonElement>('update').disabled = busy || current === undefined;
  element<HTMLButtonElement>('end').disabled = busy || current === undefined;
  element<HTMLButtonElement>('permission').disabled = busy || !supported;
}

async function refresh(): Promise<void> {
  const [capabilities, permissions] = await Promise.all([activity.getCapabilities(), activity.checkPermissions()]);
  supported = capabilities.start === 'supported';
  platform = capabilities.platform;
  element('permission').textContent = permissionAction(platform).label;
  show('capabilities', capabilities);
  show('permissions', permissions);
  const records = supported ? await activity.list() : [];
  show('records', records);
  current = selectCurrent(records, current);
  updateButtons();
}

async function perform(operation: () => Promise<void>): Promise<void> {
  busy = true;
  updateButtons();
  try { await operation(); }
  catch (error) { message(describeError(error)); }
  finally { busy = false; updateButtons(); }
}

function startInput(): activity.StartInput {
  const common = { activityKey: `demo:${Date.now()}`, schemaVersion: 1 as const, fallback: 'notification' as const };
  const snapshot = { revision: 0, title: value('title'), status: value('status') };
  if (value('template') === 'timer') {
    const startedAt = Date.now();
    return { ...common, template: 'timer', snapshot: { ...snapshot, timer: { startedAt, endsAt: startedAt + 120_000 } } };
  }
  return { ...common, template: 'progress', snapshot: { ...snapshot, progress: Number(value('progress')) } };
}

async function start(): Promise<void> {
  current = await activity.start(startInput());
  message('The OS accepted the activity. Check the notification area or Lock Screen.');
  await refresh();
}

async function update(): Promise<void> {
  if (current === undefined) throw new Error('Start an activity first.');
  const base = { revision: current.snapshot.revision + 1, title: value('title'), status: value('status') };
  const snapshot = current.snapshot.timer !== undefined
    ? { ...base, timer: current.snapshot.timer }
    : { ...base, progress: Number(value('progress')) };
  current = await activity.update({ id: current.id, snapshot });
  message(`Updated revision ${current.snapshot.revision}.`);
  await refresh();
}

async function end(): Promise<void> {
  if (current === undefined) throw new Error('Start an activity first.');
  await activity.end({ id: current.id, policy: { kind: 'immediate' } });
  current = undefined;
  message('Activity ended.');
  await refresh();
}

async function selfTest(): Promise<void> {
  element('self-test-report').dataset.status = 'running';
  element('self-test-report').textContent = 'Running native lifecycle checks…';
  const report = await runLifecycleChecks(activity, String(Date.now()));
  show('self-test-report', report);
  element('self-test-report').dataset.status = report.status;
  document.documentElement.dataset.selfTestStatus = report.status;
  // This is the explicit integration-test report, consumed by emulator tooling.
  console.info(`LIVE_ACTIVITY_SELF_TEST ${JSON.stringify(report)}`);
  try {
    const path = await invoke<string>('save_self_test_report', { report });
    element('report-path').textContent = `Saved report: ${path}`;
  } catch (error) {
    element('report-path').textContent = `Report could not be saved: ${describeError(error)}`;
  }
  message(`Integration test: ${report.status}. Visibility remains an OS decision.`);
  await refresh();
}

const handlers: Readonly<Record<string, () => Promise<void>>> = {
  start, update, end, refresh,
  permission: async () => { show('permissions', await activity.requestPermissions(permissionAction(platform).kind)); await refresh(); },
  'run-self-test': selfTest,
};
for (const [id, handler] of Object.entries(handlers)) {
  element(id).addEventListener('click', () => { void perform(handler); });
}
void perform(async () => {
  await refresh();
  message(supported ? 'Ready. Request notification permission if the OS requires it.' : 'This platform has no implemented activity backend.');
  if (new URLSearchParams(location.search).get('selftest') === '1') await selfTest();
});
