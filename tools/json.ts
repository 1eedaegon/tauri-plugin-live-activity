// Readers for JSON that the tools take from files, from registries, from GitHub and from cargo: a value is `unknown`
// until a member of it is checked.

/** A JSON object whose members are not checked yet. */
export type Fields = Readonly<Record<string, unknown>>;

/** True for a JSON object: a value with members by name. A list is none. */
export function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The member at `keys` of `value`: undefined where a value on the way is no object, or has no such member. */
export function field(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>((current, key) => (isFields(current) ? current[key] : undefined), value);
}
