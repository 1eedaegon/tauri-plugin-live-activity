// Layout components for TSX. Each returns the plain node object of its `layout` builder; nothing here
// imports Tauri or React, so a server can build the same layout.
import {
  bound, button, custom, divider, gauge, hstack, image, path, progress, spacer, symbol, text, timerText, vstack, zstack,
} from '../layout.js';
import type {
  LayoutButtonNode, LayoutCustomNode, LayoutDividerNode, LayoutGaugeNode, LayoutHStackNode, LayoutImageNode, LayoutNode,
  LayoutPathNode, LayoutProgressNode, LayoutSpacerNode, LayoutSymbolNode, LayoutTextNode, LayoutTimerTextNode,
  LayoutVStackNode, LayoutZStackNode,
} from '../types.js';

export { bind } from '../layout.js';

/** What a stack takes as children: nodes, arrays of them, and booleans, `null` or `undefined`, which are left out. */
export type LayoutChild = LayoutNode | readonly LayoutChild[] | boolean | null | undefined;

/** What `Text` takes as children: strings and numbers, joined, and booleans, `null` or `undefined`, left out. */
export type TextChild = string | number | readonly TextChild[] | boolean | null | undefined;

/** The members of node `N` but its type and the members `Taken` that a component takes another way. */
type Props<N extends LayoutNode, Taken extends PropertyKey = never> = N extends unknown ? Omit<N, 'type' | Taken> : never;

type StackProps<N extends LayoutNode> = Props<N, 'children'> & { readonly children: LayoutChild };

export type VStackProps = StackProps<LayoutVStackNode>;
export type HStackProps = StackProps<LayoutHStackNode>;
export type ZStackProps = StackProps<LayoutZStackNode>;
export type TextProps = Props<LayoutDividerNode> & (
  | { readonly children: TextChild; readonly bind?: never }
  | { readonly bind: string; readonly children?: never }
);
export type ImageProps = Props<LayoutImageNode, 'source'> & (
  | { readonly asset: string; readonly file?: never }
  | { readonly file: string; readonly asset?: never }
);
export type ButtonProps = Props<LayoutButtonNode, 'child'> & { readonly children: LayoutNode };

/** Children from top to bottom. */
export function VStack({ children, ...options }: VStackProps): LayoutVStackNode {
  return vstack(nodes('VStack', children), options);
}

/** Children side by side. */
export function HStack({ children, ...options }: HStackProps): LayoutHStackNode {
  return hstack(nodes('HStack', children), options);
}

/** Children on top of each other, the first at the back. */
export function ZStack({ children, ...options }: ZStackProps): LayoutZStackNode {
  return zstack(nodes('ZStack', children), options);
}

/** Flexible space inside a stack. */
export function Spacer(props: Props<LayoutSpacerNode>): LayoutSpacerNode {
  return spacer(props);
}

/** A separator line. */
export function Divider(props: Props<LayoutDividerNode>): LayoutDividerNode {
  return divider(props);
}

/** Literal text from its children, or with `bind` the value of that key. */
export function Text({ children, bind, ...options }: TextProps): LayoutTextNode {
  if (bind !== undefined) {
    if (children !== undefined) throw new TypeError('Text: takes children or bind, not both');
    return bound(bind, options);
  }
  if (children === undefined) throw new TypeError('Text: needs children or bind');
  return text(words(children), options);
}

/** An SF Symbol. */
export function SFSymbol({ name, ...options }: Props<LayoutSymbolNode>): LayoutSymbolNode {
  return symbol(name, options);
}

/** An image of the widget extension's asset catalog (`asset`), or a PNG that the app wrote with `writeImage` (`file`). */
export function Image({ asset, file, ...options }: ImageProps): LayoutImageNode {
  if ((asset === undefined) === (file === undefined)) throw new TypeError('Image: takes either asset or file');
  return image(asset ?? { file: file as string }, options);
}

/** A shape from SVG path data `d`, drawn in a `box` of `[width, height]`. */
export function Path({ d, box, ...options }: Props<LayoutPathNode>): LayoutPathNode {
  return path(d, box, options);
}

/** A progress bar or ring for the number value of `bind`. */
export function Progress({ bind, ...options }: Props<LayoutProgressNode>): LayoutProgressNode {
  return progress(bind, options);
}

/** A gauge for the number value of `bind`. */
export function Gauge({ bind, ...options }: Props<LayoutGaugeNode>): LayoutGaugeNode {
  return gauge(bind, options);
}

/** A timer the system draws between the epoch-millisecond values of the `start` and `end` keys. */
export function TimerText({ start, end, ...options }: Props<LayoutTimerTextNode>): LayoutTimerTextNode {
  return timerText(start, end, options);
}

/** A button around its one child; a tap reports `actionId` to `onAction`. */
export function Button({ actionId, children, ...options }: ButtonProps): LayoutButtonNode {
  const child: unknown = Array.isArray(children) && children.length === 1 ? children[0] : children;
  if (!isNode(child)) throw new TypeError('Button: needs exactly one node as its child');
  return button(actionId, child, options);
}

/** A SwiftUI view that the app registers under `name`; `props` are its inputs. */
export function Custom({ name, ...options }: Props<LayoutCustomNode>): LayoutCustomNode {
  return custom(name, options);
}

function isNode(value: unknown): value is LayoutNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { type?: unknown }).type === 'string';
}

function nodes(component: string, children: LayoutChild): LayoutNode[] {
  const found: LayoutNode[] = [];
  const visit = (child: unknown): void => {
    if (typeof child === 'boolean' || child === null || child === undefined) return;
    if (Array.isArray(child)) return child.forEach(visit);
    if (!isNode(child)) throw new TypeError(`${component}: a child must be a layout node; put text in <Text>`);
    found.push(child);
  };
  visit(children);
  if (found.length === 0) throw new TypeError(`${component}: needs at least one child`);
  return found;
}

function words(children: TextChild): string {
  if (typeof children === 'boolean' || children === null || children === undefined) return '';
  if (Array.isArray(children)) return children.map(words).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  throw new TypeError('Text: a child must be a string or a number');
}
