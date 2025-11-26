import { getJoinPrefix } from "./join";
import { filter, isObj } from "./util";

export function normalizeFields(fields, flatten = false) {
  if (!isObj(fields)) return fields ? undefined : {};
  if (!flatten) return fields;
  return flattenFields(fieldsss);
}

/* Take a general field specifiers object (which could include nested objects)
 * and flatten it into a MongoDB compatible one with dot notation.
 * See https://docs.mongodb.com/manual/tutorial/project-fields-from-query-results/#projection. */
export function flattenFields(fields, root) {
  if (!fields) return fields;

  const keys = Object.keys(fields);

  /* Do not flatten fields if they contain a key that starts with $ (such as { $elemMatch }) */
  if (keys.some((k) => k.startsWith("$")))
    return root ? { [root]: fields } : fields;

  return keys.reduce((acc, k) => {
    /* If key is a dot string, omit it if its sub root is
     * already declared as selected to prevent path collisions. */
    const dotStrIndex = k.indexOf(".");
    if (dotStrIndex >= 0) {
      const subRoot = k.slice(0, dotStrIndex);
      const subRootSelection = fields[subRoot];
      if (subRootSelection && !isObj(subRootSelection)) return acc;
    }

    const shouldSelect = fields[k];
    const dotKey = root ? [root, k].join(".") : k;
    if (!isObj(shouldSelect)) return { ...acc, [dotKey]: !!shouldSelect };

    return { ...acc, ...flattenFields(shouldSelect, dotKey) };
  }, undefined);
}

/* Given a fields object and joins definitions,
 * return an object of shape { _: ownFields, +: joinFields } */
export function dispatchFields(fields, joins = {}) {
  if (!isObj(fields)) return { _: normalizeFields(fields) };

  const { "+": joinFields, ...ownFields } = isolateJoinFields(fields, joins);

  if (!joinFields) {
    return { _: normalizeFields(ownFields, true), "+": undefined };
  }

  /* If all own fields are included, joins should have sufficient info.
   * Return result as is. */
  const allOwnIncluded = !ownFields || !Object.keys(ownFields)?.length;

  if (allOwnIncluded) {
    return { _: normalizeFields(ownFields, true), "+": joinFields };
  }

  /* If not all own fields are included, try to derive necessary fields
   * from used joins definitions (explicit when defined as `[]`,
   * otherwise possibly specified as `fields` on join document). */
  const augmentedOwnFields = Object.keys(joinFields).reduce((acc, joinKey) => {
    const { on, fields } = joins[joinKey];
    const onFields = Array.isArray(on) ? { [on[0]]: 1 } : undefined;
    if (!(onFields || fields)) return acc;
    return { ...acc, ...onFields, ...fields };
  }, ownFields);

  return { _: normalizeFields(augmentedOwnFields, true), "+": joinFields };
}

export function combineFields(a, b) {
  /* If any fields targets all of them, return undefined to keep all fields */
  if (allFields(a) || allFields(b)) return undefined;

  /* If both fields are falsy, return {} to target no field. */
  if (!a && !b) return {};

  return deepMergeFields(removeFalsyFields(a), removeFalsyFields(b));
}

// Self-contained deep merge for fields objects.
// - If both values are plain objects, merge recursively.
// - Otherwise the value from `b` overrides `a`.
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

function allFields(fields) {
  if (fields === undefined) return true;
  if (!fields) return false;
  if (isObj(fields)) return false;
  return true;
}

function removeFalsyFields(fields) {
  if (!isObj(fields)) return {};
  return filter(([, v]) => v, fields);
}

/* Given a fields object and a list of joins,
 * return a fields object where all join fields
 * are grouped under a "+" key.
 * Returned join fields should all be valid, defined in joins.
 * Join fields are determined based on `joinPrefix` value. */
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

  /* If no `joinPrefix`, join fields are deduced from
   * their existance in the joins declarations. */
  return Object.entries(fields).reduce((acc, [k, v]) => {
    /* If not a join, return it flat on the fields */
    if (!joinKeys.includes(k)) return { ...acc, [k]: v };

    /* If a join, group it under "+" key. */
    const prev = acc["+"] || {};
    return { ...acc, "+": { ...prev, [k]: v } };
  }, {});
}

/* Decrement by one a number field at a given key. */
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
