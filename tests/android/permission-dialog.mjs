// Real Android permission dialogs in an installed debug Mochi Tauri app.
// This resets only the explicitly named test app's data.
// Usage: node tests/android/permission-dialog.mjs <adb> <serial> <test-app-id> <report.json>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const [adbPath, serial, appId, output] = process.argv.slice(2);
const testApps = ['io.github.eedaegon.liveactivitydemo', 'io.github.eedaegon.liveactivityregistry'];
if (!adbPath || !serial || !testApps.includes(appId) || !output) {
  throw new Error('Provide adb, emulator serial, a live-activity test app ID and report path.');
}
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', timeout: 15000 }).trim();
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
const checks = [];

async function evaluate(expression) {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
  const target = targets.find(item => item.type === 'page' && URL.canParse(item.url) && new URL(item.url).origin === 'http://tauri.localhost');
  assert.ok(target, 'A local Tauri WebView must be present.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebView evaluation timed out')), 10000);
      socket.addEventListener('message', event => {
        const result = JSON.parse(event.data);
        if (result.id !== 1) return;
        clearTimeout(timeout);
        if (result.error || result.result.exceptionDetails) reject(new Error(`WebView evaluation failed: ${JSON.stringify(result.error ?? result.result.exceptionDetails)}`));
        else resolve(result.result.result.value);
      });
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  } finally { socket.close(); }
}

async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await predicate()) return;
    await pause();
  }
  throw new Error(`Timed out: ${description}`);
}

async function resetApp() {
  assert.equal(adb('shell', 'pm', 'clear', appId), 'Success');
  adb('shell', 'am', 'start', '-n', `${appId}/.MainActivity`);
  await waitFor(async () => {
    try {
      const pid = adb('shell', 'pidof', appId);
      adb('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`);
      return await evaluate("Boolean(document.querySelector('#capabilities')?.textContent.includes('android') && !document.querySelector('#permission').disabled)");
    } catch { return false; }
  }, 'Mochi app ready');
}

async function showDialog() {
  await evaluate("document.querySelector('#permission').click(); true");
  await waitFor(async () => {
    if (!/topResumedActivity=.*GrantPermissionsActivity/.test(adb('shell', 'dumpsys', 'activity', 'activities'))) return false;
    const windows = adb('shell', 'dumpsys', 'window', 'windows').split(/\n  Window #/);
    return windows.some(window => window.split('\n')[0].includes('GrantPermissionsActivity') &&
      window.includes('mDrawState=HAS_DRAWN') && window.includes('mEnterAnimationPending=false') &&
      window.includes('isReadyForDisplay()=true') && window.includes('isVisible=true'));
  }, 'visible Android permission dialog ready for input');
}

async function choosePermission(choice) {
  adb('shell', 'rm', '-f', '/sdcard/live-activity-permission.xml');
  const dump = adb('shell', 'uiautomator', 'dump', '/sdcard/live-activity-permission.xml');
  assert.match(dump, /dumped to:/, 'Read the current permission dialog, never an older hierarchy');
  const xml = adb('shell', 'cat', '/sdcard/live-activity-permission.xml');
  const button = choice === 'deny' ? 'deny(?:_and_dont_ask_again)?' : 'allow';
  const pattern = new RegExp(`resource-id="[^"]*:id/permission_${button}_button"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const bounds = pattern.exec(xml);
  assert.ok(bounds, `Android ${choice} button must exist`);
  const [, left, top, right, bottom] = bounds.map(Number);
  adb('shell', 'input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}

async function expectPermission(expected, name) {
  await waitFor(async () => !await evaluate("document.querySelector('#permission').disabled"), 'permission callback');
  const state = await evaluate("window.__TAURI_INTERNALS__.invoke('plugin:live-activity|check_permissions', {})");
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert.ok(allowed.includes(state.notifications), `${name}: expected ${allowed.join(' or ')}, received ${state.notifications}`);
  checks.push({ name, expected, actual: state.notifications, passed: true });
  console.info(`${name}: ${state.notifications}`);
}

await resetApp();
await expectPermission('prompt', 'fresh install can request permission');
await showDialog();
// Escape dismisses the visible Android dialog without choosing either permission button.
adb('shell', 'input', 'keyevent', '111');
await expectPermission(['prompt', 'unknown'], 'cancelled dialog remains explicitly retryable');
await showDialog();
await choosePermission('allow');
await expectPermission('granted', 'retry after cancellation can grant permission');
await resetApp();
await showDialog();
await choosePermission('deny');
await expectPermission('prompt', 'first denial preserves an explicit request opportunity');
await showDialog();
await choosePermission('deny');
await expectPermission('settingsRequired', 'repeated denial requires settings');
writeFileSync(output, `${JSON.stringify({ api: Number(adb('shell', 'getprop', 'ro.build.version.sdk')), appId, status: 'passed', checks }, null, 2)}\n`);
console.info(`${checks.length} real permission dialog checks passed`);
