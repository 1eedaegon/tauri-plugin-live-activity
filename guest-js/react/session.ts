// One layout activity kept in step with what a component wants, one request at a time. Framework-free:
// the hook in index.ts feeds it the options of each render.
import type {
  EndPolicy, ErrorCode, Fallback, Layout, LayoutActivityRecord, LayoutAndroidOptions, LayoutEndInput,
  LayoutStartInput, LayoutStyle, LayoutUpdateInput, LayoutValues, LiveActivityError,
} from '../types.js';

export interface SessionOptions {
  /** The app's key of the activity; another key ends the running activity and starts one for it. */
  readonly activityKey: string;
  /** Read at start: a change while the activity runs is not sent, since the layout is fixed for a generation. */
  readonly layout: Layout;
  /** The values to show; a render with other values sends them as an update. */
  readonly values: LayoutValues;
  /** Read at start. */
  readonly styles?: { readonly [token: string]: LayoutStyle };
  /** Read at start. Defaults to `notification`. */
  readonly fallback?: Fallback;
  /** Read at start. */
  readonly android?: LayoutAndroidOptions;
  /** False ends the activity, and true starts it again. Defaults to true. */
  readonly enabled?: boolean;
  /** How the activity ends on unmount or when `enabled` turns false. Defaults to `{ kind: 'immediate' }`. */
  readonly endPolicy?: EndPolicy;
}

export type LiveActivityStatus = 'idle' | 'starting' | 'active' | 'ending' | 'ended' | 'failed';

export interface LiveActivityState {
  readonly status: LiveActivityStatus;
  /** The plugin's newest record of the activity. */
  readonly record: LayoutActivityRecord | undefined;
  /** The last refusal; an accepted request clears it. */
  readonly error: LiveActivityError | undefined;
}

/** The commands the session sends. */
export interface SessionCommands {
  readonly startLayout: (input: LayoutStartInput) => Promise<LayoutActivityRecord>;
  readonly updateLayout: (input: LayoutUpdateInput) => Promise<LayoutActivityRecord>;
  readonly endLayout: (input: LayoutEndInput) => Promise<LayoutActivityRecord>;
}

export const IDLE: LiveActivityState = Object.freeze({ status: 'idle', record: undefined, error: undefined });
const IMMEDIATE: EndPolicy = Object.freeze({ kind: 'immediate' });

export class Session {
  private state = IDLE;
  private wanted: SessionOptions | undefined;
  private endPolicy: EndPolicy = IMMEDIATE;
  /** The running activity of this generation, and the values and revision it last took. */
  private running: { readonly record: LayoutActivityRecord; readonly values: LayoutValues; readonly revision: number } | undefined;
  /** Values that an update was refused with: not sent again until they change. */
  private refused: LayoutValues | undefined;
  /** The key whose start was refused: not started again until `enabled` turns off or the key changes. */
  private failedKey: string | undefined;
  private busy = false;
  private mounts = 0;

  constructor(private readonly commands: SessionCommands, private readonly changed: (state: LiveActivityState) => void) {}

  /** The id of the running activity. */
  get activityId(): string | undefined {
    return this.running?.record.id;
  }

  /** The options of a render. */
  sync(options: SessionOptions): void {
    this.endPolicy = options.endPolicy ?? IMMEDIATE;
    if (options.enabled === false) {
      this.wanted = undefined;
      this.failedKey = undefined;
    } else {
      this.wanted = options;
    }
    this.pump();
  }

  /** The component is gone: the activity ends, now or once the request in flight has answered. */
  dispose(): void {
    this.wanted = undefined;
    this.pump();
  }

  /** The component mounted, also again in Strict Mode. */
  keep(): void {
    this.mounts += 1;
  }

  /** The component unmounted: it is disposed after a microtask, unless it mounts again before (Strict Mode). */
  release(): void {
    const mount = this.mounts;
    queueMicrotask(() => {
      if (this.mounts === mount) this.dispose();
    });
  }

  private pump(): void {
    if (this.busy) return;
    const wanted = this.wanted;
    const running = this.running;
    if (running && wanted?.activityKey !== running.record.activityKey) return this.end(running.record);
    if (!wanted) return;
    if (!running) {
      if (wanted.activityKey !== this.failedKey) this.start(wanted);
      return;
    }
    if (!sameValues(wanted.values, running.values) && !sameValues(wanted.values, this.refused)) {
      this.update(running, wanted.values);
    }
  }

  private start(options: SessionOptions): void {
    const input: LayoutStartInput = {
      activityKey: options.activityKey,
      schemaVersion: 2,
      fallback: options.fallback ?? 'notification',
      layout: options.layout,
      snapshot: { revision: 0, values: options.values },
      ...(options.styles === undefined ? {} : { styles: options.styles }),
      ...(options.android === undefined ? {} : { android: options.android }),
    };
    this.failedKey = undefined;
    this.refused = undefined;
    this.set({ status: 'starting', record: undefined, error: undefined });
    this.send(this.commands.startLayout(input), (record) => {
      this.running = { record, values: options.values, revision: 0 };
      this.set({ status: 'active', record, error: undefined });
    }, (error) => {
      this.failedKey = options.activityKey;
      this.set({ status: 'failed', record: undefined, error });
    });
  }

  private update(running: NonNullable<Session['running']>, values: LayoutValues): void {
    // Every attempt takes the next revision, so a refused one is never reused.
    const revision = running.revision + 1;
    this.running = { ...running, revision };
    this.send(this.commands.updateLayout({ id: running.record.id, snapshot: { revision, values } }), (record) => {
      this.refused = undefined;
      this.running = { record, values, revision };
      this.set({ status: 'active', record, error: undefined });
    }, (error) => {
      this.refused = values;
      this.set({ ...this.state, error });
    });
  }

  private end(record: LayoutActivityRecord): void {
    this.set({ status: 'ending', record, error: this.state.error });
    this.send(this.commands.endLayout({ id: record.id, policy: this.endPolicy }), (ended) => {
      this.running = undefined;
      this.set({ status: 'ended', record: ended, error: undefined });
    }, (error) => {
      // Not tried again: the activity is left to the system.
      this.running = undefined;
      this.set({ status: 'failed', record, error });
    });
  }

  private send(request: Promise<LayoutActivityRecord>, accepted: (record: LayoutActivityRecord) => void,
    refused: (error: LiveActivityError) => void): void {
    this.busy = true;
    request.then(accepted, (error: unknown) => refused(asError(error))).finally(() => {
      this.busy = false;
      this.pump();
    });
  }

  private set(state: LiveActivityState): void {
    this.state = state;
    this.changed(state);
  }
}

function sameValues(a: LayoutValues, b: LayoutValues | undefined): boolean {
  if (b === undefined) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

/** The plugin rejects with `{ code, message }`; anything else reads as a `NATIVE_ERROR`. */
function asError(error: unknown): LiveActivityError {
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === 'string' && typeof message === 'string') return { code: code as ErrorCode, message };
  }
  return { code: 'NATIVE_ERROR', message: error instanceof Error ? error.message : String(error) };
}
