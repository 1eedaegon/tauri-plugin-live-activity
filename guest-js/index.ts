import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ActionEvent, ActivityRecord, Capabilities, EndInput, LayoutActivityRecord, LayoutEndInput, LayoutStartInput,
  LayoutUpdateInput, OpenedEvent, PermissionKind, Permissions, PushToStartTokenEvent, PushTokenEvent, PushTokens,
  StartInput, StartedEvent, StateEvent, UpdateInput, UpdatedEvent,
} from './types.js';

export type * from './types.js';
/** Builders for the nodes of a layout tree. */
export * as layout from './layout.js';

/** Read backend features; this does not request OS permissions. */
export function getCapabilities(): Promise<Capabilities> {
  return invoke('plugin:live-activity|get_capabilities', {});
}

/** Read current OS permission states without showing a permission prompt. */
export function checkPermissions(): Promise<Permissions> {
  return invoke('plugin:live-activity|check_permissions', {});
}

/** Request an OS permission where supported; settings-only controls report that state. */
export function requestPermissions(kind: PermissionKind): Promise<Permissions> {
  return invoke('plugin:live-activity|request_permissions', { kind });
}

/** Start an activity; repeated identical starts for an active key are idempotent. */
export function start(input: StartInput): Promise<ActivityRecord> {
  return invoke('plugin:live-activity|start', { input });
}

/** Replace the entire snapshot with a newer revision. */
export function update(input: UpdateInput): Promise<ActivityRecord> {
  return invoke('plugin:live-activity|update', { input });
}

/** End this generation. A late update cannot revive it. */
export function end(input: EndInput): Promise<ActivityRecord> {
  return invoke('plugin:live-activity|end', { input });
}

/** Reconcile plugin-owned records with the OS; unknown is a valid observed state. */
export function list(): Promise<readonly ActivityRecord[]> {
  return invoke('plugin:live-activity|list', {});
}

/** Start a layout activity (contract v2); repeated identical starts for an active key are idempotent. */
export function startLayout(input: LayoutStartInput): Promise<LayoutActivityRecord> {
  return invoke('plugin:live-activity|start_layout', { input });
}

/** Replace every value with a newer revision; the layout stays as started. */
export function updateLayout(input: LayoutUpdateInput): Promise<LayoutActivityRecord> {
  return invoke('plugin:live-activity|update_layout', { input });
}

/** End this layout generation, with final content when `snapshot` is given. A late update cannot revive it. */
export function endLayout(input: LayoutEndInput): Promise<LayoutActivityRecord> {
  return invoke('plugin:live-activity|end_layout', { input });
}

/** Reconcile plugin-owned layout records with the OS; `list` reports contract v1 activities. */
export function listLayout(): Promise<readonly LayoutActivityRecord[]> {
  return invoke('plugin:live-activity|list_layout', {});
}

/**
 * Write a PNG that `image` nodes with the source `{ file: name }` show, replacing one of that name. The widget
 * reads it each time it draws the activity, on start and on every update, so write the picture first and then
 * update. At most 1 MiB and 1224 x 480 pixels (`PAYLOAD_TOO_LARGE` beyond). On iOS it needs the App Group
 * that `setup --app-group` configures (`CONFIGURATION_REQUIRED` without one), where activitykit writes it to
 * `activitykit/images`; on Android the first such image
 * becomes the notification's large icon.
 */
export function writeImage(name: string, png: Uint8Array | ArrayBuffer): Promise<void> {
  const bytes = png instanceof Uint8Array ? png : new Uint8Array(png);
  return invoke('plugin:live-activity|write_image', { input: { name, png: Array.from(bytes) } });
}

/**
 * Receive button taps while this webview is alive; resolves to the function that stops listening.
 * Listening uses Tauri's event permissions (`core:event:default`). The tap reaches the page after the Rust
 * `on_action` handlers have run; the tap's intent does not wait for this handler, which runs in the webview whenever it
 * gets the event, and not at all while the webview is suspended or was never created. Act on taps in Rust when they
 * must not be lost.
 */
export function onAction(handler: (event: ActionEvent) => void): Promise<UnlistenFn> {
  return listen<ActionEvent>('live-activity://action', event => handler(event.payload));
}

/**
 * The push tokens the plugin holds since launch (iOS): the newest token of each of the last 32 activities that got
 * one, and the app's push-to-start token. The events report each token as it comes, but an event reaches only the
 * listeners there are when it goes out, and a token may come before the page listens, at launch above all:
 * `onPushToken` and `onPushToStartToken` read this right after subscribing. Empty where there are no pushes. The
 * read is in the plugin's `default` permission.
 */
export function pushTokens(): Promise<PushTokens> {
  return invoke('plugin:live-activity|push_tokens');
}

/**
 * Receive the push token of each activity that asked for one (`push: 'token'`), when ActivityKit gives it and each
 * time it changes (iOS), and first those the plugin already holds, each token once. Send it to the server, which
 * pushes to it with activitykit's `push::Payload`. Rejects, subscribed to nothing, when the plugin cannot be asked
 * for the tokens it holds.
 */
export async function onPushToken(handler: (event: PushTokenEvent) => void): Promise<UnlistenFn> {
  const delivered = new Map<string, string>();
  const deliver = (event: PushTokenEvent): void => {
    if (delivered.get(event.activityId) === event.token) return;
    delivered.set(event.activityId, event.token);
    handler(event);
  };
  const unlisten = await listen<PushTokenEvent>('live-activity://push-token', event => deliver(event.payload));
  const held = await heldTokens(unlisten);
  // An event that came while the plugin was asked is newer than what it held for that activity.
  for (const event of held.activities) if (!delivered.has(event.activityId)) deliver(event);
  return unlisten;
}

/**
 * Receive the app's push-to-start token, with `pushToStart: true` in the plugin configuration (iOS 17.2), when the
 * system gives it and each time it changes, and first the one the plugin already holds, each token once. The server
 * starts activities with it. Rejects, subscribed to nothing, when the plugin cannot be asked for the token it holds.
 */
export async function onPushToStartToken(handler: (event: PushToStartTokenEvent) => void): Promise<UnlistenFn> {
  let last: string | undefined;
  const deliver = (event: PushToStartTokenEvent): void => {
    if (event.token === last) return;
    last = event.token;
    handler(event);
  };
  const unlisten = await listen<PushToStartTokenEvent>('live-activity://push-to-start-token', event => deliver(event.payload));
  const held = await heldTokens(unlisten);
  if (last === undefined && held.pushToStart !== undefined) deliver({ token: held.pushToStart });
  return unlisten;
}

/** What the plugin holds, or the subscription given up and the failure passed on. */
async function heldTokens(unlisten: UnlistenFn): Promise<PushTokens> {
  try {
    return await pushTokens();
  } catch (error) {
    unlisten();
    throw error;
  }
}

/**
 * Receive the record of an activity whose content a push changed (iOS): content above every revision this app sent
 * or accepted, so the app's own updates do not come this way. Content pushed before the page listened is in the
 * activity's record, as `listLayout` gives it.
 */
export function onUpdated(handler: (event: UpdatedEvent) => void): Promise<UnlistenFn> {
  return listen<UpdatedEvent>('live-activity://updated', event => handler(event.payload));
}

/**
 * Receive the record of a layout activity that began while the app ran (iOS): one the app started, or one a push
 * started with the app's push-to-start token. An activity that began before the page listened is in `listLayout`.
 */
export function onStarted(handler: (event: StartedEvent) => void): Promise<UnlistenFn> {
  return listen<StartedEvent>('live-activity://started', event => handler(event.payload));
}

/**
 * Receive each new lifecycle state of an activity, of a template or a layout. iOS reports the changes ActivityKit
 * tells of while the app runs. Android reports where an activity stands when the plugin looks, each state once:
 * `active` once Android shows the notification, `stale` after the snapshot's `staleAt`, `ended` and `dismissed`.
 * The plugin looks with every start, update, end and list, when Android stores a tap or a dismissal, and at the
 * stale time of an activity while the app runs. A state that came while the app did not run is reported when it
 * starts. An activity is over at `ended` and at `dismissed`: an end that removes an activity at once may be reported
 * as `dismissed` alone.
 */
export function onState(handler: (event: StateEvent) => void): Promise<UnlistenFn> {
  return listen<StateEvent>('live-activity://state', event => handler(event.payload));
}

/** What the plugin answers when it is asked for the openings: those that wait, oldest first, and the newest one's number. */
interface WaitingOpenings {
  readonly openings: readonly OpenedEvent[];
  /** The number of the newest opening the plugin has kept. It numbers them in their order, from 1. */
  readonly through: number;
}

/** The handlers of this page for openings. They share one subscription. */
const openingHandlers = new Set<(event: OpenedEvent) => void>();
/** The page's subscription to the event that says an opening came, while the page has handlers. */
let openingEvents: Promise<UnlistenFn> | undefined;
/** The questions of this page to the plugin, one after another, so that the openings keep their order. */
let openingTakes: Promise<void> = Promise.resolve();
/** The number of the newest opening that this page has handed to its handlers. */
let openingsHanded = 0;
/** The number up to which this page has told the plugin to let the openings go. */
let openingsLetGo = 0;

/**
 * Hands `opening` to `handler`. A handler that throws is reported, as the browser reports a listener that throws,
 * and keeps the opening from nobody else.
 */
function hand(handler: (event: OpenedEvent) => void, opening: OpenedEvent): void {
  try {
    handler(opening);
  } catch (error) {
    const report = (globalThis as { reportError?: (error: unknown) => void }).reportError;
    if (typeof report === 'function') report(error);
    else console.error(error);
  }
}

/**
 * Asks the plugin for the openings that wait and hands each new one to the handlers there are, until none is left.
 * Every question also says how far this page has handed them over, and the plugin lets those go. So an opening
 * that no handler got stays with the plugin, for a handler that comes later or for the page that loads next.
 */
function takeOpenings(): Promise<void> {
  const taken = openingTakes.then(async () => {
    let answered = false;
    // With nobody to hand to, the plugin is only told what it may let go.
    while (openingHandlers.size > 0 || openingsLetGo < openingsHanded) {
      const handed = openingsHanded;
      let waiting: WaitingOpenings;
      try {
        waiting = await invoke<WaitingOpenings>('plugin:live-activity|openings', { taken: handed });
      } catch (error) {
        // Once the plugin has answered, a question that fails only leaves it for the next one to say what was
        // handed over.
        if (answered) return;
        throw error;
      }
      answered = true;
      openingsLetGo = Math.max(openingsLetGo, handed);
      const first = waiting.through - waiting.openings.length + 1;
      for (const [index, opening] of waiting.openings.entries()) {
        // The plugin answers what comes after `handed`. One that this page has handed over is not handed again.
        if (first + index <= openingsHanded) continue;
        if (openingHandlers.size === 0) break;
        // A handler that another one unsubscribed meanwhile is not called.
        for (const handler of [...openingHandlers]) if (openingHandlers.has(handler)) hand(handler, opening);
        openingsHanded = first + index;
      }
      if (openingsHanded === handed) return;
    }
  });
  // A question that failed does not stop the next one: what it left still waits in the plugin.
  openingTakes = taken.catch(() => undefined);
  return taken;
}

/**
 * Receive each opening of the app from the notification of an activity (Android): which activity the person
 * opened it from, and by which action when it was one that opens a URL. The URL itself comes to the app as any deep
 * link. iOS hands the URL to the app and reports nothing here.
 *
 * The opening that launched the app is reported before the page has loaded, so the plugin keeps every opening until
 * a page has handed it to a handler, the newest 16. The handler first gets those that waited, oldest first, and
 * then each one as it comes, each once: subscribe when the page starts. The handlers of a page share the openings;
 * one that subscribes later gets what is handed over from then on. Rejects, subscribed to nothing, when the plugin
 * does not answer the first question for what waits.
 */
export async function onOpened(handler: (event: OpenedEvent) => void): Promise<UnlistenFn> {
  // A function may subscribe twice: each subscription is its own and ends alone.
  const subscribed = (event: OpenedEvent): void => handler(event);
  const leave = (): void => {
    if (!openingHandlers.delete(subscribed) || openingHandlers.size > 0) return;
    const events = openingEvents;
    openingEvents = undefined;
    void events?.then(unlisten => unlisten()).catch(() => undefined);
  };
  openingHandlers.add(subscribed);
  try {
    // The event says that an opening came. The plugin hands it over when it is asked.
    openingEvents ??= listen<OpenedEvent>('live-activity://opened', () => { void takeOpenings().catch(() => undefined); });
    await openingEvents;
    await takeOpenings();
  } catch (error) {
    leave();
    throw error;
  }
  return leave;
}

/**
 * Receive the permissions after the person changed them in Settings (iOS): Live Activities turned on or off, or
 * frequent pushes. `checkPermissions` gives them at any time.
 */
export function onPermissions(handler: (permissions: Permissions) => void): Promise<UnlistenFn> {
  return listen<Permissions>('live-activity://permissions', event => handler(event.payload));
}
