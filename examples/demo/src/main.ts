import { invoke } from '@tauri-apps/api/core';
import * as activity from '../../../guest-js/index.js';
import { describeError, runLifecycleChecks } from './self-test.js';
import { permissionAction, permissionFeedback } from './ui-state.js';
import { advanceMochiActivity, countdown, selectMochiActivity, snackStage, snackSteps, startMochiActivity, type MochiMode } from './mochi.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing demo element: ${id}`);
  return found as T;
}

let mode: MochiMode = 'snack';
let records: readonly activity.ActivityRecord[] = [];
let current: activity.ActivityRecord | undefined;
let supported = false;
let platform = 'unknown';
let permissionState: activity.PermissionState = 'unknown';
let busy = false;
const show = (id: string, value: unknown) => { element(id).textContent = JSON.stringify(value, null, 2); };
const text = (id: string, value: string) => { element(id).textContent = value; };

function message(value: string, error = false): void {
  text('message', value);
  element('message').parentElement!.dataset.error = String(error);
}

function renderButtons(): void {
  const delivered = mode === 'snack' && current?.snapshot.progress === 1;
  for (const button of document.querySelectorAll('button')) button.disabled = busy;
  element<HTMLButtonElement>('start').disabled = busy || !supported;
  element('start').hidden = current !== undefined;
  element('update').hidden = current === undefined || delivered;
  element('end').hidden = current === undefined;
  element('end').className = delivered ? 'primary' : 'secondary';
  text('start', busy ? 'One little moment…' : mode === 'snack' ? 'Start snack delivery  ↗' : 'Start a little nap  ☾');
  text('update', busy ? 'One little moment…' : mode === 'nap' ? 'Snooze for one more minute' : snackStage(current?.snapshot.progress ?? 0) === 0 ? 'Send it on its way  →' : 'The snack is here!  ♡');
  text('end', mode === 'snack' ? delivered ? 'All done. Happy Mochi!  ✓' : 'Finish delivery' : 'Wake up, sleepyhead');
  element<HTMLSelectElement>('nap-duration').disabled = busy || current !== undefined;
  element('nap-duration-label').hidden = current !== undefined;
  element('activity').ariaBusy = String(busy);
}

function renderSnack(): void {
  const progress = current?.snapshot.progress ?? 0;
  const stage = current === undefined ? -1 : snackStage(progress);
  text('stage-copy', stage < 0 ? 'Let’s pack something delicious' : snackSteps[stage]!);
  text('progress-copy', `${Math.round(progress * 100)}%`);
  element<HTMLProgressElement>('delivery-progress').value = progress;
  for (let i = 0; i < 3; i += 1) element(`step-${i}`).dataset.reached = String(i <= stage);
  text('cat-mood', stage === 2 ? 'A full belly. A very happy Mochi.' : 'Mochi has excellent snack intuition.');
}

function renderClock(): void {
  if (mode !== 'nap') return;
  const duration = Number(element<HTMLSelectElement>('nap-duration').value);
  const remaining = countdown(current?.snapshot.timer?.endsAt ?? duration * 60_000, current === undefined ? 0 : Date.now());
  text('nap-clock', remaining);
  text('nap-caption', current === undefined ? 'A small pause for a softer day.' : remaining === '00:00' ? 'Time to stretch those tiny paws.' : 'Shh… small cat, big dreams.');
  text('cat-mood', current === undefined ? 'Mochi has cleared the afternoon.' : 'Do not disturb the tiny dreamer.');
}

function renderScene(): void {
  const nap = mode === 'nap';
  element('scene').dataset.mode = mode;
  element('snack-tracker').hidden = nap;
  element('nap-tracker').hidden = !nap;
  element('mode-snack').setAttribute('aria-pressed', String(!nap));
  element('mode-nap').setAttribute('aria-pressed', String(nap));
  text('scene-note', nap ? 'a little nap goes a long way' : 'a treat for your tiny friend');
  text('cat-title', nap ? 'Mochi, a cream cat with closed eyes and a coral collar, ready for a nap' : 'Mochi, a cream cat with a coral collar, waiting for a snack');
  text('activity-kind', nap ? 'THE AFTERNOON SNOOZE' : 'THE DAILY DELIVERY');
  text('activity-heading', nap ? 'Big dreams. Tiny paws.' : 'A snack worth waiting for.');
  text('activity-description', nap ? 'Make room for a quiet little break. Mochi will keep you company while the minutes drift by.' : 'A tiny treat, a happy little cat. Follow it from the kitchen to Mochi’s paws.');
  text('activity-badge', current === undefined ? 'READY WHEN YOU ARE' : current.state === 'unknown' ? 'SENT TO YOUR PHONE' : current.state === 'stale' ? 'NEEDS A LITTLE UPDATE' : nap ? 'DO NOT DISTURB' : current.snapshot.progress === 1 ? 'HAPPY CAT CLUB' : 'A LITTLE ADVENTURE');
  if (nap) renderClock(); else renderSnack();
  renderButtons();
}

function renderPermissions(): void {
  const action = permissionAction(platform);
  text('permission', action.label);
  element<HTMLButtonElement>('permission').disabled = busy || !supported;
  element('permission-panel').hidden = !supported || permissionState === 'granted' || permissionState === 'notApplicable';
  text('permission-heading', permissionState === 'denied' || permissionState === 'settingsRequired' ? 'A quick visit to Settings' : 'One small thing first');
  text('permission-copy', platform === 'ios' ? 'Enable Live Activities for this app in Settings, then check again.' : permissionState === 'denied' || permissionState === 'settingsRequired' ? 'Allow this app’s notifications in Settings, then refresh.' : 'Allow notifications to follow Mochi’s activity on your phone.');
  text('native-note', !supported ? 'Open the iOS or Android app to start a native activity.' : current?.state === 'unknown' ? 'Sent to your phone. Waiting for the system to report its state.' : platform === 'ios' ? 'Follow along on your Lock Screen when iOS shows the activity.' : 'Follow along in your notifications when Android shows the activity.');
}

async function refresh(): Promise<void> {
  const [capabilities, permissions] = await Promise.all([activity.getCapabilities(), activity.checkPermissions()]);
  supported = capabilities.start === 'supported';
  platform = capabilities.platform;
  permissionState = permissions[platform === 'ios' ? 'liveActivities' : 'notifications'];
  show('capabilities', capabilities);
  show('permissions', permissions);
  records = supported ? await activity.list() : [];
  show('records', records);
  current = selectMochiActivity(records, mode);
  renderScene();
  renderPermissions();
}

async function perform(operation: () => Promise<void>): Promise<void> {
  busy = true;
  renderButtons();
  try { await operation(); }
  catch (error) { message(platform === 'unknown' ? 'Mochi needs the iOS or Android app to connect. Open a mobile build and try again.' : describeError(error), true); }
  finally { busy = false; renderScene(); renderPermissions(); }
}

function remember(record: activity.ActivityRecord): void {
  records = [...records.filter(previous => previous.id !== record.id), record];
  current = selectMochiActivity(records, mode);
}

async function start(): Promise<void> {
  remember(await activity.start(startMochiActivity(mode, Date.now(), Number(element<HTMLSelectElement>('nap-duration').value))));
  message(mode === 'snack' ? 'One tiny treat is on its way. Check your phone’s activity surface.' : 'Sweet dreams, Mochi. Your phone will keep the time.');
  await refresh();
}

async function update(): Promise<void> {
  if (current === undefined) throw new Error('Start a little moment first.');
  const receipt = await activity.update({ id: current.id, snapshot: advanceMochiActivity(current) });
  remember(receipt);
  message(receipt.snapshot.status);
  await refresh();
}

async function end(): Promise<void> {
  if (current === undefined) throw new Error('Start a little moment first.');
  remember(await activity.end({ id: current.id, policy: { kind: 'immediate' } }));
  message(mode === 'snack' ? 'Delivery finished. Mochi sends a very happy purr.' : 'Nap finished. A big stretch, and back to the day.');
  await refresh();
}

async function selfTest(): Promise<void> {
  element('self-test-report').dataset.status = 'running';
  text('self-test-report', 'Running native lifecycle checks…');
  const report = await runLifecycleChecks(activity, String(Date.now()));
  show('self-test-report', report);
  element('self-test-report').dataset.status = report.status;
  document.documentElement.dataset.selfTestStatus = report.status;
  // Explicit integration-test output, consumed by emulator tooling.
  console.info(`LIVE_ACTIVITY_SELF_TEST ${JSON.stringify(report)}`);
  try {
    const path = await invoke<string>('save_self_test_report', { report });
    text('report-path', `Saved report: ${path}`);
  } catch (error) { text('report-path', `Report could not be saved: ${describeError(error)}`); }
  message(`Integration test: ${report.status}. Visibility remains an OS decision.`);
  await refresh();
}

const handlers: Readonly<Record<string, () => Promise<void>>> = {
  start, update, end,
  refresh: async () => { await refresh(); message('Mochi’s little corner is up to date.'); },
  permission: async () => { show('permissions', await activity.requestPermissions(permissionAction(platform).kind)); await refresh(); message(permissionFeedback(permissionState)); },
  'run-self-test': selfTest,
};
for (const [id, handler] of Object.entries(handlers)) element(id).addEventListener('click', () => { void perform(handler); });
for (const next of ['snack', 'nap'] as const) {
  element(`mode-${next}`).addEventListener('click', () => {
    mode = next;
    current = selectMochiActivity(records, mode);
    message(current === undefined ? 'A fresh little moment, whenever you’re ready.' : 'Welcome back. Pick up where you left off.');
    renderScene();
    renderPermissions();
  });
}
element('nap-duration').addEventListener('change', renderClock);
// Only the foreground text ticks; native timers use their original absolute timestamps.
window.setInterval(renderClock, 1000);
renderScene();
void perform(async () => {
  await refresh();
  message(supported ? 'Mochi’s ready when you are.' : 'This device has no supported activity backend. Open an iOS or Android build.');
  if (new URLSearchParams(location.search).get('selftest') === '1') await selfTest();
});
