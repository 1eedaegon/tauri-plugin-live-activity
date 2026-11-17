// The summary that setup prints.
import type { SetupResult } from './setup.mjs';
import type { StepReport, StepStatus } from './steps.mjs';

const DONE = {
  created: 'created', updated: 'updated', removed: 'removed', ran: 'ran', kept: 'kept', skipped: 'skipped',
} satisfies Partial<Record<StepStatus, string>>;
const WOULD = {
  created: 'would create', updated: 'would update', removed: 'would remove', ran: 'would run', kept: 'would keep', skipped: 'would skip',
} satisfies Record<keyof typeof DONE, string>;

/** A step with a line of its own in the summary: one that changed something, or says why it did not. */
type ListedStep = StepReport & { readonly status: keyof typeof DONE };

const isListed = (item: StepReport): item is ListedStep => Object.hasOwn(DONE, item.status);

function line(item: ListedStep, dryRun: boolean): string {
  const label = (dryRun ? WOULD : DONE)[item.status];
  return `  ${label.padEnd(dryRun ? 12 : 8)} ${item.path}${item.detail ? ` (${item.detail})` : ''}`;
}

export function formatReport({ dryRun, version, steps, notes }: SetupResult): string {
  const shown = steps.filter(isListed);
  const todo = steps.filter(item => item.status === 'todo');
  const unchanged = steps.length - shown.length - todo.length;
  const lines = [`tauri-plugin-live-activity ${version} setup`, ''];
  if (dryRun) lines.push('Dry run: nothing was written.', '');
  if (shown.length === 0 && todo.length === 0) lines.push('Everything was set up already.');
  lines.push(...shown.map(item => line(item, dryRun)));
  if (shown.length > 0 && unchanged > 0) lines.push(`  ${unchanged} other ${unchanged === 1 ? 'step' : 'steps'} needed no change.`);
  if (todo.length > 0) lines.push('', 'To do:', ...todo.map(item => `  ${item.path}: ${item.detail}`));
  if (steps.some(item => item.status === 'updated' && item.path.endsWith('project.yml'))) {
    lines.push('', 'If src-tauri/gen/apple is ever made from scratch, run setup again: the new project.yml lacks the include.');
  }
  for (const note of notes) lines.push('', note.kind === 'register' ? `Next: ${note.text}` : note.text);
  return `${lines.join('\n')}\n`;
}
