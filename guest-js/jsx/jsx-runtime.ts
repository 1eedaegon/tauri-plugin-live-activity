// The automatic JSX runtime of `jsxImportSource: "tauri-plugin-live-activity/jsx"`. A layout has no intrinsic
// elements and no fragments: every tag is one of the components of this entry.
import type { LayoutNode } from '../types.js';

type Component = (props: never) => LayoutNode;

export declare namespace JSX {
  type Element = LayoutNode;
  type ElementType = Component;
  interface IntrinsicElements {}
  interface ElementChildrenAttribute {
    children: unknown;
  }
}

/** Calls the component with its props. The key has no place in a layout node. */
export function jsx(type: unknown, props: unknown, _key?: unknown): LayoutNode {
  if (typeof type !== 'function') {
    throw new TypeError(`a layout has no element <${String(type)}>: use the components of tauri-plugin-live-activity/jsx`);
  }
  return (type as (props: unknown) => LayoutNode)(props);
}

/** The same for an element with several static children. */
export const jsxs = jsx;
