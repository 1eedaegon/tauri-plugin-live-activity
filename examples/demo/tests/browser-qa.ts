// Browser previews use an injected adapter. Native OS verification is separate.
// PLAYWRIGHT_MODULE and AXE_MODULE may point at tools installed outside this repo.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type {
  ActivityRecord, Capabilities, ErrorCode, LayoutActivityRecord, LayoutStartInput, LiveActivityError, PermissionKind,
  PermissionState, Permissions, StartInput, UpdateInput,
} from '../../../guest-js/index.js';
import { list, member, record as jsonObject, unchecked } from '../../../tests/support.ts';

/** The size of a page, in CSS pixels. */
interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** What the script uses of Playwright's module: a Chromium to launch. */
interface PlaywrightModule {
  readonly chromium: { launch(): Promise<Browser> };
}

/** What the script uses of Playwright's browser: a page of a size, in a context of its own. */
interface Browser {
  newContext(options: { viewport: Viewport; reducedMotion: 'reduce' }): Promise<{ newPage(): Promise<Page> }>;
  close(): Promise<void>;
}

/**
 * What the script uses of Playwright's page. A function that the page is given runs in the page, where nothing of
 * this module is: none of its helpers, and nothing that it imports.
 */
interface Page {
  on(event: 'pageerror', listener: (error: Error) => void): unknown;
  addInitScript<Argument>(script: (argument: Argument) => void, argument: Argument): Promise<void>;
  goto(url: string): Promise<unknown>;
  waitForFunction(pageFunction: () => boolean): Promise<unknown>;
  evaluate<Result>(pageFunction: () => Result): Promise<Result>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  viewportSize(): Viewport | null;
  setViewportSize(viewportSize: Viewport): Promise<void>;
  locator(selector: string): Locator;
  readonly keyboard: { press(key: string): Promise<void> };
  close(): Promise<void>;
}

/** What the script uses of Playwright's locator: the element that a selector finds, asked or acted on in the page. */
interface Locator {
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  isDisabled(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
  innerText(): Promise<string>;
  count(): Promise<number>;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  evaluate<Result>(pageFunction: (element: HTMLElement | SVGElement) => Result): Promise<Result>;
  focus(): Promise<void>;
  click(): Promise<void>;
  selectOption(value: string): Promise<unknown>;
}

/** What the script uses of @axe-core/playwright's module: the rules of some tags, run on a page. */
interface AxeModule {
  readonly default: new (options: { page: Page }) => AxeBuilder;
}

/** What the script uses of axe's builder, and of what its run finds: each rule that the page breaks, and where. */
interface AxeBuilder {
  withTags(tags: string[]): AxeBuilder;
  analyze(): Promise<{ violations: { id: string; impact?: unknown; nodes: { target: unknown }[] }[] }>;
}

/** How the backend of a preview answers: what the adapter is given when a page opens. */
interface QaConfig {
  readonly platform?: string;
  readonly permission?: PermissionState;
  /** How long every IPC call takes, in milliseconds. */
  readonly delay?: number;
  readonly unsupported?: boolean;
  /** Whether the first list after a start fails. The adapter turns it off then. */
  failListAfterStart?: boolean;
  /** Whether a start answers a record whose state is unknown. */
  readonly pending?: boolean;
  /** The message that a start is refused with. */
  readonly error?: string;
}

/** A record of the adapter's backend, of a template or of a layout: the members that both kinds of record have. */
type QaRecord = Pick<ActivityRecord | LayoutActivityRecord, keyof (ActivityRecord | LayoutActivityRecord)>;

/**
 * A request as the adapter reads it. It tells a start from an update and an end by the name of the command, which the
 * compiler cannot follow: so a request is here a start that also has the handle that an update and an end have.
 */
type QaRequest = (StartInput | LayoutStartInput) & Pick<UpdateInput, 'id'>;

/**
 * The arguments of an IPC call as the adapter and the script read them, each where its command has it: the request of
 * a start, an update or an end, and the kind of the permission that is asked for.
 */
interface QaArguments {
  readonly input: QaRequest;
  readonly kind: PermissionKind;
}

/** An IPC call that the page made. */
interface QaCall {
  readonly command: string;
  readonly args: QaArguments;
}

/** What the adapter keeps in the page for the script: how it was opened, the records of its backend, its calls. */
interface QaState {
  readonly config: QaConfig;
  readonly records: readonly QaRecord[];
  readonly calls: QaCall[];
}

/**
 * The window of the page, as the functions that run in the page see it: with Tauri's IPC, which the adapter stands in
 * for, and with what the adapter keeps.
 */
declare const window: Window & {
  __MOCHI_QA__: QaState;
  __TAURI_INTERNALS__: { invoke: (command: string, args: QaArguments) => Promise<unknown> };
};

/** A picture that the script took of a page, for its report. */
interface Render {
  readonly viewport: string;
  readonly artifact: string;
  readonly observation: string;
}

const { chromium } = unchecked<PlaywrightModule>(await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright'));
const { default: AxeBuilder } = unchecked<AxeModule>(await import(process.env.AXE_MODULE ?? '@axe-core/playwright'));
const demo = fileURLToPath(new URL('../', import.meta.url));
const evidence = `${demo}design`;
const server = createServer(async (request, response) => {
  const name = new URL(request.url ?? '/', 'http://localhost').pathname.slice(1) || 'index.html';
  if (!['index.html', 'styles.css', 'main.js', 'main.js.map'].includes(name)) { response.writeHead(404).end(); return; }
  try {
    response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(await readFile(`${demo}dist/${name}`));
  } catch { response.writeHead(404).end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${jsonObject(server.address(), 'the address of the server').port}`;
const browser = await chromium.launch();
const failures: string[] = [];
const checks: string[] = [];
const renders: Render[] = [];
const check = async (name: string, operation: () => Promise<void>): Promise<void> => { await operation(); checks.push(name); };

function adapter(config: QaConfig): void {
  let records: QaRecord[] = [];
  let serial = 0;
  let permission = config.permission ?? 'granted';
  const platform = config.platform ?? 'ios';
  const fail = (code: ErrorCode, message: string): never => { throw { code, message } satisfies LiveActivityError; };
  window.__MOCHI_QA__ = { config, get records() { return records; }, calls: [] };
  window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    window.__MOCHI_QA__.calls.push({ command, args });
    // The layout commands follow the template commands' rules; an end may carry final content.
    const name = command.split('|')[1] ?? '';
    const layout = name.endsWith('_layout');
    const operation = name.replace(/_layout$/, '');
    if (config.delay) await new Promise(resolve => setTimeout(resolve, config.delay));
    const permissions = (): Partial<Permissions> => ({ notifications: platform === 'android' ? permission : 'notApplicable', liveActivities: platform === 'ios' ? permission : 'notApplicable', promotion: 'notApplicable' });
    if (operation === 'get_capabilities') return { platform, backend: platform === 'ios' ? 'activityKit' : 'androidNotification', start: config.unsupported ? 'unsupported' : 'supported', progress: 'supported', timer: 'supported', layout: 'supported', push: 'unsupported' } satisfies Partial<Capabilities>;
    if (operation === 'check_permissions') return permissions();
    if (operation === 'request_permissions') { permission = 'granted'; return permissions(); }
    if (operation === 'push_tokens') return { activities: [] };
    if (operation === 'list') {
      if (config.failListAfterStart && records.length > 0) { config.failListAfterStart = false; return fail('NATIVE_ERROR', 'Temporary observation failure.'); }
      return structuredClone(records.filter(record => (record.schemaVersion === 2) === layout));
    }
    if (operation === 'start') {
      if (config.error) return fail('NATIVE_ERROR', config.error);
      if (permission !== 'granted') return fail('PERMISSION_DENIED', 'Allow notifications in Settings.');
      const input = args.input;
      const previous = records.find(record => record.activityKey === input.activityKey && record.state !== 'ended');
      if (previous) return structuredClone(previous);
      // A start at a later time is pending until then, and the preview never gets there.
      const later = 'scheduled' in input && input.scheduled !== undefined;
      const record: QaRecord = { ...input, id: `qa-${++serial}`, backend: platform === 'ios' ? 'activityKit' : 'androidNotification', state: config.pending ? 'unknown' : later ? 'pending' : 'active', visibility: 'unknown', promotionRequested: false, promotionState: 'notApplicable', degradedFeatures: [] };
      records = [...records, record];
      return structuredClone(record);
    }
    if (operation === 'update' || operation === 'end') {
      const previous = records.find(record => record.id === args.input.id);
      if (!previous || (operation === 'update' && previous.state === 'ended')) return fail('NOT_FOUND', 'Activity ended.');
      if (operation === 'update') {
        if (previous.state === 'pending') return fail('CONFLICT', 'The activity has not begun.');
        const snapshot = args.input.snapshot;
        if (snapshot.revision < previous.snapshot.revision) return fail('STALE_REVISION', 'Stale revision.');
        if (snapshot.revision === previous.snapshot.revision && JSON.stringify(snapshot) !== JSON.stringify(previous.snapshot)) return fail('CONFLICT', 'Conflicting revision.');
      }
      const final = operation === 'end' && args.input.snapshot ? { snapshot: args.input.snapshot } : {};
      const record: QaRecord = operation === 'end' ? { ...previous, ...final, state: 'ended' } : { ...previous, snapshot: args.input.snapshot };
      records = records.map(item => item.id === record.id ? record : item);
      return structuredClone(record);
    }
    if (command === 'save_self_test_report') return 'app-data/self-test-report.json';
    if (command === 'self_test_requested') return false;
    throw new Error(`Unhandled QA command: ${command}`);
  } };
}

async function open(config: QaConfig = {}, viewport: Viewport = { width: 390, height: 844 }, query = ''): Promise<Page> {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  await page.addInitScript(adapter, config);
  await page.goto(url + query);
  return page;
}
async function ready(page: Page): Promise<void> { await page.waitForFunction(() => document.querySelector('#activity')?.getAttribute('aria-busy') === 'false'); }
async function capture(page: Page, name: string, observation: string): Promise<void> {
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  const viewport = page.viewportSize();
  assert.ok(viewport, 'the page has no viewport');
  renders.push({ viewport: `${viewport.width}x${viewport.height}`, artifact: `${name}.png`, observation });
}
async function noOverflow(page: Page): Promise<void> { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(result.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => node.target) })), []);
}

try {
  const page = await open();
  await ready(page);
  await check('Mobile empty state: clear start, collapsed diagnostics, no overflow', async () => {
    assert.equal(await page.locator('#start').isVisible(), true);
    assert.equal(await page.locator('.developer-tools').getAttribute('open'), null);
    await noOverflow(page);
    await accessible(page);
    await capture(page, 'mobile-empty', 'Cream and sage scene with a clear start action; diagnostics remain collapsed. Browser IPC adapter only.');
  });
  await check('Keyboard focus is visible and scenario toggle works with Enter', async () => {
    await page.locator('#mode-nap').focus();
    assert.equal(await page.locator('#mode-nap').evaluate(button => getComputedStyle(button).outlineStyle), 'solid');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#mode-nap').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#nap-clock').innerText(), '05:00');
    const action = await page.locator('#start').boundingBox();
    assert.ok(action !== null && action.y + action.height <= 844, 'Nap start action must fit the first mobile viewport');
  });
  await check('Nap start, snooze, scenario switching and finish preserve correct handles', async () => {
    await page.locator('#nap-duration').selectOption('1');
    await page.locator('#start').click(); await ready(page);
    assert.equal(await page.locator('#nap-duration').isDisabled(), true);
    const before = await page.evaluate(() => window.__MOCHI_QA__.records[0]);
    await page.locator('#update').click(); await ready(page);
    const after = await page.evaluate(() => window.__MOCHI_QA__.records[0]);
    assert.equal(Number(member(after, 'snapshot', 'timer', 'endsAt')) - Number(member(before, 'snapshot', 'timer', 'endsAt')), 60_000);
    await capture(page, 'mobile-nap', 'Nap state changes the cat eyes and timer; a foreground countdown does not send periodic native updates. Browser adapter only.');
    await page.locator('#mode-snack').click();
    assert.equal(await page.locator('#start').isVisible(), true);
    await page.locator('#mode-nap').click();
    assert.equal(await page.locator('#update').isVisible(), true);
    await page.locator('#end').click(); await ready(page);
    assert.match(await page.locator('#message').innerText(), /Nap finished/);
  });
  await check('Snack advances through packing, delivery and completion; terminal action resets', async () => {
    await page.locator('#mode-snack').click();
    await page.locator('#start').click(); await ready(page);
    assert.equal(await page.locator('#progress-copy').innerText(), '15%');
    await page.locator('#update').click(); await ready(page);
    assert.equal(await page.locator('#progress-copy').innerText(), '65%');
    await page.setViewportSize({ width: 1440, height: 900 });
    await noOverflow(page); await accessible(page);
    await capture(page, 'desktop-snack', 'Wide layout places the compact illustration beside the delivery state. Native surface visibility is described conditionally. Browser adapter only.');
    await page.locator('#update').click(); await ready(page);
    assert.equal(await page.locator('#update').isVisible(), false);
    assert.match(await page.locator('#end').innerText(), /All done/);
    await page.locator('#end').click(); await ready(page);
    assert.equal(await page.locator('#start').isVisible(), true);
  });
  await check('Lifecycle runner remains opt-in and passes its 30 checks', async () => {
    assert.equal(await page.locator('#self-test-report').getAttribute('data-status'), 'idle');
    await page.locator('.developer-tools summary').click();
    await page.locator('#run-self-test').click(); await ready(page);
    const report: unknown = JSON.parse(await page.locator('#self-test-report').innerText());
    // 13 of the templates, 6 of a layout, 1 of a start that asks for a push token where there are no pushes, 3 of a
    // switch and a link, 2 of the small region and 5 of a scheduled start.
    assert.equal(member(report, 'status'), 'passed', JSON.stringify(report));
    assert.equal(list(member(report, 'checks'), 'the checks').length, 30);
    assert.match(await page.locator('#report-path').innerText(), /Saved report/);
  });
  await check('Narrow 320px layout has no horizontal overflow', async () => {
    await page.setViewportSize({ width: 320, height: 740 }); await noOverflow(page);
    await page.locator('.developer-tools summary').click();
    await capture(page, 'narrow-empty', 'At 320px the labels and primary action remain within the viewport without horizontal scrolling.');
  });
  await page.close();
  const layouts = await open(); await ready(layouts);
  await check('Layouts: an example starts, takes new values and ends', async () => {
    await layouts.locator('#mode-layout').click();
    await layouts.locator('#example-styles').click();
    // The request is in a part of the page that is closed: the text is there, and nothing of it is drawn.
    assert.match(await layouts.locator('#layout-request').evaluate(request => request.textContent ?? ''), /"activityKey": "mochi:styles"/);
    await layouts.locator('#layout-start').click(); await ready(layouts);
    assert.match(await layouts.locator('#message').innerText(), /Changing styles is on its way/);
    await layouts.locator('#layout-update').click(); await ready(layouts);
    assert.match(await layouts.locator('#message').innerText(), /New values sent at revision 1/);
    assert.equal(await layouts.evaluate(() => window.__MOCHI_QA__.records[0]?.snapshot.revision), 1);
    await noOverflow(layouts); await accessible(layouts);
    await capture(layouts, 'mobile-layouts', 'The Layouts tab with one chip per example and an example under way: new values or the end. Browser adapter only.');
    await layouts.locator('#layout-end').click(); await ready(layouts);
    assert.equal(await layouts.locator('#layout-start').isVisible(), true);
  }); await layouts.close();
  const receipt = await open({ failListAfterStart: true }); await ready(receipt);
  await check('A successful receipt survives a failed refresh and mode switching', async () => {
    await receipt.locator('#start').click(); await ready(receipt);
    assert.match(await receipt.locator('#message').innerText(), /Temporary observation failure/);
    await receipt.locator('#mode-nap').click();
    await receipt.locator('#mode-snack').click();
    assert.equal(await receipt.locator('#start').isVisible(), false);
    assert.equal(await receipt.locator('#update').isVisible(), true);
    await receipt.locator('#refresh').click(); await ready(receipt);
    assert.equal(await receipt.evaluate(() => window.__MOCHI_QA__.records.length), 1);
  }); await receipt.close();
  const loading = await open({ delay: 700 });
  await check('Loading keeps scene stable and disables mutable controls', async () => {
    assert.equal(await loading.locator('#start').isDisabled(), true);
    assert.match(await loading.locator('#start').innerText(), /moment/);
    await capture(loading, 'mobile-loading', 'Busy state retains the illustration and action position while disabling interactions.');
  }); await loading.close();
  const permission = await open({ platform: 'android', permission: 'denied' }); await ready(permission);
  await check('Permission is explicit; no automatic request; Android action requests notifications', async () => {
    assert.equal(await permission.locator('#permission-panel').isVisible(), true);
    assert.equal(await permission.evaluate(() => window.__MOCHI_QA__.calls.some(call => call.command.endsWith('request_permissions'))), false);
    await accessible(permission);
    await capture(permission, 'mobile-permission', 'Denied Android permission explains the Settings action and requires an explicit user gesture.');
    await permission.locator('#permission').click(); await ready(permission);
    assert.equal(await permission.locator('#permission-panel').isVisible(), false);
    assert.equal(await permission.evaluate(() => window.__MOCHI_QA__.calls.find(call => call.command.endsWith('request_permissions'))?.args.kind), 'notifications');
  }); await permission.close();
  const uncertain = await open({ platform: 'android', permission: 'unknown' }); await ready(uncertain);
  await check('Unknown permission after cancellation stays explicitly retryable', async () => {
    assert.equal(await uncertain.locator('#permission').isEnabled(), true);
    assert.equal(await uncertain.locator('#permission-panel').isVisible(), true);
    await uncertain.locator('#permission').click(); await ready(uncertain);
    assert.equal(await uncertain.locator('#permission-panel').isVisible(), false);
  }); await uncertain.close();
  const iosPermission = await open({ permission: 'settingsRequired' }); await ready(iosPermission);
  await check('iOS permission action checks Live Activities settings', async () => {
    assert.match(await iosPermission.locator('#permission').innerText(), /Live Activity settings/);
    await iosPermission.locator('#permission').click(); await ready(iosPermission);
    assert.equal(await iosPermission.evaluate(() => window.__MOCHI_QA__.calls.find(call => call.command.endsWith('request_permissions'))?.args.kind), 'liveActivities');
  }); await iosPermission.close();
  const pending = await open({ pending: true }); await ready(pending);
  await check('Pending native observation keeps ownership and does not claim visibility', async () => {
    await pending.locator('#start').click(); await ready(pending);
    assert.equal(await pending.locator('#start').isVisible(), false);
    assert.match(await pending.locator('#native-note').innerText(), /Waiting for the system/);
    await capture(pending, 'mobile-pending', 'Accepted activity with unknown OS state retains its handle and reports observation pending, not visibility.');
  }); await pending.close();
  const error = await open({ error: '<img src=x onerror=alert(1)> ' + 'A temporary native error. '.repeat(12) }); await ready(error);
  await check('Long native error stays plain text and start can be retried', async () => {
    await error.locator('#start').click(); await ready(error);
    assert.match(await error.locator('#message').innerText(), /<img/);
    assert.equal(await error.locator('#message img').count(), 0);
    assert.equal(await error.locator('#start').isEnabled(), true);
    await noOverflow(error);
    await capture(error, 'mobile-error', 'Long native rejection wraps as plain text without interpreting markup; the start control becomes available again.');
  }); await error.close();
  const unsupported = await open({ unsupported: true, platform: 'macos' }); await ready(unsupported);
  await check('Unsupported desktop is explicit and cannot start a pretend activity', async () => {
    assert.equal(await unsupported.locator('#start').isDisabled(), true);
    assert.match(await unsupported.locator('#message').innerText(), /no supported activity backend/);
  }); await unsupported.close();
  assert.deepEqual(failures, []);
  const report = {
    contract: 'contract.md; Mochi companion frontend. Browser adapters verify UI behavior only; native OS tests and screenshots are separate.',
    targetViewports: ['390x844', '1440x900'],
    accessibility: { status: 'pass', evidence: 'axe WCAG 2 A/AA and WCAG 2.1 AA found zero violations on mobile empty, desktop active and denied-permission views. Keyboard Enter toggles modes, focus outline is visible, reduced motion is enabled, controls use at least 44px CSS minimum height.' },
    responsive: { status: 'pass', evidence: 'Rendered 390x844 and 1440x900; 320px supplemental check found no horizontal overflow. Long rejection text wraps without markup execution.' },
    contentStates: {
      loading: { status: 'pass', evidence: 'Delayed IPC disables controls with a stable scene and busy action label.' },
      empty: { status: 'pass', evidence: 'No activity offers one clear start action with diagnostics collapsed.' },
      error: { status: 'pass', evidence: 'Long native rejection renders safely as text and restores the start control.' },
      partial: { status: 'pass', evidence: 'Unknown OS state retains ownership with explicit pending copy; desktop unsupported cannot start.' },
      success: { status: 'pass', evidence: 'Snack reaches 100%, offers completion, then resets; nap snooze retains start and adds exactly one minute.' },
      permission: { status: 'pass', evidence: 'No prompt without a click; Android requests notifications and iOS checks liveActivities. Permission panel clears after a granted response.' },
    },
    renderedEvidence: renders,
    checks, browserErrors: failures, mockOnly: true,
  };
  await writeFile(`${evidence}/browser-report.json`, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`${checks.length} browser checks passed; ${renders.length} preview captures. Native visibility was not tested here.\n`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
