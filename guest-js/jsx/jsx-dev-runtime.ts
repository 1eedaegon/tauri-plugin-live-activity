// The development JSX runtime (`"jsx": "react-jsxdev"`): the same elements as the production runtime.
import { jsx } from './jsx-runtime.js';
import type { LayoutNode } from '../types.js';

export type { JSX } from './jsx-runtime.js';

/** Calls the component with its props; the key and the source location are dropped. */
export function jsxDEV(type: unknown, props: unknown, _key?: unknown, _isStatic?: boolean, _source?: unknown, _self?: unknown): LayoutNode {
  return jsx(type, props);
}
