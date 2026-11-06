import { invoke } from '@tauri-apps/api/core';
import * as activity from '../../../guest-js/index.js';
import { describeError, runLifecycleChecks } from './self-test.js';
import { permissionAction, permissionFeedback } from './ui-state.js';
import { advanceMochiActivity, countdown, selectMochiActivity, snackStage, snackSteps, startMochiActivity, type MochiMode } from './mochi.js';
import {
  actionMessage, layoutExamples, layoutRecordFor, nextLayoutSnapshot, runningLayoutExamples,
  type LayoutExample,
} from './layouts.js';

type Mode = MochiMode | 'layout';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing demo element: ${id}`);
  return found as T;
}

let mode: Mode = 'snack';
let records: readonly activity.ActivityRecord[] = [];
let layoutRecords: readonly activity.LayoutActivityRecord[] = [];
let current: activity.ActivityRecord | undefined;
let example: LayoutExample = layoutExamples[0]!;
let supported = false;
let layoutSupported = false;
let platform = 'unknown';
let permissionState: activity.PermissionState = 'unknown';
let busy = false;
const show = (id: string, value: unknown) => { element(id).textContent = JSON.stringify(value, null, 2); };
const text = (id: string, value: string) => { element(id).textContent = value; };
const currentLayout = () => layoutRecordFor(layoutRecords, example.id);
const selectCurrent = () => mode === 'layout' ? undefined : selectMochiActivity(records, mode);

const scenes = {
  snack: { note: 'a treat for your tiny friend', cat: 'Mochi, a cream cat with a coral collar, waiting for a snack', kind: 'THE DAILY DELIVERY' },
  nap: { note: 'a little nap goes a long way', cat: 'Mochi, a cream cat with closed eyes and a coral collar, ready for a nap', kind: 'THE AFTERNOON SNOOZE' },
  layout: { note: 'one little feature at a time', cat: 'Mochi, a cream cat with a coral collar, posing for the examples', kind: 'LAYOUTS · CONTRACT V2' },
} as const;

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
  const running = currentLayout();
  element<HTMLButtonElement>('layout-start').disabled = busy || !layoutSupported;
  element('layout-start').hidden = running !== undefined;
  element('layout-update').hidden = running === undefined || example.next === undefined;
  element('layout-end').hidden = running === undefined;
  text('layout-start', busy ? 'One little moment…' : 'Start this example  ↗');
  text('layout-update', busy ? 'One little moment…' : 'Send new values  →');
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

function renderLayout(): void {
  const running = currentLayout();
  for (const chip of element('example-picker').children) chip.setAttribute('aria-pressed', String(chip.id === `example-${example.id}`));
  text('activity-heading', example.name);
  text('activity-description', example.feature);
  text('layout-android', `On Android: ${example.android}`);
  const degraded = running?.degradedFeatures ?? [];
  element('layout-degraded').hidden = degraded.length === 0;
  text('layout-degraded', `Left out on this device: ${degraded.join(', ')}`);
  show('layout-request', example.start(Date.now()));
  text('cat-mood', running === undefined ? 'Mochi is happy to model for you.' : 'Mochi is on your phone now.');
}

function renderScene(): void {
  const scene = scenes[mode];
  element('scene').dataset.mode = mode;
  element('snack-tracker').hidden = mode !== 'snack';
  element('nap-tracker').hidden = mode !== 'nap';
  element('layout-tracker').hidden = mode !== 'layout';
  element('v1-actions').hidden = mode === 'layout';
  for (const each of ['snack', 'nap', 'layout'] as const) element(`mode-${each}`).setAttribute('aria-pressed', String(mode === each));
  text('scene-note', scene.note);
  text('cat-title', scene.cat);
  text('activity-kind', scene.kind);
  const shown = mode === 'layout' ? currentLayout() : current;
  text('activity-badge', shown === undefined ? 'READY WHEN YOU ARE' : shown.state === 'unknown' ? 'SENT TO YOUR PHONE' : shown.state === 'stale' ? 'NEEDS A LITTLE UPDATE' : mode === 'layout' ? 'ON YOUR PHONE NOW' : mode === 'nap' ? 'DO NOT DISTURB' : current?.snapshot.progress === 1 ? 'HAPPY CAT CLUB' : 'A LITTLE ADVENTURE');
  if (mode === 'layout') renderLayout();
  else {
    text('activity-heading', mode === 'nap' ? 'Big dreams. Tiny paws.' : 'A snack worth waiting for.');
    text('activity-description', mode === 'nap' ? 'Make room for a quiet little break. Mochi will keep you company while the minutes drift by.' : 'A tiny treat, a happy little cat. Follow it from the kitchen to Mochi’s paws.');
    if (mode === 'nap') renderClock(); else renderSnack();
  }
  renderButtons();
}

function nativeNote(): string {
  const state = mode === 'layout' ? currentLayout()?.state : current?.state;
  if (!supported) return 'Open the iOS or Android app to start a native activity.';
  if (mode === 'layout' && !layoutSupported) return 'Layouts need the widget extension built from the plugin’s layout template.';
  if (state === 'unknown') return 'Sent to your phone. Waiting for the system to report its state.';
  if (mode === 'layout') return platform === 'ios' ? 'Look on the Lock Screen and in the Dynamic Island.' : 'Look in your notifications, or the status bar chip when Android promotes it.';
  return platform === 'ios' ? 'Follow along on your Lock Screen when iOS shows the activity.' : 'Follow along in your notifications when Android shows the activity.';
}

function renderPermissions(): void {
  const action = permissionAction(platform);
  text('permission', action.label);
  element<HTMLButtonElement>('permission').disabled = busy || !supported;
  element('permission-panel').hidden = !supported || permissionState === 'granted' || permissionState === 'notApplicable';
  text('permission-heading', permissionState === 'denied' || permissionState === 'settingsRequired' ? 'A quick visit to Settings' : 'One small thing first');
  text('permission-copy', platform === 'ios' ? 'Enable Live Activities for this app in Settings, then check again.' : permissionState === 'denied' || permissionState === 'settingsRequired' ? 'Allow this app’s notifications in Settings, then refresh.' : 'Allow notifications to follow Mochi’s activity on your phone.');
  text('native-note', nativeNote());
}

async function refresh(): Promise<void> {
  const [capabilities, permissions] = await Promise.all([activity.getCapabilities(), activity.checkPermissions()]);
  supported = capabilities.start === 'supported';
  layoutSupported = supported && capabilities.layout === 'supported';
  platform = capabilities.platform;
  permissionState = permissions[platform === 'ios' ? 'liveActivities' : 'notifications'];
  show('capabilities', capabilities);
  show('permissions', permissions);
  records = supported ? await activity.list() : [];
  show('records', records);
  layoutRecords = layoutSupported ? await activity.listLayout() : [];
  show('layout-records', layoutRecords);
  current = selectCurrent();
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
  current = selectCurrent();
}

function rememberLayout(record: activity.LayoutActivityRecord): void {
  layoutRecords = [...layoutRecords.filter(previous => previous.id !== record.id), record];
}

async function start(): Promise<void> {
  remember(await activity.start(startMochiActivity(mode === 'nap' ? 'nap' : 'snack', Date.now(), Number(element<HTMLSelectElement>('nap-duration').value))));
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

// One example at a time: starting one ends the demo's other layout activities first.
async function startLayout(): Promise<void> {
  for (const running of runningLayoutExamples(layoutRecords)) {
    rememberLayout(await activity.endLayout({ id: running.id, policy: { kind: 'immediate' } }));
  }
  rememberLayout(await activity.startLayout(example.start(Date.now())));
  message(`${example.name} is on its way to your phone.`);
  await refresh();
}

async function updateLayout(): Promise<void> {
  const running = currentLayout();
  if (running === undefined) throw new Error('Start this example first.');
  rememberLayout(await activity.updateLayout({ id: running.id, snapshot: nextLayoutSnapshot(running, example) }));
  message(`New values sent at revision ${running.snapshot.revision + 1}.`);
  await refresh();
}

async function endLayout(): Promise<void> {
  const running = currentLayout();
  if (running === undefined) throw new Error('Start this example first.');
  rememberLayout(await activity.endLayout({ id: running.id, policy: { kind: 'immediate' } }));
  message(`${example.name} has ended.`);
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

// Rust handles the taps (src-tauri/src/actions.rs); the page only reports them.
async function listenForTaps(): Promise<void> {
  try {
    await activity.onAction(event => {
      text('tap-status', `Last tap: ${JSON.stringify(event)}`);
      void perform(async () => { await refresh(); message(actionMessage(event)); });
    });
    text('tap-status', 'Listening for button taps.');
  } catch (error) { text('tap-status', `Button taps cannot reach this page: ${describeError(error)}`); }
}

const handlers: Readonly<Record<string, () => Promise<void>>> = {
  start, update, end,
  'layout-start': startLayout, 'layout-update': updateLayout, 'layout-end': endLayout,
  refresh: async () => { await refresh(); message('Mochi’s little corner is up to date.'); },
  permission: async () => { show('permissions', await activity.requestPermissions(permissionAction(platform).kind)); await refresh(); message(permissionFeedback(permissionState)); },
  'run-self-test': selfTest,
};
for (const [id, handler] of Object.entries(handlers)) element(id).addEventListener('click', () => { void perform(handler); });
for (const next of ['snack', 'nap', 'layout'] as const) {
  element(`mode-${next}`).addEventListener('click', () => {
    mode = next;
    current = selectCurrent();
    const resumed = next === 'layout' ? currentLayout() : current;
    message(resumed === undefined ? 'A fresh little moment, whenever you’re ready.' : 'Welcome back. Pick up where you left off.');
    renderScene();
    renderPermissions();
  });
}
for (const choice of layoutExamples) {
  const chip = document.createElement('button');
  chip.id = `example-${choice.id}`;
  chip.textContent = choice.name;
  chip.setAttribute('aria-pressed', 'false');
  chip.addEventListener('click', () => {
    example = choice;
    message(currentLayout() === undefined ? `${choice.name}: start it to see it on your phone.` : `${choice.name} is already on your phone.`);
    renderScene();
    renderPermissions();
  });
  element('example-picker').append(chip);
}
element('nap-duration').addEventListener('change', renderClock);
// Only the foreground text ticks; native timers use their original absolute timestamps.
window.setInterval(renderClock, 1000);
renderScene();
void listenForTaps();
void perform(async () => {
  await refresh();
  message(supported ? 'Mochi’s ready when you are.' : 'This device has no supported activity backend. Open an iOS or Android build.');
  if (new URLSearchParams(location.search).get('selftest') === '1') await selfTest();
});
