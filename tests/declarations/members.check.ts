/**
 * What the types of members.ts give for a small type. tests/android-contents.test.mjs compiles this file: a result
 * that is not the one written here is a compile error.
 */
import type { Called, Members, Optional, Same } from './members.js';

type Sample =
  | { readonly kind: 'list'; readonly items: readonly { readonly size?: number; readonly word: 'a' | 'b' }[] }
  | {
    readonly kind: 'odd';
    readonly text: string | null;
    readonly either: number | string;
    readonly late: boolean | undefined;
    readonly none: {};
  };

export const members: Same<
  Members<Sample>,
  | '<list>/kind:string' | '<list>/items[]/size:number' | '<list>/items[]/word:string'
  | '<odd>/kind:string' | '<odd>/text:other' | '<odd>/either:other' | '<odd>/late:other' | '<odd>/none:nothing'
> = true;

export const optional: Same<Optional<Sample>, '<list>/items[]/size'> = true;

export const called: Same<Called<Sample, 'word'>, ['a' | 'b']> = true;

/** Two members of one name stay apart when one of them is narrower than the other. */
type Narrowed = { readonly first: { readonly word: 'a' }; readonly second: { readonly word: 'a' | 'b' } };
export const apart: Same<Called<Narrowed, 'word'>, ['a' | 'b']> = false;
