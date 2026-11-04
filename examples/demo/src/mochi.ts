import type { ActivityRecord, Snapshot, StartInput } from '../../../guest-js/index.js';

export type MochiMode = 'snack' | 'nap';
export const snackSteps = ['Packing a tiny treat', 'On the way to Mochi', 'Snack time! Made it home'] as const;
const minute = 60_000;

export function snackStage(progress: number): number {
  return progress >= 1 ? 2 : progress >= 0.6 ? 1 : 0;
}

export function startMochiActivity(mode: MochiMode, now: number, napMinutes: number): StartInput {
  const common = { activityKey: `mochi:${mode}:${now}`, schemaVersion: 1 as const, fallback: 'notification' as const };
  if (mode === 'snack') {
    return { ...common, template: 'progress', snapshot: {
      revision: 0, title: 'Mochi’s snack delivery', status: snackSteps[0], progress: 0.15,
    } };
  }
  if (!Number.isInteger(napMinutes) || napMinutes < 1 || napMinutes > 60) {
    throw new Error('Choose a nap between 1 and 60 minutes.');
  }
  return { ...common, template: 'timer', snapshot: {
    revision: 0, title: 'Mochi’s nap', status: 'A little snooze, a little peace',
    timer: { startedAt: now, endsAt: now + napMinutes * minute },
  } };
}

export function advanceMochiActivity(current: Pick<ActivityRecord, 'snapshot'>): Snapshot {
  const snapshot = current.snapshot;
  const revision = snapshot.revision + 1;
  if (snapshot.timer !== undefined) {
    return { ...snapshot, revision, status: 'Just one more minute…',
      timer: { ...snapshot.timer, endsAt: snapshot.timer.endsAt + minute } };
  }
  const stage = Math.min(snackStage(snapshot.progress) + 1, 2);
  return { ...snapshot, revision, progress: stage === 1 ? 0.65 : 1, status: snackSteps[stage]! };
}

export function countdown(endsAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function selectMochiActivity(records: readonly ActivityRecord[], mode: MochiMode): ActivityRecord | undefined {
  return records.find(record => record.activityKey.startsWith(`mochi:${mode}:`)
    && record.state !== 'ended' && record.state !== 'dismissed');
}
