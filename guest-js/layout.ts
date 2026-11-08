import type {
  LayoutBound, LayoutButtonNode, LayoutDividerNode, LayoutGaugeNode, LayoutHStackNode, LayoutImageNode, LayoutNode,
  LayoutPathNode, LayoutProgressNode, LayoutSpacerNode, LayoutSymbolNode, LayoutTextNode,
  LayoutTimerTextNode, LayoutVStackNode, LayoutZStackNode,
} from './types.js';

/** The members of a node that its builder does not take as arguments. */
type Options<N extends LayoutNode, Argument extends keyof N = never> =
  N extends unknown ? Omit<N, 'type' | Argument> : never;

/** Copies the options that were given, so that a node never carries an undefined member. */
function given<T extends object>(options: T | undefined): T {
  return Object.fromEntries(Object.entries(options ?? {}).filter(([, value]) => value !== undefined)) as T;
}

// The builders return plain node objects. They do not validate: the plugin checks the whole request.

/** Children from top to bottom. */
export function vstack(children: readonly LayoutNode[], options?: Options<LayoutVStackNode, 'children'>): LayoutVStackNode {
  return { type: 'vstack', children, ...given(options) };
}

/** Children side by side. */
export function hstack(children: readonly LayoutNode[], options?: Options<LayoutHStackNode, 'children'>): LayoutHStackNode {
  return { type: 'hstack', children, ...given(options) };
}

/** Children on top of each other, the first at the back. */
export function zstack(children: readonly LayoutNode[], options?: Options<LayoutZStackNode, 'children'>): LayoutZStackNode {
  return { type: 'zstack', children, ...given(options) };
}

/** Flexible space inside a stack. */
export function spacer(options?: Options<LayoutSpacerNode>): LayoutSpacerNode {
  return { type: 'spacer', ...given(options) };
}

/** A separator line. */
export function divider(options?: Options<LayoutDividerNode>): LayoutDividerNode {
  return { type: 'divider', ...given(options) };
}

/** Literal text. */
export function text(value: string, options?: Options<LayoutTextNode, 'value' | 'bind'>): LayoutTextNode {
  return { type: 'text', value, ...given(options) };
}

/** Text that shows the value of `key`. */
export function bound(key: string, options?: Options<LayoutTextNode, 'value' | 'bind'>): LayoutTextNode {
  return { type: 'text', bind: key, ...given(options) };
}

/** An SF Symbol. */
export function symbol(name: string, options?: Options<LayoutSymbolNode, 'name'>): LayoutSymbolNode {
  return { type: 'symbol', name, ...given(options) };
}

/** An image of the widget extension's asset catalog. */
export function image(asset: string, options?: Options<LayoutImageNode, 'source'>): LayoutImageNode {
  return { type: 'image', source: { asset }, ...given(options) };
}

/** A shape from SVG path data `d`, drawn in a `box` of `[width, height]`. */
export function path(d: string, box: readonly [number, number], options?: Options<LayoutPathNode, 'd' | 'box'>): LayoutPathNode {
  return { type: 'path', d, box, ...given(options) };
}

/** A progress bar or ring for the number value of `key`. */
export function progress(key: string, options?: Options<LayoutProgressNode, 'bind'>): LayoutProgressNode {
  return { type: 'progress', bind: key, ...given(options) };
}

/** A gauge for the number value of `key`. */
export function gauge(key: string, options?: Options<LayoutGaugeNode, 'bind'>): LayoutGaugeNode {
  return { type: 'gauge', bind: key, ...given(options) };
}

/** A timer the system draws between the epoch-millisecond values of the `start` and `end` keys. */
export function timerText(start: string, end: string, options?: Options<LayoutTimerTextNode, 'start' | 'end'>): LayoutTimerTextNode {
  return { type: 'timerText', start, end, ...given(options) };
}

/** A button around `child`; a tap reports `actionId` to `onAction`. */
export function button(actionId: string, child: LayoutNode, options?: Options<LayoutButtonNode, 'actionId' | 'child'>): LayoutButtonNode {
  return { type: 'button', actionId, child, ...given(options) };
}

/**
 * A style member, `layout.background` or `layout.keyline` that reads the value of `key` on every render,
 * so an update can change it: `{ color: bind('tone') }`. Only `color`, `background`, `tint`, `opacity`,
 * `size`, `weight` and `cornerRadius` can be bound.
 */
export function bind(key: string): LayoutBound {
  return { bind: key };
}
