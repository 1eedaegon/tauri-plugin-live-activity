// The live-editing page: one activity that follows card.tsx (docs/live-editing.md). Fast Refresh draws this component
// again when card.tsx changes, and the hook sends what changed.
import { useLiveActivity } from 'tauri-plugin-live-activity/react';
import { errorText, liveKey } from '../live-page.ts';
import { layout, styles, values } from './card.tsx';

interface LiveCardProps {
  /** Why ending what an earlier load left running failed, if it did. */
  readonly leftovers: string | undefined;
}

export function LiveCard({ leftovers }: LiveCardProps) {
  const activityKey = liveKey(layout, styles, values);
  const { status, record, error } = useLiveActivity({ activityKey, layout, styles, values });
  const refusal = error === undefined ? undefined : errorText(error);
  // An update raises it; a new activity starts again from 0.
  const revision = record === undefined ? '–' : String(record.snapshot.revision);
  return (
    <main className="live">
      <h1>Live editing</h1>
      <p>
        Edit <code>examples/demo/src/live/card.tsx</code> and save. New values update the running activity; a new layout,
        new styles, or a value added or of another type start another.
      </p>
      <dl>
        <dt>Activity</dt>
        <dd>{activityKey}</dd>
        <dt>State</dt>
        <dd aria-live="polite">{status}</dd>
        <dt>Revision</dt>
        <dd>{revision}</dd>
      </dl>
      {refusal === undefined ? null : <p role="alert">{refusal}</p>}
      {leftovers === undefined ? null : <p role="alert">What an earlier load left running was not ended: {leftovers}</p>}
    </main>
  );
}
