// One layout activity kept in step with what a component wants, one request at a time. Framework-free:
// the hook in index.ts feeds it the options of each render.
import type {
  EndPolicy, ErrorCode, Fallback, Layout, LayoutActivityRecord, LayoutAndroidOptions, LayoutEndInput, LayoutPush,
  LayoutStartInput, LayoutStyle, LayoutUpdateInput, LayoutValues, LiveActivityError, PushTokenEvent, UpdatedEvent,
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
  /** Read at start: what the activity asks ActivityKit for, a push token or a channel (iOS). */
  readonly push?: LayoutPush;
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
  /** The running activity's latest push token (iOS, with `push: 'token'`), until the activity ends. */
  readonly pushToken: string | undefined;
}

/** The commands the session sends. */
export interface SessionCommands {
  readonly startLayout: (input: LayoutStartInput) => Promise<LayoutActivityRecord>;
  readonly updateLayout: (input: LayoutUpdateInput) => Promise<LayoutActivityRecord>;
  readonly endLayout: (input: LayoutEndInput) => Promise<LayoutActivityRecord>;
}

export const IDLE: LiveActivityState = Object.freeze({ status: 'idle', record: undefined, error: undefined, pushToken: undefined });
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
  /** The latest push token of each activity seen, by id: one may come before the start it belongs to has answered. */
  private readonly tokens = new Map<string, string>();
  private busy = false;
  private mounts = 0;

  constructor(private readonly commands: SessionCommands, private readonly changed: (state: LiveActivityState) => void) {}

  /** The id of the running activity. */
  get activityId(): string | undefined {
    return this.running?.record.id;
  }

  /** A push token: the running activity's goes into the state; one that comes before its start answered waits. */
  token(event: PushTokenEvent): void {
    this.tokens.set(event.activityId, event.token);
    if (this.running?.record.id === event.activityId) this.set({ ...this.state, pushToken: event.token });
  }

  /**
   * Content a push delivered: the running activity's record takes it. The component's values stand as last sent, so
   * the pushed content stays until they change, and that change goes above the pushed revision.
   */
  pushed(event: UpdatedEvent): void {
    const { record } = event;
    if (!this.running || record.id !== this.running.record.id) return;
    this.running = { ...this.running, record, revision: record.snapshot.revision };
    this.set({ ...this.state, record });
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
      this.update(running, { ...wanted.values });
    }
  }

  private start(options: SessionOptions): void {
    // A copy: values that the caller changes in place are compared with what was sent, not with themselves.
    const values = { ...options.values };
    const input: LayoutStartInput = {
      activityKey: options.activityKey,
      schemaVersion: 2,
      fallback: options.fallback ?? 'notification',
      layout: options.layout,
      snapshot: { revision: 0, values },
      ...(options.styles === undefined ? {} : { styles: options.styles }),
      ...(options.android === undefined ? {} : { android: options.android }),
      ...(options.push === undefined ? {} : { push: options.push }),
    };
    this.failedKey = undefined;
    this.refused = undefined;
    this.set({ status: 'starting', record: undefined, error: undefined, pushToken: undefined });
    this.send(this.commands.startLayout(input), (record) => {
      this.running = { record, values, revision: 0 };
      this.set({ status: 'active', record, error: undefined, pushToken: this.tokens.get(record.id) });
    }, (error) => {
      // Blocks only the key still wanted: `enabled` off meanwhile, or another key, starts again.
      if (this.wanted?.activityKey === options.activityKey) this.failedKey = options.activityKey;
      this.set({ status: 'failed', record: undefined, error, pushToken: undefined });
    });
  }

  private update(running: NonNullable<Session['running']>, values: LayoutValues): void {
    // Every attempt takes the next revision, so a refused one is never reused.
    const revision = running.revision + 1;
    this.running = { ...running, revision };
    this.send(this.commands.updateLayout({ id: running.record.id, snapshot: { revision, values } }), (record) => {
      this.refused = undefined;
      this.running = { record, values, revision };
      this.set({ status: 'active', record, error: undefined, pushToken: this.state.pushToken });
    }, (error) => {
      this.refused = values;
      this.set({ ...this.state, error });
    });
  }

  private end(record: LayoutActivityRecord): void {
    this.set({ status: 'ending', record, error: this.state.error, pushToken: this.state.pushToken });
    this.tokens.delete(record.id);
    this.send(this.commands.endLayout({ id: record.id, policy: this.endPolicy }), (ended) => {
      this.running = undefined;
      this.set({ status: 'ended', record: ended, error: undefined, pushToken: undefined });
    }, (error) => {
      // Not tried again: the activity is left to the system.
      this.running = undefined;
      this.set({ status: 'failed', record, error, pushToken: undefined });
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
