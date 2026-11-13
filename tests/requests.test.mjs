import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixtures from './fixtures/requests.json' with { type: 'json' };
import { validateRequest } from '../tools/validate-request.mjs';

const start = fixtures[0].request;
const withInput = (patch) => ({ ...start, input: { ...start.input, ...patch } });
const withSnapshot = (patch) => withInput({ snapshot: { ...start.input.snapshot, ...patch } });
const alert = { title: 'Arrived', body: 'At the door', sound: 'chime.aiff' };

for (const fixture of fixtures) {
  test(fixture.name, () => {
    const result = validateRequest(fixture.request);
    assert.equal(result.valid, fixture.valid, JSON.stringify(result.issues));
    assert.equal(result.issues.length === 0, fixture.valid);
  });
}

for (const [name, request] of [
  ['null input', null],
  ['array input', []],
  ['missing fallback', withInput({ fallback: undefined })],
  ['unknown schema version', withInput({ schemaVersion: 2 })],
  ['unregistered template', withInput({ template: 'custom' })],
  ['template mismatch', withInput({ template: 'timer' })],
  ['empty key', withInput({ activityKey: '' })],
  ['overlong key', withInput({ activityKey: 'a'.repeat(129) })],
  ['path-shaped key', withInput({ activityKey: '../activity' })],
  ['trailing newline in key', withInput({ activityKey: 'activity\n' })],
  ['whitespace prefix in key', withInput({ activityKey: ' activity' })],
  ['unknown input field', withInput({ unsafePath: '/tmp/file' })],
  ['unknown envelope field', { ...start, extra: true }],
  ['unknown snapshot field', withSnapshot({ token: 'test-only' })],
  ['null progress', withSnapshot({ progress: null })],
  ['negative progress', withSnapshot({ progress: -0.1 })],
  ['excess progress', withSnapshot({ progress: 1.1 })],
  ['numeric string', withSnapshot({ progress: '0.5' })],
  ['NaN', withSnapshot({ progress: NaN })],
  ['infinity', withSnapshot({ progress: Infinity })],
  ['fractional revision', withSnapshot({ revision: 1.5 })],
  ['unsafe revision', withSnapshot({ revision: Number.MAX_SAFE_INTEGER + 1 })],
  ['negative revision', withSnapshot({ revision: -1 })],
  ['blank title', withSnapshot({ title: ' \n\t' })],
  ['empty status', withSnapshot({ status: '' })],
  ['overlong title', withSnapshot({ title: '😀'.repeat(121) })],
  ['overlong status', withSnapshot({ status: 'a'.repeat(241) })],
  ['fractional timestamp', withSnapshot({ staleAt: 0.5 })],
  ['invalid timestamp', withSnapshot({ staleAt: 8640000000000001 })],
  ['both presentations', withSnapshot({ timer: { startedAt: 0, endsAt: 1 } })],
  ['missing presentation', withSnapshot({ progress: undefined })],
  ['unknown end policy', { command: 'end', input: { id: 'a', policy: { kind: 'forever' } } }],
  ['missing after timestamp', { command: 'end', input: { id: 'a', policy: { kind: 'after' } } }],
  ['unexpected policy timestamp', { command: 'end', input: { id: 'a', policy: { kind: 'immediate', at: 0 } } }],
  ['empty handle', { command: 'end', input: { id: '', policy: { kind: 'default' } } }],
  ['overlong handle', { command: 'end', input: { id: 'a'.repeat(257), policy: { kind: 'default' } } }],
  // What the liveactivity crate takes beside a layout request is no part of a template's.
  ['the options of a layout start on iOS', withInput({ ios: { transient: true } })],
  ['a scheduled start', withInput({ scheduled: { at: 1793809500000, alert } })],
  ['the options of a layout start on Android', withInput({ android: { visibility: 'private', placement: 'foreground' } })],
  ['an alert with a start', withInput({ alert })],
  ['an alert with an update', { command: 'update', input: { id: 'a', snapshot: start.input.snapshot, alert } }],
  ['an alert with an end', { command: 'end', input: { id: 'a', policy: { kind: 'default' }, alert } }],
  ['a relevance in a snapshot', withSnapshot({ relevance: 80 })],
  ['an Android content in a snapshot', withSnapshot({ android: { title: 'a', status: 'b', presentation: { style: { kind: 'standard' } } } })],
]) {
  test(`rejects ${name}`, () => assert.equal(validateRequest(request).valid, false));
}

// TP-CONTRACT-5
test('accepts safe integer and Unicode length boundaries without changing input', () => {
  const snapshot = Object.freeze({
    ...start.input.snapshot, revision: Number.MAX_SAFE_INTEGER,
    title: '😀'.repeat(120), status: '한'.repeat(240), staleAt: 8640000000000000,
  });
  const input = Object.freeze({ ...start.input, activityKey: 'a'.repeat(128), snapshot });
  const request = Object.freeze({ ...start, input });
  const before = JSON.stringify(request);
  assert.deepEqual(validateRequest(request), { valid: true, issues: [] });
  assert.equal(JSON.stringify(request), before);
});

for (const [startedAt, endsAt, valid] of [[0, 1, true], [1, 1, false], [2, 1, false]]) {
  test(`timer bounds ${startedAt}..${endsAt} are ${valid ? 'valid' : 'invalid'}`, () => {
    const request = withInput({
      template: 'timer',
      snapshot: { revision: 0, title: 'Timer', status: 'Running', timer: { startedAt, endsAt } },
    });
    assert.equal(validateRequest(request).valid, valid);
  });
}

// TP-CONTRACT-5
test('error results survive a later validation and do not echo input values', () => {
  const result = validateRequest(withSnapshot({ progress: 'sensitive-test-value' }));
  const before = JSON.stringify(result);
  validateRequest(start);
  assert.equal(JSON.stringify(result), before);
  assert.equal(before.includes('sensitive-test-value'), false);
});
