import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import fixtures from './fixtures/layout-requests.json' with { type: 'json' };
import v1Fixtures from './fixtures/requests.json' with { type: 'json' };
import { validateLayoutUpdate, validateRequest, weight } from '../tools/validate-request.mjs';

const LOCK = '/input/layout/lockScreen';
const ISLAND = '/input/layout/island';
const WEIGHT_MESSAGE = 'must weigh at most 3584';
const TOO_HEAVY = [['/input', WEIGHT_MESSAGE]];
const TIME = 'must name an integer from 0 to 8640000000000000';
const LONE_SURROGATE = 'must not contain a lone surrogate';
const layout = (tree, values = {}, rest = {}) => ({
  command: 'start_layout',
  input: { activityKey: 'demo:1', schemaVersion: 2, fallback: 'none', layout: tree, snapshot: { revision: 0, values }, ...rest },
});
const start = (lockScreen, values, rest) => layout({ lockScreen }, values, rest);
const COLOR = 'must name a color value';
/** A literal text in the style `s`. */
const styled = (style, values) => start({ type: 'text', value: 'a', style: 's' }, values, { styles: { s: style } });
const update = (values) => ({ command: 'update_layout', input: { id: 'opaque-handle-1', snapshot: { revision: 1, values } } });
const text = (value = 'a', rest = {}) => ({ type: 'text', value, ...rest });
const stack = (children) => ({ type: 'vstack', children });
const button = (child = text()) => ({ type: 'button', actionId: 'pause', child });
const nested = (levels, leaf = text()) => (levels ? stack([nested(levels - 1, leaf)]) : leaf);
const chain = (levels) => {
  let node = text();
  for (let level = 0; level < levels; level += 1) node = stack([node]);
  return node;
};
const repeat = (count, make = text) => Array.from({ length: count }, () => make());
const heavy = { a: 'x'.repeat(1000), b: 'x'.repeat(1000), c: 'x'.repeat(1000), d: 'x'.repeat(600) };
const issues = (pairs) => pairs.map(([path, message]) => ({ path, message }));
const weigh = ({ layout: tree, styles = {}, snapshot }) => (tree ? weight(tree) + weight(styles) : 0) + weight(snapshot.values);
const codeOf = (result) => (result.issues.some(({ message }) => message === WEIGHT_MESSAGE) ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT');

test('fixture names are unique and every start and update states its weight', () => {
  const cases = [...fixtures.valid, ...fixtures.invalid, ...fixtures.updates];
  assert.equal(new Set(cases.map(({ name }) => name)).size, cases.length);
  for (const { name, command, weight: stated } of fixtures.valid) assert.equal(Number.isInteger(stated), command !== 'end_layout', name);
  assert.ok(fixtures.updates.length >= 20);
  for (const { name, weight: stated, code } of fixtures.updates) assert.equal(Number.isInteger(stated), code === undefined, name);
});

for (const { name, command, input, weight: stated } of fixtures.valid) {
  test(name, () => {
    assert.deepEqual(validateRequest({ command, input }), { valid: true, issues: [] });
    if (command !== 'end_layout') assert.equal(weigh(input), stated);
  });
}

for (const { name, command, input, code } of fixtures.invalid) {
  test(name, () => {
    const result = validateRequest({ command, input });
    assert.equal(result.valid, false);
    assert.notEqual(result.issues.length, 0);
    assert.equal(codeOf(result), code, JSON.stringify(result.issues));
  });
}

// A start and the update after it: the update is checked against the stored layout and styles.
for (const { name, start: started, update: next, weight: stated, code } of fixtures.updates) {
  test(name, () => {
    assert.deepEqual(validateRequest({ command: 'start_layout', input: started }), { valid: true, issues: [] });
    const result = validateLayoutUpdate(started, next);
    if (code === undefined) {
      assert.deepEqual(result, { valid: true, issues: [] });
      assert.equal(weight(started.layout) + weight(started.styles ?? {}) + weight(next.snapshot.values), stated);
    } else {
      assert.equal(result.valid, false);
      assert.notEqual(result.issues.length, 0);
      assert.equal(codeOf(result), code, JSON.stringify(result.issues));
    }
  });
}

test('answers with a result at every depth once the schema code is warm', () => {
  // After the fixture cases the schema walk copes with deeper trees than in a cold process, so the
  // checks that follow it meet those trees too.
  for (let levels = 1000; levels <= 4000; levels += 100) {
    const result = validateRequest(start(chain(levels)));
    assert.equal(result.valid, false, `${levels}`);
    assert.equal(result.issues.length, 1, `${levels}`);
  }
});

for (const [name, request, expected] of [
  ['a bind that names no value', start({ type: 'text', bind: 'title' }), [[`${LOCK}/bind`, 'must name a value']]],
  ['conditions that name no value', start(stack([text('a', { if: 'on' }), text('b', { unless: 'off' })])), [
    [`${LOCK}/children/0/if`, 'must name a value'], [`${LOCK}/children/1/unless`, 'must name a value'],
  ]],
  ['a symbol variable and timer bounds that name no value', start(stack([{ type: 'symbol', name: 'wifi', variableBind: 'level' }, { type: 'timerText', start: 'from', end: 'to' }])), [
    [`${LOCK}/children/0/variableBind`, 'must name a value'], [`${LOCK}/children/1/start`, 'must name a value'], [`${LOCK}/children/1/end`, 'must name a value'],
  ]],
  ['binds that need a number', start(stack([
    { type: 'progress', bind: 'word' }, { type: 'gauge', bind: 'flag' }, { type: 'symbol', name: 'wifi', variableBind: 'word' },
    { type: 'timerText', start: 'word', end: 'flag' },
  ]), { word: '1', flag: true }), [
    [`${LOCK}/children/0/bind`, 'must name a number value'], [`${LOCK}/children/1/bind`, 'must name a number value'],
    [`${LOCK}/children/2/variableBind`, 'must name a number value'], [`${LOCK}/children/3/start`, 'must name a number value'],
    [`${LOCK}/children/3/end`, 'must name a number value'],
  ]],
  ['symbol variables outside 0..1', start(stack([
    { type: 'symbol', name: 'wifi', variableBind: 'low' }, { type: 'symbol', name: 'wifi', variableBind: 'high' },
  ]), { low: -0.5, high: 1.5 }), [
    [`${LOCK}/children/0/variableBind`, 'must name a number from 0 to 1'], [`${LOCK}/children/1/variableBind`, 'must name a number from 0 to 1'],
  ]],
  ['timer bounds that are negative or fractional', start({ type: 'timerText', start: 'from', end: 'to' }, { from: -1, to: 0.5 }), [
    [`${LOCK}/start`, TIME], [`${LOCK}/end`, TIME],
  ]],
  ['a timer that ends when it starts', start({ type: 'timerText', start: 'from', end: 'to' }, { from: 5, to: 5 }), [[`${LOCK}/end`, 'must name a value later than start']]],
  ['a timer that ends before it starts', start({ type: 'timerText', start: 'from', end: 'to' }, { from: 5, to: 4 }), [[`${LOCK}/end`, 'must name a value later than start']]],
  ['a style that names no style', start(text('a', { style: 'title' }), {}, { styles: { body: { size: 12 } } }), [[`${LOCK}/style`, 'must name a style']]],
  ['a style without a style table', start(text('a', { style: 'title' })), [[`${LOCK}/style`, 'must name a style']]],
  ['a gauge whose min equals its max', start({ type: 'gauge', bind: 'g', min: 2, max: 2 }, { g: 2 }), [[LOCK, 'must have min below max']]],
  ['a gauge min at the default max', start({ type: 'gauge', bind: 'g', min: 1 }, { g: 2 }), [[LOCK, 'must have min below max']]],
  ['a gauge max at the default min', start({ type: 'gauge', bind: 'g', max: 0 }, { g: 2 }), [[LOCK, 'must have min below max']]],
  ['path data with an incomplete command', start({ type: 'path', d: 'M0 0L1', box: [8, 8] }), [[`${LOCK}/d`, 'must be valid SVG path data']]],
  ['a node at level 9', start(nested(8)), [[`${LOCK}${'/children/0'.repeat(8)}`, 'must be at most 8 levels deep']]],
  ['a button child at level 9', start(nested(7, button())), [[`${LOCK}${'/children/0'.repeat(7)}/child`, 'must be at most 8 levels deep']]],
  ['the first node below level 8 only', start(nested(10)), [[`${LOCK}${'/children/0'.repeat(8)}`, 'must be at most 8 levels deep']]],
  ['41 nodes in the lock screen', start(stack([stack(repeat(12)), stack(repeat(12)), stack(repeat(12)), text()])), [[LOCK, 'must have at most 40 nodes']]],
  ['too many nodes in every island region', layout({
    lockScreen: text(),
    island: {
      expanded: { leading: stack(repeat(12)), trailing: stack(repeat(12)), center: stack(repeat(12)), bottom: stack(repeat(12)) },
      compactLeading: stack(repeat(3)), compactTrailing: stack(repeat(3)), minimal: stack(repeat(3)),
    },
  }), [
    [`${ISLAND}/expanded/leading`, 'must have at most 12 nodes'], [`${ISLAND}/expanded/trailing`, 'must have at most 12 nodes'],
    [`${ISLAND}/expanded/center`, 'must have at most 12 nodes'], [`${ISLAND}/expanded/bottom`, 'must have at most 12 nodes'],
    [`${ISLAND}/compactLeading`, 'must have at most 3 nodes'], [`${ISLAND}/compactTrailing`, 'must have at most 3 nodes'],
    [`${ISLAND}/minimal`, 'must have at most 3 nodes'],
  ]],
  ['buttons outside the lock screen and the expanded regions', layout({
    lockScreen: button(),
    island: { expanded: { center: button() }, compactLeading: button(), compactTrailing: stack([button()]), minimal: button() },
  }), [
    [`${ISLAND}/compactLeading`, 'must not be a button in this region'], [`${ISLAND}/compactTrailing/children/0`, 'must not be a button in this region'],
    [`${ISLAND}/minimal`, 'must not be a button in this region'],
  ]],
  ['a button inside a button', start(button(stack([button()]))), [[`${LOCK}/child/children/0`, 'must not be inside a button']]],
  ['a fifth button in the lock screen', start(stack(repeat(5, button))), [[LOCK, 'must have at most 4 buttons']]],
  ['a fifth button in an expanded region', layout({ lockScreen: text(), island: { expanded: { bottom: stack(repeat(5, button)) } } }), [
    [`${ISLAND}/expanded/bottom`, 'must have at most 4 buttons'],
  ]],
  ['broken references inside an island region and a button', layout({
    lockScreen: button({ type: 'text', bind: 'title' }),
    island: { expanded: { bottom: stack([{ type: 'progress', bind: 'p', style: 'bar' }]) } },
  }), [
    [`${LOCK}/child/bind`, 'must name a value'], [`${ISLAND}/expanded/bottom/children/0/style`, 'must name a style'],
    [`${ISLAND}/expanded/bottom/children/0/bind`, 'must name a value'],
  ]],
  ['a bound style member that names no value', styled({ color: { bind: 'tone' } }, {}), [['/input/styles/*/color', 'must name a value']]],
  ['bound members whose values do not fit', layout({ lockScreen: text('a', { style: 's' }), background: { bind: 'paper' }, keyline: { bind: 'edge' } }, {
    tone: 'crimson', fill: 1, accent: '#FFF', points: 5, alpha: 2, radius: 65, weight: 'Bold', paper: true, edge: 'sky',
  }, { styles: { s: {
    color: { bind: 'tone' }, background: { bind: 'fill' }, tint: { bind: 'accent' }, size: { bind: 'points' }, opacity: { bind: 'alpha' },
    cornerRadius: { bind: 'radius' }, weight: { bind: 'weight' },
  } } }), [
    ['/input/layout/background', COLOR], ['/input/layout/keyline', COLOR], ['/input/styles/*/color', COLOR],
    ['/input/styles/*/background', COLOR], ['/input/styles/*/tint', COLOR], ['/input/styles/*/size', 'must name a number from 6 to 96'],
    ['/input/styles/*/opacity', 'must name a number from 0 to 1'], ['/input/styles/*/cornerRadius', 'must name a number from 0 to 64'],
    ['/input/styles/*/weight', 'must name a font weight value'],
  ]],
  ['a bound member of a style that no node uses', start(text('a'), { alpha: -1 }, { styles: { unused: { opacity: { bind: 'alpha' } } } }), [
    ['/input/styles/*/opacity', 'must name a number from 0 to 1'],
  ]],
  ['a custom prop binding that names no value', start({ type: 'custom', name: 'ring', props: { level: { bind: 'bowl' }, width: 2 } }), [
    [`${LOCK}/props/*`, 'must name a value'],
  ]],
  ['a lone surrogate in a custom prop', start(stack([{ type: 'custom', name: 'ring', props: { label: 'a\ud800' } }])), [
    [`${LOCK}/children/0/props/*`, LONE_SURROGATE],
  ]],
  ['a lone surrogate in a value', update({ note: 'a\ud800' }), [['/input/snapshot/values/*', LONE_SURROGATE]]],
  ['a lone surrogate in a literal text', start(text('\udc00')), [[`${LOCK}/value`, LONE_SURROGATE]]],
  ['a lone surrogate in an update id', { command: 'update_layout', input: { id: '\ud800', snapshot: { revision: 1, values: {} } } }, [['/input/id', LONE_SURROGATE]]],
  ['a lone surrogate in an end id', { command: 'end_layout', input: { id: 'a\udc00b', policy: { kind: 'default' } } }, [['/input/id', LONE_SURROGATE]]],
  ['a start that is too heavy', start(text(), heavy), TOO_HEAVY],
  ['an update that is too heavy', update(heavy), TOO_HEAVY],
  ['every broken rule but not the weight', start(stack([{ type: 'text', bind: 'absent' }, text('a', { style: 'none' })]), heavy), [
    [`${LOCK}/children/0/bind`, 'must name a value'], [`${LOCK}/children/1/style`, 'must name a style'],
  ]],
]) {
  test(`reports ${name}`, () => assert.deepEqual(validateRequest(request), { valid: false, issues: issues(expected) }));
}

for (const [d, valid] of [
  ['M1e5.5', true], ['M-1-2', true], ['M1.5.5', true], ['m0 0', true], ['M0 0zm1 1', true], ['M0,0\tL1 1\n', true], ['M0 0E1', true],
  ['M1.5.5.5', false], ['M0 0,Z', false], ['Z', false], ['M0 0L', false], ['M0 0e', false], ['M0 0A1 1 0 0 1 2 2', false],
  ['M0 0 ſ1 2 3 4', false],
]) {
  test(`path data ${JSON.stringify(d)} is ${valid ? 'valid' : 'invalid'}`, () => {
    assert.equal(validateRequest(start({ type: 'path', d, box: [8, 8] })).valid, valid);
  });
}

test('reads values and styles as own members only', () => {
  assert.deepEqual(validateRequest(start({ type: 'text', bind: 'constructor', style: 'toString' })).issues, issues([
    [`${LOCK}/style`, 'must name a style'], [`${LOCK}/bind`, 'must name a value'],
  ]));
  const named = start({ type: 'progress', bind: 'valueOf', style: 'constructor' }, { valueOf: 0.5 }, { styles: { constructor: { size: 12 } } });
  assert.deepEqual(validateRequest(named), { valid: true, issues: [] });
});

test('update_layout checks its values without a layout', () => {
  assert.deepEqual(validateRequest(update({ word: 'a', flag: true, count: 1 })), { valid: true, issues: [] });
  assert.equal(validateRequest(update({ word: null })).valid, false);
});

const tone = styled({ color: { bind: 'tone' } }, { tone: 'green', note: 'a' });
// Values that fit alone, 3543, and not with the stored layout and styles, 90 more.
const roomy = styled({ color: { bind: 'tone' } }, { tone: 'green', a: '', b: '', c: '', d: '' });
const crowded = update({ tone: 'red', a: heavy.a, b: heavy.b, c: heavy.c, d: 'x'.repeat(500) });
for (const [name, started, next, expected] of [
  ['a bound color that no longer fits', tone, update({ tone: 'crimson', note: 'a' }), [['/input/styles/*/color', COLOR]]],
  ['a value that is gone', tone, update({ tone: 'red' }), [['/input/snapshot/values', 'must keep the keys and types of the start']]],
  ['a value that is new', tone, update({ tone: 'red', note: 'a', more: 1 }), [['/input/snapshot/values', 'must keep the keys and types of the start']]],
  ['a value of another type', tone, update({ tone: 'red', note: 1 }), [['/input/snapshot/values', 'must keep the keys and types of the start']]],
  ['a value that names an inherited member', tone, update({ tone: 'red', constructor: 'a' }), [
    ['/input/snapshot/values', 'must keep the keys and types of the start'],
  ]],
  ['values too heavy for the stored layout and styles', roomy, crowded, TOO_HEAVY],
  ['a start that is not valid', styled({ color: { bind: 'tone' } }, {}), update({}), [['/input/styles/*/color', 'must name a value']]],
]) {
  test(`the update check reports ${name}`, () => {
    assert.deepEqual(validateLayoutUpdate(started.input, next.input), { valid: false, issues: issues(expected) });
  });
}

test('the update check takes a valid update against a valid start', () => {
  assert.deepEqual(validateRequest(crowded), { valid: true, issues: [] });
  assert.equal(weight(roomy.input.layout) + weight(roomy.input.styles) + weight(crowded.input.snapshot.values), 3633);
  assert.deepEqual(validateLayoutUpdate(tone.input, update({ tone: '#C9654D', note: '' }).input), { valid: true, issues: [] });
  const plain = start({ type: 'text', bind: 'note' }, { note: 'a' });
  assert.deepEqual(validateLayoutUpdate(plain.input, update({ note: 'b' }).input), { valid: true, issues: [] });
});

test('the update check reports the issues of an update that breaks a rule of its own', () => {
  const broken = update({ tone: null, note: 'a' });
  const alone = validateRequest(broken);
  assert.equal(alone.valid, false);
  assert.deepEqual(validateLayoutUpdate(tone.input, broken.input), alone);
});

test('accepts surrogate pairs', () => {
  assert.deepEqual(validateRequest(start(text('😀'), { mood: '😀' })), { valid: true, issues: [] });
});

for (const [name, request] of [
  ['an unknown envelope field', { ...start(text()), extra: true }],
  ['a NaN value', update({ count: NaN })],
  ['an infinite value', update({ count: -Infinity })],
  ['an infinite gauge bound', start({ type: 'gauge', bind: 'g', max: Infinity }, { g: 1 })],
]) {
  test(`rejects ${name}`, () => assert.equal(validateRequest(request).valid, false));
}

test('rejects a tree too deep for the schema walk and keeps working', () => {
  const deep = chain(20000);
  const tooDeep = { valid: false, issues: [{ path: '', message: 'must not be nested this deeply' }] };
  assert.deepEqual(validateRequest(start(deep)), tooDeep);
  const v1 = validateRequest({ command: 'start', input: { ...start(text()).input, layout: { lockScreen: deep } } });
  assert.equal(v1.valid, false);
  assert.notDeepEqual(v1, tooDeep);
  assert.deepEqual(validateRequest(start(text())), { valid: true, issues: [] });
});

test('lets errors other than a stack overflow through', () => {
  const request = { get command() { throw new TypeError('getter'); }, input: {} };
  assert.throws(() => validateRequest(request), TypeError);
});

test('validates frozen requests without changing them', () => {
  const freeze = (value) => {
    if (value && typeof value === 'object') Object.values(value).forEach(freeze);
    return Object.freeze(value);
  };
  for (const { name, command, input } of [...fixtures.valid, ...fixtures.invalid]) {
    const request = freeze(structuredClone({ command, input }));
    const before = JSON.stringify(request);
    assert.doesNotThrow(() => validateRequest(request), name);
    assert.equal(JSON.stringify(request), before, name);
  }
  for (const { name, start: started, update: next } of fixtures.updates) {
    const pair = freeze(structuredClone({ started, next }));
    const before = JSON.stringify(pair);
    assert.doesNotThrow(() => validateLayoutUpdate(pair.started, pair.next), name);
    assert.equal(JSON.stringify(pair), before, name);
  }
});

test('error results survive a later validation and do not echo input', () => {
  const secret = 'sensitive';
  const results = [
    start({ type: 'text', bind: `${secret}_bind`, style: `${secret}_style` }),
    start({ type: 'text', bind: 'title', [`${secret}_member`]: secret }, { title: secret }),
    start(text(secret.repeat(30)), { [`${secret}_key`]: null, [`${secret} key`]: [secret] }),
    start(text('a', { if: `${secret}_condition` }), {}, { styles: { [`${secret}_token`]: { size: secret }, [`${secret} token`]: {} } }),
    start({ type: 'path', d: `M0 0 ${secret}`, box: [8, 8] }, { p: secret }, { activityKey: `${secret} key` }),
    start({ type: 'progress', bind: 'p' }, { p: secret }),
    update({ [`${secret}_key`]: { [secret]: secret } }),
    update({ [`${secret}_key`]: `${secret}\ud800` }),
    { command: 'end_layout', input: { id: secret, policy: { kind: secret } } },
    styled({ color: { bind: `${secret}_key` } }, {}),
    styled({ color: { bind: 'tone' } }, { tone: secret }),
    start({ type: 'custom', name: 'ring', props: { [`${secret}_prop`]: { bind: `${secret}_key` } } }),
    start({ type: 'custom', name: `${secret} view`, props: { [`${secret} prop`]: secret } }),
    start(stack([{ type: 'custom', name: 'ring', props: { [`${secret}_prop`]: null } }])),
  ].map(validateRequest);
  const red = styled({ color: { bind: 'tone' } }, { tone: 'red' }).input;
  results.push(validateLayoutUpdate(red, update({ tone: secret }).input), validateLayoutUpdate(red, update({ [`${secret}_key`]: 'red' }).input));
  const before = JSON.stringify(results);
  validateRequest(start(text()));
  assert.equal(JSON.stringify(results), before);
  assert.equal(results.every(({ valid }) => !valid), true);
  assert.equal(before.includes(secret), false);
  const paths = results.flatMap((result) => result.issues.map(({ path }) => path));
  for (const path of ['/input/snapshot/values/*', '/input/styles/*', '/input/styles/*/size', `${LOCK}/children/0/props/*`]) {
    assert.equal(paths.includes(path), true, path);
  }
});

test('weight follows the contract formula', () => {
  for (const [value, expected] of [
    ['', 2], ['abc', 5], ['한', 5], ['한'.normalize('NFD'), 11], ['😀', 6], ['"\\\n', 5],
    [0, 8], [-8640000000000000, 8], [0.1, 8], [true, 5], [false, 5],
    [[], 2], [[1], 11], [['a', true, 2], 21], [{}, 2], [{ a: 1 }, 15], [{ 가: '나' }, 14],
    [{ type: 'text', value: 'Hello' }, 32], [{ lockScreen: { type: 'text', value: 'Hello' } }, 48],
  ]) assert.equal(weight(value), expected, JSON.stringify(value));
});

test('v1 requests keep their issues', () => {
  const snapshot = { revision: 2, title: 'Timer', status: 'Running', timer: { startedAt: 20, endsAt: 10 } };
  assert.deepEqual(validateRequest({ command: 'update', input: { id: 'a', snapshot } }), {
    valid: false, issues: [{ path: '/input/snapshot/timer/endsAt', message: 'must be later than startedAt' }],
  });
  assert.deepEqual(validateRequest({ command: 'end', input: { id: 'a', policy: { kind: 'default' } } }), { valid: true, issues: [] });
  const lone = { ...snapshot, title: 'a\ud800', timer: { startedAt: 10, endsAt: 20 } };
  assert.deepEqual(validateRequest({ command: 'update', input: { id: 'a\ud800', snapshot: lone } }), { valid: true, issues: [] });
});

test('v1 requests report only the issues of contract v1', () => {
  // Issue counts as before contract v2: the layout definitions add none.
  const counts = {
    'rejects a partial update': 16, 'rejects reversed timer bounds': 1, 'rejects an unknown command': 14,
    'rejects a title containing only ECMAScript BOM whitespace': 17,
  };
  for (const { name, valid, request } of v1Fixtures) assert.equal(validateRequest(request).issues.length, valid ? 0 : counts[name], name);
  const [{ request }] = v1Fixtures;
  const { issues: found } = validateRequest({ ...request, input: { ...request.input, schemaVersion: 2 } });
  assert.equal(found.length, 16);
  assert.equal(found.some(({ message }) => /'(layout|values)'/.test(message)), false);
});

test('the fixture file holds JSON only as JSON.stringify writes it', () => {
  // The text without whitespace and with every string written as JSON.stringify writes it. A repeated
  // member or a number such as 1.0, 1e0, -0 or 1e-400 would differ from the parsed value written back.
  const normalized = (text) => {
    let out = '';
    for (let at = 0; at < text.length; at += 1) {
      if (text[at] === '"') {
        let end = at + 1;
        while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
        out += JSON.stringify(JSON.parse(text.slice(at, end + 1)));
        at = end;
      } else if (!/\s/.test(text[at])) out += text[at];
    }
    return out;
  };
  const source = readFileSync(new URL('./fixtures/layout-requests.json', import.meta.url), 'utf8');
  assert.equal(normalized(source), JSON.stringify(JSON.parse(source)));
  for (const odd of ['{"a":1,"a":2}', '{"a":1.0}', '{"a":-0}', '[1e-400]', '[1E1]']) {
    assert.notEqual(normalized(odd), JSON.stringify(JSON.parse(odd)), odd);
  }
});
