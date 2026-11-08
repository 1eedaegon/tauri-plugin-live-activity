import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../contracts/request.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ strict: true, allErrors: true, ownProperties: true });
const isLayout = (command) => typeof command === 'string' && command.endsWith('_layout');
// One view of the schema per contract version, so that a request is reported against its own version only.
const view = (layout) => ajv.compile({
  ...schema,
  $id: `${schema.$id}:${layout ? 'layout' : 'v1'}-commands`,
  oneOf: schema.oneOf.filter(({ properties }) => isLayout(properties.command.const) === layout),
});
const validateV1Shape = view(false);
const validateLayoutShape = view(true);

const MAX_WEIGHT = 3584;
const MAX_DEPTH = 8;
const MAX_BUTTONS = 4;
const MAX_TIME = 8640000000000000;
// Region below layout, most nodes, whether it may hold buttons.
const REGIONS = [
  ['lockScreen', 40, true],
  ['island/expanded/leading', 12, true],
  ['island/expanded/trailing', 12, true],
  ['island/expanded/center', 12, true],
  ['island/expanded/bottom', 12, true],
  ['island/compactLeading', 3, false],
  ['island/compactTrailing', 3, false],
  ['island/minimal', 3, false],
];
const REFERENCES = ['if', 'unless', 'bind', 'variableBind', 'start', 'end'];
const isTime = (number) => Number.isInteger(number) && number >= 0 && number <= MAX_TIME;
// The numbers a reference may name, beyond being a number.
const RANGES = {
  variableBind: [(number) => number >= 0 && number <= 1, 'must name a number from 0 to 1'],
  start: [isTime, `must name an integer from 0 to ${MAX_TIME}`],
  end: [isTime, `must name an integer from 0 to ${MAX_TIME}`],
};
const { colorName, fontWeight, hex } = schema.$defs;
const HEX = new RegExp(hex.pattern);
const isColor = (value) => colorName.enum.includes(value) || (typeof value === 'string' && HEX.test(value));
const between = (low, high) => (value) => typeof value === 'number' && value >= low && value <= high;
// The value a bound member names must be what the member takes as a literal; a color cannot be a
// light and dark pair, because a value is a string, a number or a boolean.
const COLOR = [isColor, 'must name a color value'];
const BINDABLE = {
  color: COLOR,
  background: COLOR,
  tint: COLOR,
  size: [between(6, 96), 'must name a number from 6 to 96'],
  opacity: [between(0, 1), 'must name a number from 0 to 1'],
  cornerRadius: [between(0, 64), 'must name a number from 0 to 64'],
  weight: [(value) => fontWeight.enum.includes(value), 'must name a font weight value'],
};
const ARITY = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, Z: 0 };
const NUMBER = String.raw`[+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?`;
const GAP = String.raw`[ \t\r\n]*`;
const SEGMENT = new RegExp(`${GAP}([MLHVCSQTZmlhvcsqtz])${GAP}(${NUMBER}(?:${GAP}(?:,${GAP})?${NUMBER})*)?${GAP}`, 'y');
const NUMBERS = new RegExp(NUMBER, 'g');
// Value keys and style tokens are input, so an issue path never spells them.
const ENTRY = /^(\/input\/(?:snapshot\/values|styles))\/[^/]+/;
// The same for the props of a custom node, wherever the node is.
const PROP = /(\/props)\/[^/]+/g;
// JSON can carry a lone UTF-16 surrogate as an escape, but a Rust or Swift string cannot hold one.
const LONE_SURROGATE = 'must not contain a lone surrogate';
const hasLoneSurrogate = (text) => typeof text === 'string' && !text.isWellFormed();
const TOO_HEAVY = { valid: false, issues: [{ path: '/input', message: `must weigh at most ${MAX_WEIGHT}` }] };

/** Development reference validator. Does not call Tauri or any OS API. */
export function validateRequest(request) {
  const layout = isLayout(request?.command);
  const validateShape = layout ? validateLayoutShape : validateV1Shape;
  let shaped;
  try {
    shaped = validateShape(request);
  } catch (error) {
    // The node schema is recursive, so a far too deep tree overflows the stack.
    if (!(error instanceof RangeError)) throw error;
    return { valid: false, issues: [{ path: '', message: 'must not be nested this deeply' }] };
  }
  if (!shaped) {
    return {
      valid: false,
      issues: validateShape.errors.map(({ instancePath, message }) => ({
        path: instancePath.replace(ENTRY, '$1/*').replace(PROP, '$1/*'),
        message,
      })),
    };
  }

  if (layout) return validateLayout(request);
  if (request.command === 'end') return { valid: true, issues: [] };
  const { timer } = request.input.snapshot;
  if (timer && timer.endsAt <= timer.startedAt) {
    return {
      valid: false,
      issues: [{ path: '/input/snapshot/timer/endsAt', message: 'must be later than startedAt' }],
    };
  }

  return { valid: true, issues: [] };
}

/** Payload weight of a JSON string, number, boolean, array or object, as docs/request-contract.md defines it. */
export function weight(value) {
  if (typeof value === 'string') return Buffer.byteLength(value) + 2;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 5;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + weight(item) + 1, 2);
  return Object.entries(value).reduce((sum, [key, item]) => sum + Buffer.byteLength(key) + 3 + weight(item) + 1, 2);
}

function validateLayout({ command, input }) {
  const issues = [];
  if (hasLoneSurrogate(input.id)) issues.push({ path: '/input/id', message: LONE_SURROGATE });
  if (Object.values(input.snapshot?.values ?? {}).some(hasLoneSurrogate)) {
    issues.push({ path: '/input/snapshot/values/*', message: LONE_SURROGATE });
  }
  if (command === 'start_layout') issues.push(...layoutIssues(input));
  // The weight is checked last, and only on a request that breaks no other rule.
  if (issues.length > 0) return { valid: false, issues };
  if (command === 'end_layout') return { valid: true, issues };
  const layoutWeight = command === 'start_layout' ? weight(input.layout) + weight(input.styles ?? {}) : 0;
  if (layoutWeight + weight(input.snapshot.values) > MAX_WEIGHT) return structuredClone(TOO_HEAVY);
  return { valid: true, issues };
}

/**
 * Development reference of the check the native layer makes on `update_layout`: `update` against the
 * `start_layout` input of its activity. The values keep the keys and types of the start, meet the rules of
 * the stored layout and styles, bound members included, and weigh at most 3584 with them. A start or an
 * update that fails on its own gets the result of `validateRequest`.
 */
export function validateLayoutUpdate(start, update) {
  for (const request of [{ command: 'start_layout', input: start }, { command: 'update_layout', input: update }]) {
    const result = validateRequest(request);
    if (!result.valid) return result;
  }
  const before = start.snapshot.values;
  const { values } = update.snapshot;
  const kept = Object.keys(values).length === Object.keys(before).length
    && Object.entries(values).every(([key, value]) => Object.hasOwn(before, key) && typeof value === typeof before[key]);
  if (!kept) return { valid: false, issues: [{ path: '/input/snapshot/values', message: 'must keep the keys and types of the start' }] };
  const issues = layoutIssues({ ...start, snapshot: update.snapshot });
  if (issues.length > 0) return { valid: false, issues };
  if (weight(start.layout) + weight(start.styles ?? {}) + weight(values) > MAX_WEIGHT) return structuredClone(TOO_HEAVY);
  return { valid: true, issues: [] };
}

function layoutIssues({ layout, styles = {}, snapshot: { values } }) {
  const issues = [];
  const report = (path, message) => {
    issues.push({ path, message });
  };
  const isNumber = (key) => typeof values[key] === 'number';

  for (const [region, mostNodes, buttonsAllowed] of REGIONS) {
    const root = region.split('/').reduce((part, key) => part?.[key], layout);
    if (!root) continue;
    const top = `/input/layout/${region}`;
    const count = { nodes: 0, buttons: 0 };
    const visit = (node, path, depth, inButton) => {
      // The walk stops here, so its depth stays bounded however deep the tree is.
      if (depth > MAX_DEPTH) return report(path, `must be at most ${MAX_DEPTH} levels deep`);
      count.nodes += 1;
      if (node.type === 'button') {
        count.buttons += 1;
        if (!buttonsAllowed) report(path, 'must not be a button in this region');
        if (inButton) report(path, 'must not be inside a button');
      }
      if (node.style !== undefined && !Object.hasOwn(styles, node.style)) report(`${path}/style`, 'must name a style');
      if (node.type === 'text' && hasLoneSurrogate(node.value)) report(`${path}/value`, LONE_SURROGATE);
      for (const member of REFERENCES) {
        const key = node[member];
        if (key === undefined) continue;
        const numeric = member !== 'if' && member !== 'unless' && node.type !== 'text';
        const [fits, outside] = RANGES[member] ?? [() => true];
        if (!Object.hasOwn(values, key)) report(`${path}/${member}`, 'must name a value');
        else if (numeric && !isNumber(key)) report(`${path}/${member}`, 'must name a number value');
        else if (numeric && !fits(values[key])) report(`${path}/${member}`, outside);
      }
      const timed = node.type === 'timerText' && isNumber(node.start) && isNumber(node.end);
      if (timed && values[node.end] <= values[node.start]) report(`${path}/end`, 'must name a value later than start');
      if (node.type === 'gauge' && !((node.min ?? 0) < (node.max ?? 1))) report(path, 'must have min below max');
      if (node.type === 'path' && !isPathData(node.d)) report(`${path}/d`, 'must be valid SVG path data');
      // A prop is a literal or a binding; prop names are input, so the path does not spell them.
      for (const prop of Object.values(node.props ?? {})) {
        if (typeof prop === 'object' && !Object.hasOwn(values, prop.bind)) report(`${path}/props/*`, 'must name a value');
        if (hasLoneSurrogate(prop)) report(`${path}/props/*`, LONE_SURROGATE);
      }
      node.children?.forEach((child, index) => visit(child, `${path}/children/${index}`, depth + 1, inButton));
      if (node.child) visit(node.child, `${path}/child`, depth + 1, true);
    };
    visit(root, top, 1, false);
    if (count.nodes > mostNodes) report(top, `must have at most ${mostNodes} nodes`);
    if (count.buttons > MAX_BUTTONS) report(top, `must have at most ${MAX_BUTTONS} buttons`);
  }

  // Bound members, in every style whether a node uses it or not.
  const bound = (path, member, given) => {
    if (typeof given !== 'object' || !Object.hasOwn(given, 'bind')) return;
    const [fits, outside] = BINDABLE[member];
    if (!Object.hasOwn(values, given.bind)) report(path, 'must name a value');
    else if (!fits(values[given.bind])) report(path, outside);
  };
  for (const tint of ['background', 'keyline']) bound(`/input/layout/${tint}`, 'color', layout[tint]);
  for (const style of Object.values(styles)) {
    for (const member of Object.keys(BINDABLE)) bound(`/input/styles/*/${member}`, member, style[member]);
  }
  return issues;
}

function isPathData(d) {
  let at = 0;
  while (at < d.length) {
    SEGMENT.lastIndex = at;
    const [, command = '', numbers = ''] = SEGMENT.exec(d) ?? [];
    const arity = ARITY[command.toUpperCase()];
    const count = numbers.match(NUMBERS)?.length ?? 0;
    const complete = arity === 0 ? count === 0 : count > 0 && count % arity === 0;
    if (!complete || (at === 0 && command.toUpperCase() !== 'M')) return false;
    at = SEGMENT.lastIndex;
  }
  return at > 0;
}
