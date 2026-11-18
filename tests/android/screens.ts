// The pictures of the demo on Android that the documents show (docs/images): its page, the notification of the two
// templates and of each layout example, and Android's question about notifications. It drives the installed debug
// build of the demo through its WebView's DevTools socket, as webview.ts does, and the notification shade through
// adb. A picture is the device's screen as it was, whole or cut to a notification: nothing is drawn over it.
// It clears the demo's own data first, so that Android asks its question again, and ends every activity it starts.
// The demo's notification has to be the first of the shade: clear the others before a run. The local port has to be
// free: one that already leads to another device is left as it is, and the run stops.
// Usage: node tests/android/screens.ts <adb> <serial> <local port> <folder>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { list, member, present, record, text } from '../support.ts';

/** A part of the screen, in pixels. */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A picture as its pixels: `channels` bytes a pixel, line after line. */
interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly data: Buffer;
}

/** A layout example of the demo and the notification it posts: what the picture waits for, and what it is called. */
interface Shot {
  /** The example's ID in examples/demo/src/layouts.ts. */
  readonly example: string;
  /** How many times the page sends new values before the picture. */
  readonly updates?: number;
  /** A line that the notification shows once it is as the picture wants it. */
  readonly shows: string;
  readonly name: string;
  /** Whether the notification has a running clock. */
  readonly ticks?: boolean;
  /** An action of the notification to tap, the line that the notification shows after it, and that picture's name. */
  readonly tap?: { readonly action: string; readonly shows: string; readonly name: string };
}

const [adbPath, serial, port, folder] = process.argv.slice(2);
if (!adbPath || !serial || !port || !folder) throw new Error('Provide adb, the device serial, a free local port and the folder for the pictures.');
// Where the pictures go: a name of its own, since a function declared below does not know that the folder was given.
const pictures: string = folder;
const app = 'io.github.eedaegon.liveactivitydemo';
/** What a picture of a notification shows around it, in pixels. */
const margin = 24;
// adb gets no standard input: it takes a closed one for a failed connection to its server and starts another.
const run = (...args: readonly string[]): Buffer => execFileSync(adbPath, ['-s', serial, ...args], { timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const adb = (...args: readonly string[]): string => run(...args).toString('utf8').trim();
const pause = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));

async function evaluate(expression: string): Promise<unknown> {
  const targets = list(await (await fetch(`http://127.0.0.1:${port}/json`)).json(), "the WebView's targets").map(item => record(item, 'a target of the WebView'));
  const target = targets.find(item => item.type === 'page' && URL.canParse(text(item.url)) && new URL(text(item.url)).origin === 'http://tauri.localhost');
  assert.ok(target, 'A local Tauri WebView must be present.');
  const socket = new WebSocket(text(target.webSocketDebuggerUrl, "the address of the WebView's socket"));
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebView evaluation timed out')), 10000);
      socket.addEventListener('message', (event: MessageEvent<string>) => {
        const result: unknown = JSON.parse(event.data);
        if (member(result, 'id') !== 1) return;
        clearTimeout(timeout);
        // A reply has an error or a result: one with neither is no reply of the debugger, and reading it fails.
        if (member(result, 'error') || record(member(result, 'result'), "the debugger's result").exceptionDetails) reject(new Error(`WebView evaluation failed: ${JSON.stringify(member(result, 'error') ?? member(result, 'result', 'exceptionDetails'))}`));
        else resolve(record(member(result, 'result', 'result'), 'what the evaluation gave').value);
      });
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  } finally { socket.close(); }
}

/**
 * Waits until `holds` gives something true, for `seconds` by the clock. What it throws meanwhile counts as not yet,
 * and the last of it goes with the error of a wait that ran out.
 */
async function waitFor(holds: () => unknown, what: string, seconds = 30): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  let last: unknown;
  do {
    try { if (await holds()) return; } catch (error) { last = error; }
    await pause(250);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${what}`, { cause: last });
}

// MARK: The page

/** The socket of a WebView's DevTools on a device, without the number of the app's process that ends its name. */
const WEBVIEW = 'localabstract:webview_devtools_remote_';

/** Where the local port leads, as adb lists it: a device and a socket on it. Nothing while the port is free. */
function portLeadsTo(): { readonly device: string; readonly socket: string } | undefined {
  const [device, , socket] = adb('forward', '--list').split('\n').map(line => line.trim().split(/\s+/)).find(([, local]) => local === `tcp:${port}`) ?? [];
  return device === undefined || socket === undefined ? undefined : { device, socket };
}

/**
 * Whether the local port is free or leads to a WebView of this run's device: then the run may take it, and take it
 * back at its end. adb gives a port to the last one that asks for it and takes it back from whichever has it, so a
 * port that leads elsewhere is left as it is.
 */
function portIsOurs(): boolean {
  const held = portLeadsTo();
  return held === undefined || (held.device === serial && held.socket.startsWith(WEBVIEW));
}

/** Launches the demo and waits until its page has read the device and takes a click. */
async function launch(): Promise<void> {
  adb('shell', 'am', 'start', '-n', `${app}/.MainActivity`);
  let process = '';
  await waitFor(() => {
    process = adb('shell', 'pidof', app);
    return process !== '';
  }, "the demo's process");
  // The WebView's socket has the number of the app's process. A port that adb cannot give is no matter of waiting.
  adb('forward', `tcp:${port}`, `${WEBVIEW}${process}`);
  await waitFor(() => evaluate("Boolean(document.querySelector('#capabilities')?.textContent.includes('android') && document.querySelector('#activity').ariaBusy === 'false')"), 'the page of the demo', 60);
}

/** Clicks a button of the page once the page has finished with the click before, and waits until it has finished with this one. */
async function click(id: string): Promise<void> {
  const idle = "document.querySelector('#activity').ariaBusy === 'false'";
  await waitFor(() => evaluate(`${idle} && !document.querySelector('#${id}').disabled && !document.querySelector('#${id}').hidden`), `the button ${id}`);
  await evaluate(`document.querySelector('#${id}').click(); true`);
  await waitFor(() => evaluate(idle), `the page after ${id}`);
}

const message = async (): Promise<string> => text(await evaluate("document.querySelector('#message').textContent"), "the page's message");

// MARK: A PNG, read and written

/** The chunks of a PNG, each with its type. */
function chunks(png: Buffer): { readonly type: string; readonly data: Buffer }[] {
  const found = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    found.push({ type: png.toString('latin1', at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return found;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const framed = Buffer.alloc(body.length + 8);
  framed.writeUInt32BE(data.length, 0);
  body.copy(framed, 4);
  framed.writeUInt32BE(crc32(body), body.length + 4);
  return framed;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The pixels of a PNG as screencap writes it: eight bits a channel, with or without alpha, not interlaced. */
function pixels(png: Buffer): Pixels {
  const parts = chunks(png);
  const header = present(parts.find(part => part.type === 'IHDR'), "the picture's header").data;
  const [width, height, depth, kind, interlace] = [header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9], header[12]];
  assert.ok(depth === 8 && (kind === 2 || kind === 6) && interlace === 0, 'a picture of another kind than screencap writes');
  const channels = kind === 6 ? 4 : 3;
  const stride = width * channels;
  const packed = inflateSync(Buffer.concat(parts.filter(part => part.type === 'IDAT').map(part => part.data)));
  const data = Buffer.alloc(height * stride);
  // Each line of a PNG is written against the line above and the pixel before, in one of five ways.
  for (let y = 0; y < height; y += 1) {
    const filter = present(packed[y * (stride + 1)], 'a line of the picture');
    assert.ok(filter <= 4, `line ${y} of the picture is written in a way that a PNG does not have (${filter})`);
    for (let x = 0; x < stride; x += 1) {
      const raw = present(packed[y * (stride + 1) + 1 + x]);
      const left = x >= channels ? present(data[y * stride + x - channels]) : 0;
      const up = y > 0 ? present(data[(y - 1) * stride + x]) : 0;
      const corner = x >= channels && y > 0 ? present(data[(y - 1) * stride + x - channels]) : 0;
      const estimate = left + up - corner;
      const nearest = Math.abs(estimate - left) <= Math.abs(estimate - up) && Math.abs(estimate - left) <= Math.abs(estimate - corner) ? left
        : Math.abs(estimate - up) <= Math.abs(estimate - corner) ? up : corner;
      const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : nearest;
      data[y * stride + x] = (raw + predicted) & 0xff;
    }
  }
  return { width, height, channels, data };
}

/** The part of `picture` within `box`, as a PNG. */
function png(picture: Pixels, box: Box): Buffer {
  const [left, top] = [Math.max(0, box.left), Math.max(0, box.top)];
  const [right, bottom] = [Math.min(picture.width, box.right), Math.min(picture.height, box.bottom)];
  assert.ok(right > left && bottom > top, `nothing of ${JSON.stringify(box)} is on the picture`);
  const stride = picture.width * picture.channels;
  const lines = [];
  for (let y = top; y < bottom; y += 1) lines.push(Buffer.from([0]), picture.data.subarray(y * stride + left * picture.channels, y * stride + right * picture.channels));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(right - left, 0);
  header.writeUInt32BE(bottom - top, 4);
  header.set([8, picture.channels === 4 ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(lines), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Whether two points of a line of `picture` have one color. */
function sameColor(picture: Pixels, y: number, first: number, second: number): boolean {
  const at = (x: number): number => (y * picture.width + x) * picture.channels;
  return picture.data.compare(picture.data, at(second), at(second) + 3, at(first), at(first) + 3) === 0;
}

// MARK: The screen

/** The screen as a PNG. A screencap that failed writes what it has to say where the picture should be, and adb passes no status of it on. */
function screen(): Buffer {
  const shot = run('exec-out', 'screencap', '-p');
  assert.ok(shot.subarray(0, 8).equals(SIGNATURE), `screencap gave no picture: ${shot.subarray(0, 120).toString('latin1')}`);
  return shot;
}

function keep(name: string, picture: Buffer): void {
  writeFileSync(join(pictures, `${name}.png`), picture);
  console.info(name);
}

/** What the screen holds, as uiautomator lists it. It lists a screen that is still: none with a running clock. */
function hierarchy(): string {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { if (/dumped to:/.test(adb('shell', 'uiautomator', 'dump', '/sdcard/live-activity-screens.xml'))) return adb('shell', 'cat', '/sdcard/live-activity-screens.xml'); } catch (error) { last = error; }
  }
  throw new Error('uiautomator did not list the screen', { cause: last });
}

function boxOf(found: RegExpExecArray | undefined | null): Box | undefined {
  if (found === undefined || found === null) return undefined;
  const [left, top, right, bottom] = found.slice(1).map(Number);
  return { left: present(left), top: present(top), right: present(right), bottom: present(bottom) };
}

const BOUNDS = 'bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"';
/** `label` as a pattern that matches it and nothing else. */
const literal = (label: string): string => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The bounds of the node of `xml` that shows `label`. */
const shown = (xml: string, label: string): Box | undefined => boxOf(new RegExp(`<node[^>]*text="${literal(label)}"[^>]*${BOUNDS}`).exec(xml));

/** The bounds of the row of the notification that shows `line`: the last row that `xml` names before the line. */
function rowOf(xml: string, line: string): Box | undefined {
  const rows = new RegExp(`<node[^>]*resource-id="com\\.android\\.systemui:id/expandableNotificationRow"[^>]*${BOUNDS}`, 'g');
  return boxOf([...xml.slice(0, Math.max(0, xml.indexOf(`text="${line}"`))).matchAll(rows)].at(-1));
}

function tap(box: Box): void {
  adb('shell', 'input', 'tap', String(Math.round((box.left + box.right) / 2)), String(Math.round((box.top + box.bottom) / 2)));
}

/** Opens the notification shade once a notification of the demo shows `line`, as the system lists what is posted. */
async function shade(line: string, seconds = 30): Promise<void> {
  await waitFor(() => adb('shell', 'dumpsys', 'notification', '--noredact').includes(`String (${line})`), `a notification that shows ${line}`, seconds);
  adb('shell', 'cmd', 'statusbar', 'expand-notifications');
  // The shade has moved into place and drawn the notification a moment later.
  await pause(1500);
}

/** Where the shade's first notification begins, from a screen that uiautomator could list: all of them begin there. */
let first: Box | undefined;

/**
 * The notification that shows `line`, cut from the open shade with a margin, and what the screen holds when it could
 * be listed. A notification with a running clock is not listed: it begins where the last one that was listed did, and
 * ends at the first line of pixels where a point within its left edge has the color of the shade beside it.
 */
function notification(line: string, ticks = false): { readonly picture: Buffer; readonly xml: string } {
  const xml = ticks ? '' : hierarchy();
  const picture = pixels(screen());
  let row = ticks ? undefined : rowOf(xml, line);
  if (ticks) {
    const start = present(first, 'a notification without a clock, to tell where one begins');
    const [inside, outside] = [start.left + 130, Math.max(0, start.left - 30)];
    let bottom = start.top + 60;
    while (bottom < picture.height && !sameColor(picture, bottom, inside, outside)) bottom += 1;
    row = { ...start, bottom };
  }
  assert.ok(row, `the shade has no notification that shows ${line}`);
  first = row;
  return { picture: png(picture, { left: row.left - margin, top: row.top - margin, right: row.right + margin, bottom: row.bottom + margin }), xml };
}

// MARK: The walks

/** Android's question about notifications, over the page that asked. */
async function permission(): Promise<void> {
  assert.equal(adb('shell', 'pm', 'clear', app), 'Success');
  await launch();
  await evaluate("document.querySelector('#permission-panel').scrollIntoView({ block: 'center' }); true");
  await evaluate("document.querySelector('#permission').click(); true");
  let allow: Box | undefined;
  await waitFor(() => {
    // The screen cannot be listed while the question moves into place: the wait asks again.
    allow = boxOf(new RegExp(`resource-id="[^"]*:id/permission_allow_button"[^>]*${BOUNDS}`).exec(hierarchy()));
    return allow;
  }, "Android's question about notifications");
  await pause(700);
  keep('android-permission', screen());
  tap(present(allow, 'the button that allows'));
  await waitFor(() => evaluate("document.querySelector('#permission-panel').hidden"), 'the permission, allowed');
  await evaluate('window.scrollTo(0, 0); true');
}

/** The two templates: the page with a delivery under way, and each template's notification. */
async function templates(): Promise<void> {
  await click('mode-snack');
  await click('start');
  await click('update');
  await pause(700);
  keep('android-demo-snack', screen());
  await shade('On the way to Mochi');
  keep('android-v1-progress', notification('On the way to Mochi').picture);
  adb('shell', 'cmd', 'statusbar', 'collapse');
  await click('end');
  await click('mode-nap');
  await click('start');
  await shade('A little snooze, a little peace');
  keep('android-v1-timer', notification('A little snooze, a little peace', true).picture);
  adb('shell', 'cmd', 'statusbar', 'collapse');
  await click('end');
}

const shots: readonly Shot[] = [
  { example: 'text', shows: 'Packing a tiny treat', name: 'android-layout-text' },
  { example: 'text', updates: 2, shows: 'Snack time! Made it home', name: 'android-layout-text-arrived' },
  { example: 'progress', updates: 1, shows: 'On the way to Mochi', name: 'android-layout-progress' },
  { example: 'timer', shows: 'A little snooze', name: 'android-layout-timer', ticks: true },
  { example: 'stacks', shows: 'Snack route', name: 'android-layout-stacks' },
  { example: 'buttons', shows: 'No pets yet', name: 'android-layout-buttons-before', tap: { action: 'Pet Mochi', shows: 'Purring. 1 pet so far', name: 'android-layout-buttons-after' } },
  { example: 'switch', shows: 'Quiet as a mouse', name: 'android-layout-switch-off', tap: { action: 'Purr alerts', shows: 'Purring out loud', name: 'android-layout-switch-on' } },
  { example: 'link', shows: 'Three treats left', name: 'android-layout-link' },
  { example: 'styles', updates: 1, shows: 'Running 5 min late', name: 'android-layout-styles' },
  { example: 'android', updates: 1, shows: 'Fast asleep', name: 'android-layout-android' },
];

/** The notification of one layout example, and of what a tap on one of its actions makes of it. */
async function layout(shot: Shot): Promise<void> {
  await click(`example-${shot.example}`);
  await click('layout-start');
  assert.match(await message(), /is on its way to your phone/);
  for (let update = 0; update < (shot.updates ?? 0); update += 1) await click('layout-update');
  await shade(shot.shows);
  const before = notification(shot.shows, shot.ticks);
  keep(shot.name, before.picture);
  if (shot.tap !== undefined) {
    tap(present(shown(before.xml, shot.tap.action), `the action ${shot.tap.action}`));
    // Rust's handler answers the tap with an update (examples/demo/src-tauri/src/actions.rs).
    await shade(shot.tap.shows);
    keep(shot.tap.name, notification(shot.tap.shows).picture);
  }
  adb('shell', 'cmd', 'statusbar', 'collapse');
  await click('layout-end');
}

/** A scheduled start: nothing until its time, then the notification that Android's alarm posts. */
async function later(): Promise<void> {
  await click('example-later');
  await click('layout-start');
  assert.match(await message(), /is waiting for its time/);
  // The example begins 30 seconds after its start (`startsIn`); without exact alarms Android may take longer.
  await shade('Dinner is served', 240);
  keep('android-layout-later', notification('Dinner is served').picture);
  adb('shell', 'cmd', 'statusbar', 'collapse');
  await click('layout-end');
}

assert.ok(portIsOurs(), `The local port ${port} already leads to ${portLeadsTo()?.socket} on the device ${portLeadsTo()?.device}: give a free one.`);
mkdirSync(pictures, { recursive: true });
try {
  await permission();
  await templates();
  await click('mode-layout');
  for (const shot of shots) await layout(shot);
  await later();
  console.info('done');
} finally {
  // The port goes back, also from a run that failed: when it still leads to this device's WebView, and not when
  // something else has taken it meanwhile.
  try { if (portLeadsTo() !== undefined && portIsOurs()) adb('forward', '--remove', `tcp:${port}`); } catch { /* nothing more to give back */ }
}
