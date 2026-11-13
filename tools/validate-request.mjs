import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../contracts/request.schema.json' with { type: 'json' };

// activitykit's schema says `if` a member is there `then` another is, without repeating the type and the properties
// around them, which two of Ajv's strict checks ask for; the others stay.
const ajv = new Ajv2020({ strict: true, strictRequired: false, strictTypes: false, allErrors: true, ownProperties: true });
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
// Buttons, links and toggles of one region, together.
const MAX_CONTROLS = 4;
const CONTROLS = ['button', 'link', 'toggle'];
const MAX_TIME = 8640000000000000;
// Region below layout, most nodes, whether it may hold buttons, links and toggles.
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
const { colorName, fileName, fontWeight, hex, url } = schema.$defs;
const HEX = new RegExp(hex.pattern);
const FILE_NAME = new RegExp(fileName.pattern);
const URL_FORM = new RegExp(url.pattern);
const isColor = (value) => colorName.enum.includes(value) || (typeof value === 'string' && HEX.test(value));
const isFileName = (value) => typeof value === 'string' && FILE_NAME.test(value);
const isUrl = (value) => typeof value === 'string' && value.length <= url.maxLength && URL_FORM.test(value);
const between = (low, high) => (value) => typeof value === 'number' && value >= low && value <= high;
// The value a bound member names must be what the member takes as a literal; a color cannot be a
// light and dark pair, because a value is a string, a number or a boolean.
const COLOR = [isColor, 'must name a color value'];
const LINK = [isUrl, 'must name a URL value'];
// A member of a node's accessibility reads a value of any type.
const SPOKEN = [() => true];
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

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** 1 to `max` code points, at least one of them not whitespace. */
const isText = (value, max) => typeof value === 'string' && [...value].length <= max && /\S/u.test(value) && value.isWellFormed();
/** Every member of `needed`, and beside them none but those of `optional`. */
const hasOnly = (value, needed, optional = []) => needed.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => needed.includes(key) || optional.includes(key));
const ANDROID_STYLES = ['standard', 'bigText', 'progress', 'timer', 'metric'];
const PLACEMENTS = ['tagged', 'foreground'];
const isAlert = (alert) => isRecord(alert) && hasOnly(alert, ['title', 'body'], ['sound']) && isText(alert.title, 120)
  && isText(alert.body, 240) && (!Object.hasOwn(alert, 'sound') || isFileName(alert.sound));
const isPublicVersion = (version) => isRecord(version) && hasOnly(version, ['title', 'status'])
  && isText(version.title, 120) && isText(version.status, 240);
// The members of an input that only the liveactivity crate takes, by command: what each must be, and what an issue says.
const BESIDE = {
  start_layout: {
    ios: [(ios) => isRecord(ios) && hasOnly(ios, ['transient']) && typeof ios.transient === 'boolean', 'must have transient, a boolean, and no other member'],
    scheduled: [
      (scheduled) => isRecord(scheduled) && hasOnly(scheduled, ['at', 'alert']) && isTime(scheduled.at) && isAlert(scheduled.alert),
      `must have a time from 0 to ${MAX_TIME} and an alert`,
    ],
  },
  update_layout: {
    alert: [isAlert, 'must have a title of 1 to 120 and a body of 1 to 240 characters, and for a sound the name of its file'],
  },
};

/** The value key that the liveactivity crate keeps for the templates of contract v1. */
const TEMPLATE_MARKER = 'liveActivityTemplate';

/**
 * What the liveactivity crate's contract takes beside activitykit's, whose schema this file compiles: a `relevance`
 * and an `android` content in a snapshot, an `alert` with an update, and with a start the options `ios`, a
 * `scheduled` time with its alert, and a `publicVersion` and a `placement` among the options `android`. They are
 * checked here and left out of the request that the schema sees; on another command they stay, and the schema
 * refuses them. Of an Android content this reference checks the outline; its presentation is the liveupdate
 * crate's, which the Rust side checks in full. That crate also keeps one value key to itself, which marks the
 * templates of contract v1 on iOS: a layout request has no value under it.
 */
function besideTheSchema(request) {
  const issues = [];
  if (!isLayout(request?.command) || !isRecord(request.input)) return { issues, request };
  const report = (path, message) => {
    issues.push({ path: `/input/${path}`, message });
  };
  const checks = BESIDE[request.command] ?? {};
  for (const [member, [fits, message]] of Object.entries(checks)) {
    if (Object.hasOwn(request.input, member) && !fits(request.input[member])) report(member, message);
  }
  const input = Object.fromEntries(Object.entries(request.input).filter(([member]) => !Object.hasOwn(checks, member)));
  const isStart = request.command === 'start_layout';
  // A start is private unless it says otherwise, and only a private activity has a public version.
  const isPrivate = !isRecord(input.android) || input.android.visibility === 'private';
  if (isStart && isRecord(input.android)) {
    const { publicVersion, placement, ...android } = input.android;
    if (Object.hasOwn(input.android, 'placement') && !PLACEMENTS.includes(placement)) report('android/placement', 'must be tagged or foreground');
    if (Object.hasOwn(input.android, 'publicVersion') && !(isPrivate && isPublicVersion(publicVersion))) {
      report('android/publicVersion', 'must have a title of 1 to 120 and a status of 1 to 240 characters, and the visibility private');
    }
    input.android = android;
  }
  if (isRecord(input.snapshot)) {
    const { relevance, android, ...snapshot } = input.snapshot;
    if (isRecord(snapshot.values) && Object.hasOwn(snapshot.values, TEMPLATE_MARKER)) {
      report(`snapshot/values/${TEMPLATE_MARKER}`, 'must not be a value key of a layout: it marks the templates');
    }
    if (Object.hasOwn(input.snapshot, 'relevance') && !Number.isFinite(relevance)) report('snapshot/relevance', 'must be a finite number');
    if (Object.hasOwn(input.snapshot, 'android')) {
      const valid = isRecord(android) && hasOnly(android, ['title', 'status', 'presentation'])
        && isText(android.title, 120) && isText(android.status, 240)
        && isRecord(android.presentation) && isRecord(android.presentation.style)
        && ANDROID_STYLES.includes(android.presentation.style.kind);
      if (!valid) report('snapshot/android', 'must have a title, a status and a presentation with a style');
      else if (isStart && !isPrivate && Object.hasOwn(android.presentation, 'publicVersion')) {
        report('snapshot/android/presentation/publicVersion', 'must come with the visibility private');
      }
    }
    input.snapshot = snapshot;
  }
  return { issues, request: { ...request, input } };
}

/** Development reference validator. Does not call Tauri or any OS API. */
export function validateRequest(given) {
  const { issues: beside, request } = besideTheSchema(given);
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

  if (beside.length > 0) return { valid: false, issues: beside };
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
  // An end without final content has no values to weigh.
  if (command === 'end_layout' && input.snapshot === undefined) return { valid: true, issues };
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

/**
 * Development reference of the check the native layer makes on `end_layout` with final content: `end` against the
 * `start_layout` input of its activity, as `validateLayoutUpdate` checks an update. An end without final content
 * gets the result of `validateRequest`.
 */
export function validateLayoutEnd(start, end) {
  const result = validateRequest({ command: 'end_layout', input: end });
  if (!result.valid || end.snapshot === undefined) return result;
  return validateLayoutUpdate(start, { id: end.id, snapshot: end.snapshot });
}

function layoutIssues({ layout, styles = {}, snapshot: { values } }) {
  const issues = [];
  const report = (path, message) => {
    issues.push({ path, message });
  };
  const isNumber = (key) => typeof values[key] === 'number';
  // A bound member names a value that fits what the member takes as a literal.
  const bound = (path, [fits, outside], given) => {
    if (typeof given !== 'object' || !Object.hasOwn(given, 'bind')) return;
    if (!Object.hasOwn(values, given.bind)) report(path, 'must name a value');
    else if (!fits(values[given.bind])) report(path, outside);
  };

  for (const [region, mostNodes, controlsAllowed] of REGIONS) {
    const root = region.split('/').reduce((part, key) => part?.[key], layout);
    if (!root) continue;
    const top = `/input/layout/${region}`;
    const count = { nodes: 0, controls: 0 };
    // `inside` is the type of the button, link or toggle that holds the node, if one does.
    const visit = (node, path, depth, inside) => {
      // The walk stops here, so its depth stays bounded however deep the tree is.
      if (depth > MAX_DEPTH) return report(path, `must be at most ${MAX_DEPTH} levels deep`);
      count.nodes += 1;
      if (CONTROLS.includes(node.type)) {
        count.controls += 1;
        if (!controlsAllowed) report(path, `must not be a ${node.type} in this region`);
        if (inside) report(path, `must not be inside a ${inside}`);
      }
      if (node.style !== undefined && !Object.hasOwn(styles, node.style)) report(`${path}/style`, 'must name a style');
      if (node.type === 'text' && hasLoneSurrogate(node.value)) report(`${path}/value`, LONE_SURROGATE);
      for (const member of REFERENCES) {
        const key = node[member];
        if (key === undefined) continue;
        // A condition and a text read a value of any type, a toggle shows a boolean, the others read a number.
        const flag = node.type === 'toggle' && member === 'bind';
        const numeric = !flag && member !== 'if' && member !== 'unless' && node.type !== 'text';
        const [fits, outside] = RANGES[member] ?? [() => true];
        if (!Object.hasOwn(values, key)) report(`${path}/${member}`, 'must name a value');
        else if (flag && typeof values[key] !== 'boolean') report(`${path}/${member}`, 'must name a boolean value');
        else if (numeric && !isNumber(key)) report(`${path}/${member}`, 'must name a number value');
        else if (numeric && !fits(values[key])) report(`${path}/${member}`, outside);
      }
      const timed = node.type === 'timerText' && isNumber(node.start) && isNumber(node.end);
      if (timed && values[node.end] <= values[node.start]) report(`${path}/end`, 'must name a value later than start');
      if (node.type === 'gauge' && !((node.min ?? 0) < (node.max ?? 1))) report(path, 'must have min below max');
      if (node.type === 'path' && !isPathData(node.d)) report(`${path}/d`, 'must be valid SVG path data');
      if (node.type === 'link') bound(`${path}/url`, LINK, node.url);
      for (const [member, spoken] of Object.entries(node.accessibility ?? {})) {
        bound(`${path}/accessibility/${member}`, SPOKEN, spoken);
        if (hasLoneSurrogate(spoken)) report(`${path}/accessibility/${member}`, LONE_SURROGATE);
      }
      // A prop is a literal or a binding; prop names are input, so the path does not spell them.
      for (const prop of Object.values(node.props ?? {})) {
        if (typeof prop === 'object' && !Object.hasOwn(values, prop.bind)) report(`${path}/props/*`, 'must name a value');
        if (hasLoneSurrogate(prop)) report(`${path}/props/*`, LONE_SURROGATE);
      }
      node.children?.forEach((child, index) => visit(child, `${path}/children/${index}`, depth + 1, inside));
      if (node.child) visit(node.child, `${path}/child`, depth + 1, node.type);
    };
    visit(root, top, 1);
    if (count.nodes > mostNodes) report(top, `must have at most ${mostNodes} nodes`);
    if (count.controls > MAX_CONTROLS) report(top, `must have at most ${MAX_CONTROLS} buttons, links and toggles`);
  }

  // Bound members, in every style whether a node uses it or not.
  for (const tint of ['background', 'keyline']) bound(`/input/layout/${tint}`, COLOR, layout[tint]);
  bound('/input/layout/url', LINK, layout.url);
  for (const style of Object.values(styles)) {
    for (const [member, rule] of Object.entries(BINDABLE)) bound(`/input/styles/*/${member}`, rule, style[member]);
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
