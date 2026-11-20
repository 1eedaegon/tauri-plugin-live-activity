// What the live-editing page does besides drawing (docs/live-editing.md): the activity key of a card, and the end of
// what an earlier load of the page left running.
import type {
  ActivityState, Layout, LayoutActivityRecord, LayoutEndInput, LayoutStyle, LayoutValues,
} from '../../../guest-js/index.js';

/** The keys of the page's activities begin with it, and no other activity's of the demo do. */
const PREFIX = 'live:';

/**
 * The key for a card: `live:` and eight hex digits of a hash of its layout, its styles and the names and types of its
 * values. A save that changes any of them gives another key, and `useLiveActivity` ends the running activity and
 * starts one with the new card: a layout is fixed for an activity's life, and an update keeps the names and types of
 * the values it started with (request contract v2). A save of other values of the same names and types keeps the key,
 * and the running activity takes them as an update.
 */
export function liveKey(
  layout: Layout, styles: { readonly [token: string]: LayoutStyle } | undefined, values: LayoutValues,
): string {
  const types = Object.fromEntries(Object.keys(values).map((name) => [name, typeof values[name]]));
  return `${PREFIX}${fnv1a(canonical({ layout, styles, types })).toString(16).padStart(8, '0')}`;
}

/** The commands `endLeftovers` sends: the plugin's own, or a test's. */
export interface LeftoverCommands {
  readonly listLayout: () => Promise<readonly LayoutActivityRecord[]>;
  readonly endLayout: (input: LayoutEndInput) => Promise<LayoutActivityRecord>;
}

const FINISHED: ReadonlySet<ActivityState> = new Set(['ended', 'dismissed']);

/**
 * Ends every activity of the page that still runs, and answers their ids. A load of the page (a save that Fast Refresh
 * cannot take in place, or the app started again) begins with a hook that knows of no activity, and a start under a
 * running activity's key with other values is a conflict (docs/request-contract.md); so each load starts from none.
 */
export async function endLeftovers(commands: LeftoverCommands): Promise<readonly string[]> {
  const records = await commands.listLayout();
  const running = records.filter((record) => record.activityKey.startsWith(PREFIX) && !FINISHED.has(record.state));
  // Every end is waited for, a refused one too: the card starts after this, and an end still under way would meet it.
  const ends = await Promise.allSettled(running.map((record) => commands.endLayout({ id: record.id, policy: { kind: 'immediate' } })));
  const refused = ends.find((end) => end.status === 'rejected');
  if (refused !== undefined) throw refused.reason;
  return running.map((record) => record.id);
}

/** A failure as the page shows it: the plugin refuses with `{ code, message }`; anything else as itself. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { readonly code?: unknown; readonly message?: unknown };
    if (typeof code === 'string' && typeof message === 'string') return `${code}: ${message}`;
  }
  return String(error);
}

/**
 * The JSON of a layout or its styles with the members of every object in key order, so that the order a literal was
 * written in does not count. A member that is undefined is left out, as JSON.stringify leaves it out.
 */
function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item: unknown) => canonical(item)).join(',')}]`;
  const object = value as { readonly [key: string]: unknown };
  const members = Object.keys(object).sort().filter((key) => object[key] !== undefined);
  return `{${members.map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

/** 32-bit FNV-1a over the UTF-16 code units: enough to tell two saves apart, not a security hash. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
