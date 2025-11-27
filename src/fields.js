import { getJoinPrefix } from "./join";
import { filter, isObj } from "./util";

/**
 * @typedef {Record<string, (0|1|boolean|FieldSpec)>} FieldSpec
 * A MongoDB-like field projection where:
 * - keys are field paths (may be nested objects or dot-notation)
 * - values are 1/true to include, 0/false to exclude, or nested FieldSpec
 *
 * Special handling:
 * - join fields may be grouped under the join prefix (e.g. '+') when set via getJoinPrefix()
 */

/**
 * Normalize a field projection for downstream usage.
 * - If fields is not a plain object: returns undefined when truthy (meaning "select all"),
 *   or {} when falsy (meaning "select none").
 * - When flatten=true, converts nested objects to dot-notation MongoDB projection.
 *
 * @param {FieldSpec|undefined|null|false} fields - Field projection to normalize.
 * @param {boolean} [flatten=false] - Whether to flatten nested fields to dot-notation.
 * @returns {Record<string, boolean>|undefined} Normalized projection, {} (none), or undefined (all).
 */
export function normalizeFields(fields, flatten = false) {
  if (!isObj(fields)) return fields ? undefined : {};
  if (!flatten) return fields;
  // Flatten nested objects to dot-notation
  return flattenFields(fields);
}

/**
 * Flatten a general field specifiers object (which could include nested objects)
 * into a MongoDB-compatible one that uses dot-notation.
 * See: https://www.mongodb.com/docs/manual/tutorial/project-fields-from-query-results/#projection
 *
 * Notes:
 * - If a key starts with '$' (e.g., $elemMatch), the subtree is preserved as-is.
 * - Avoids path collisions by omitting dot-notation keys when their sub-root is already selected.
 *
 * @param {FieldSpec|undefined} fields - Nested projection to flatten.
 * @param {string} [root] - Internal accumulator for the current path.
 * @returns {Record<string, boolean>|FieldSpec|undefined} Dot-notation projection or original structure for $-keys.
 */
export function flattenFields(fields, root) {
  if (!fields) return fields;

  const keys = Object.keys(fields);

  // Do not flatten when a $-operator exists (e.g., { $elemMatch: ... })
  if (keys.some((k) => k.startsWith("$")))
    return root ? { [root]: fields } : fields;

  return keys.reduce((acc, k) => {
    // Prevent path collisions when dot-notation key is under an already selected sub-root
    const dotStrIndex = k.indexOf(".");
    if (dotStrIndex >= 0) {
      const subRoot = k.slice(0, dotStrIndex);
      const subRootSelection = fields[subRoot];
      if (subRootSelection && !isObj(subRootSelection)) return acc;
    }

    const shouldSelect = fields[k];
    const dotKey = root ? [root, k].join(".") : k;

    if (!isObj(shouldSelect)) {
      return { ...acc, [dotKey]: !!shouldSelect };
    }

    return { ...acc, ...flattenFields(shouldSelect, dotKey) };
  }, undefined);
}

/**
 * Given a fields object and join definitions,
 * split fields into:
 * - '_' (own/base collection fields)
 * - '+' (join fields, keyed by join name)
 *
 * Ensures base fields are flattened and, when needed, augmented so joins have
 * access to required linking properties (e.g., on/from keys).
 *
 * @param {FieldSpec|undefined} fields - Field projection that may include join fields.
 * @param {Record<string, any>} [joins={}] - Join definitions keyed by join name.
 * @returns {{ _: Record<string, boolean>|undefined, '+': FieldSpec|undefined }}
 */
export function dispatchFields(fields, joins = {}) {
  if (!isObj(fields)) return { _: normalizeFields(fields) };

  const { "+": joinFields, ...ownFields } = isolateJoinFields(fields, joins);

  if (!joinFields) {
    return { _: normalizeFields(ownFields, true), "+": undefined };
  }

  // If all own fields are included (i.e., unspecified), we can return as-is
  const allOwnIncluded = !ownFields || !Object.keys(ownFields)?.length;

  if (allOwnIncluded) {
    return { _: normalizeFields(ownFields, true), "+": joinFields };
  }

  // Otherwise, ensure we include any fields required by the join definitions
  // (on/from keys and/or explicit fields defined on the join).
  const augmentedOwnFields = Object.keys(joinFields).reduce((acc, joinKey) => {
    const { on, fields } = joins[joinKey];
    const onFields = Array.isArray(on) ? { [on[0]]: 1 } : undefined;
    if (!(onFields || fields)) return acc;
    return { ...acc, ...onFields, ...fields };
  }, ownFields);

  return { _: normalizeFields(augmentedOwnFields, true), "+": joinFields };
}

/**
 * Combine two field projections into one.
 * Rules:
 * - If either is "all fields" (undefined or non-object truthy), the result is undefined (select all).
 * - If both are falsy, returns {} (select none).
 * - Otherwise, performs a deep merge where nested objects are merged recursively
 *   and scalar values from b override a.
 *
 * @param {FieldSpec|undefined|null|false} a - First projection.
 * @param {FieldSpec|undefined|null|false} b - Second projection.
 * @returns {Record<string, boolean>|undefined} Combined projection.
 */
export function combineFields(a, b) {
  // If any fields targets all of them, return undefined to keep all fields
  if (allFields(a) || allFields(b)) return undefined;

  // If both fields are falsy, return {} to target no field.
  if (!a && !b) return {};

  return deepMergeFields(removeFalsyFields(a), removeFalsyFields(b));
}

/**
 * Deep merge utility for fields objects.
 * - If both values are plain objects, merge recursively.
 * - Otherwise the value from `b` overrides `a`.
 *
 * @param {Record<string, any>} [a={}] - Base projection.
 * @param {Record<string, any>} [b={}] - Projection to merge over a.
 * @returns {Record<string, any>} Merged projection.
 * @internal
 */
function deepMergeFields(a = {}, b = {}) {
  const out = { ...a };
  for (const [key, valB] of Object.entries(b || {})) {
    const valA = out[key];
    if (isObj(valA) && isObj(valB)) {
      out[key] = deepMergeFields(valA, valB);
    } else {
      out[key] = valB;
    }
  }
  return out;
}

/**
 * Determine if a projection means "all fields".
 * Semantics:
 * - undefined => all fields
 * - falsy (null/false/0) => not all
 * - non-object truthy (e.g., 1/true) => all fields
 * - object => not all
 *
 * @param {any} fields - Projection to test.
 * @returns {boolean} True if it means "all fields".
 * @internal
 */
function allFields(fields) {
  if (fields === undefined) return true;
  if (!fields) return false;
  if (isObj(fields)) return false;
  return true;
}

/**
 * Remove falsy values from a fields object.
 * When the input is not a plain object, returns an empty object.
 *
 * @param {any} fields - Projection to clean.
 * @returns {Record<string, any>} Cleaned fields.
 * @internal
 */
function removeFalsyFields(fields) {
  if (!isObj(fields)) return {};
  return filter(([, v]) => v, fields);
}

/**
 * Given a fields object and a list of joins,
 * return a fields object where all join fields
 * are grouped under a "+" (or configured) key.
 *
 * Returned join fields are validated against the provided joins
 * and non-join fields remain at the root level.
 *
 * Behavior depends on the configured join prefix (via getJoinPrefix()):
 * - If a prefix exists, only fields under that key are considered join fields.
 * - If not, any field whose key exists in `joins` is treated as a join field.
 *
 * @param {FieldSpec} fields - Original fields projection.
 * @param {Record<string, any>} [joins={}] - Join definitions keyed by join name.
 * @returns {{ '+': FieldSpec|undefined } & FieldSpec} Fields split between join and own keys.
 * @internal
 */
function isolateJoinFields(fields, joins = {}) {
  const joinKeys = Object.keys(joins);
  const joinPrefix = getJoinPrefix();

  if (joinPrefix) {
    const { [joinPrefix]: joinFields, ...ownFields } = fields;

    if (!joinFields) return { "+": undefined, ...ownFields };

    const existingJoinFields = filter(
      ([k]) => joinKeys.includes(k),
      joinFields,
    );
    return { "+": existingJoinFields, ...ownFields };
  }

  // If no configured prefix, treat any key that matches a declared join as a join field.
  return Object.entries(fields).reduce((acc, [k, v]) => {
    // Not a join: keep at root
    if (!joinKeys.includes(k)) return { ...acc, [k]: v };

    // Join: group under "+" key
    const prev = acc["+"] || {};
    return { ...acc, "+": { ...prev, [k]: v } };
  }, {});
}

/**
 * Decrement by one the numeric depth for a given join key in a fields object.
 * Useful to control recursive join depth across nested fetches.
 *
 * - If the value is not a number or is Infinity, the fields are returned unchanged.
 * - Respects the configured join prefix (e.g., '+') when present.
 *
 * @param {string} key - Join key to decrement.
 * @param {FieldSpec|undefined} fields - Field projection possibly containing the join key.
 * @returns {FieldSpec|undefined} A new fields object with decremented depth, or the original.
 */
export function decrementRecursiveField(key, fields) {
  if (!isObj(fields)) return fields;

  const joinPrefix = getJoinPrefix();

  const prev = joinPrefix ? fields[joinPrefix]?.[key] : fields[key];

  if (typeof prev !== "number") return fields;
  if (prev === Infinity) return fields;

  const decremented = prev - 1;

  if (!joinPrefix) return { ...fields, [key]: decremented };

  return {
    ...fields,
    [joinPrefix]: { ...fields[joinPrefix], [key]: decremented },
  };
}
