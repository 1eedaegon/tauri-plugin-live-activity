/**
 * A type of the contract against the values of a fixture that Rust reads and writes back the same: the compiler
 * compares the members that the type declares with the members that the values hold. tests/android-contents.test.mjs
 * writes the paths of the values' members and compiles them against the types of this file, and members.check.ts
 * shows on a small type what each of them gives.
 *
 * A member's path is `/name` after the path of what holds it. The items of an array add `[]`, and a variant of a union
 * that `kind` tells apart adds `<kind>`. A path ends at a value that holds no member, with what that value is: the
 * color of a segment of a progress is `/presentation/style<progress>/value/segments[]/color:number`.
 */

/** The paths of the members that `Type` declares. */
export type Members<Type> = [Type] extends [object] ? Inside<Type> : Kind<Type>;

type Inside<Type> =
  Type extends readonly (infer Item)[] ? `[]${Members<Item>}`
  : Type extends { readonly kind: infer Variant extends string } ? `<${Variant}>${Named<Type>}`
  : Named<Type>;

/** `Required` takes from a member the `undefined` of being optional and leaves one that the declaration wrote. */
type Named<Type> = [keyof Type] extends [never] ? ':nothing' : {
  [Name in keyof Type & string]-?: `/${Name}${Members<Required<Type>[Name]>}`;
}[keyof Type & string];

/** What a value without members is. One that may be of two kinds, or null or undefined, is `other`: JSON has no such value. */
type Kind<Type> =
  [Type] extends [string] ? ':string'
  : [Type] extends [number] ? ':number'
  : [Type] extends [boolean] ? ':boolean'
  : ':other';

/** The paths of the members that `Type` declares optional, without what their values are. */
export type Optional<Type> = [Type] extends [object] ? OptionalInside<Type> : never;

type OptionalInside<Type> =
  Type extends readonly (infer Item)[] ? `[]${Optional<Item>}`
  : Type extends { readonly kind: infer Variant extends string } ? `<${Variant}>${OptionalNamed<Type>}`
  : OptionalNamed<Type>;

type OptionalNamed<Type> = {
  [Name in keyof Type & string]-?:
    | ({} extends Pick<Type, Name> ? `/${Name}` : never)
    | `/${Name}${Optional<Required<Type>[Name]>}`;
}[keyof Type & string];

/** The types of the members of `Type` that are called `Name`, wherever they are, each in a tuple of its own. */
export type Called<Type, Name extends string> = [Type] extends [object] ? CalledInside<Type, Name> : never;

type CalledInside<Type, Name extends string> =
  Type extends readonly (infer Item)[] ? Called<Item, Name>
  : {
    [Key in keyof Type & string]-?: (Key extends Name ? [Required<Type>[Key]] : never) | Called<Required<Type>[Key], Name>;
  }[keyof Type & string];

/** Whether two types are one and the same, and not only assignable to each other. */
export type Same<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;

/**
 * Where `Type` and the values of a fixture differ. `Held` are the paths of the members that the values hold, and
 * `LeftOut` those of the members that one value has and another, at the same place, lacks.
 */
export interface Unmatched<Type, Held extends string, LeftOut extends string> {
  /** Declared, and in no value: nothing shows that Rust reads it. */
  readonly declaredOnly: Exclude<Members<Type>, Held>;
  /** In a value, and not declared so. */
  readonly heldOnly: Exclude<Held, Members<Type>>;
  /** Declared optional, and given by every value that could leave it out: nothing shows that Rust takes it missing. */
  readonly alwaysGiven: Exclude<Optional<Type>, LeftOut>;
  /** Left out by a value, and declared required. */
  readonly wronglyRequired: Exclude<LeftOut, Optional<Type>>;
}

/** What an `Unmatched` is when the type and the values agree: the compiler names the path of a difference. */
export type Matched = { readonly [Difference in keyof Unmatched<unknown, never, never>]: never };
