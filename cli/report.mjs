// The summary that setup prints.

const DONE = { created: 'created', updated: 'updated', ran: 'ran', kept: 'kept', skipped: 'skipped' };
const WOULD = { created: 'would create', updated: 'would update', ran: 'would run', kept: 'would keep', skipped: 'would skip' };

function line(item, dryRun) {
  const label = (dryRun ? WOULD : DONE)[item.status];
  return `  ${label.padEnd(dryRun ? 12 : 8)} ${item.path}${item.detail ? ` (${item.detail})` : ''}`;
}

export function formatReport({ dryRun, version, steps, notes }) {
  const shown = steps.filter(item => Object.hasOwn(DONE, item.status));
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
