// `useLiveActivity`: one layout activity kept in step with a React component. Only this entry imports React.
import { useEffect, useRef, useState } from 'react';
import { endLayout, onAction, onPushToken, onUpdated, startLayout, updateLayout } from '../index.js';
import type { ActionEvent } from '../types.js';
import { IDLE, Session, type LiveActivityState, type SessionOptions } from './session.js';

export type { LiveActivityState, LiveActivityStatus } from './session.js';

export interface UseLiveActivityOptions extends SessionOptions {
  /** Taps on the buttons of this activity; taps of other activities are not passed on. */
  readonly onAction?: (event: ActionEvent) => void;
}

const commands = { startLayout, updateLayout, endLayout };

/**
 * Starts a layout activity on mount, sends `values` as an update whenever they change, and ends the activity on
 * unmount or when `enabled` turns false. The state carries the activity's push token and takes content a push
 * delivered (iOS).
 */
export function useLiveActivity(options: UseLiveActivityOptions): LiveActivityState {
  const [state, setState] = useState<LiveActivityState>(IDLE);
  const session = useRef<Session | null>(null);
  if (session.current === null) session.current = new Session(commands, setState);
  const handler = useRef(options.onAction);
  handler.current = options.onAction;
  const listening = options.onAction !== undefined;

  useEffect(() => {
    session.current?.sync(options);
  });

  useEffect(() => {
    const current = session.current;
    // Strict Mode unmounts and mounts again at once: the end waits for a microtask, which the mount cancels.
    current?.keep();
    return () => current?.release();
  }, []);

  useEffect(() => {
    let open = true;
    const stops = [
      onPushToken((event) => { if (open) session.current?.token(event); }),
      onUpdated((event) => { if (open) session.current?.pushed(event); }),
    ];
    return () => {
      open = false;
      for (const stop of stops) stop.then((unlisten) => unlisten(), () => {});
    };
  }, []);

  useEffect(() => {
    if (!listening) return undefined;
    let open = true;
    const stop = onAction((event) => {
      const running = session.current?.activityId;
      if (open && running !== undefined && event.activityId === running) handler.current?.(event);
    });
    return () => {
      open = false;
      stop.then((unlisten) => unlisten(), () => {});
    };
  }, [listening]);

  return state;
}
