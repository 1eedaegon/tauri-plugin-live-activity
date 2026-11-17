// What the tests share for values whose type the compiler cannot know: JSON that a test reads, which is `unknown`
// until the test checks it, and the one way to hand a function a value that the compiler would refuse.
import assert from 'node:assert/strict';

/** A JSON object whose members are not checked yet. */
export type JsonObject = Readonly<Record<string, unknown>>;

/** True for a JSON object: a value with members by name. A list is none. */
export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The member at `keys` of `value`: undefined where a value on the way is no object, or has no such member. */
export function member(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

/** `value` as a JSON object. The test fails when it is none. */
export function record(value: unknown, what = 'the value'): JsonObject {
  assert.ok(isRecord(value), `${what} is not an object`);
  return value;
}

/** `value` as a list. The test fails when it is none. */
export function list(value: unknown, what = 'the value'): readonly unknown[] {
  assert.ok(Array.isArray(value), `${what} is not a list`);
  return value;
}

/** `value` as text. The test fails when it is none. */
export function text(value: unknown, what = 'the value'): string {
  assert.ok(typeof value === 'string', `${what} is not text`);
  return value;
}

/** `value` when there is one. The test fails when it is undefined: an index or a match that the test counts on. */
export function present<T>(value: T | undefined, what = 'the value'): T {
  assert.ok(value !== undefined, `${what} is missing`);
  return value;
}

/**
 * A value as the type that a function takes, unchecked: for a test of what happens at run time when a caller passes
 * something that the compiler would refuse, as a caller in JavaScript can. It is the only cast in the tests.
 */
export function unchecked<T>(value: unknown): T {
  return value as T;
}
