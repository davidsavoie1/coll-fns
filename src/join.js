import { isFunc, typeOf, warn } from "./util";

const KNOWN_TYPES = ["array", "function", "object"];
const knownTypesCaption = KNOWN_TYPES.join("', '");

/* Single map that holds definitions of all collection joins by collection name */
let joinsDictionnary = new Map();

/* A prefix to use as a placeholder key to distinguish joins in `fields` option.
 * If defined, will be used like `{ fields: { [joinPrefix]: { ...joinFields } } }`.
 * If falsy, join fields will be integrated amongst normal collection fields
 * and detected based on the ones declared. */
let joinPrefix = null;

/* Attach joins on the collection.
 * A join has the shape { Coll, on, single, ...options }, where
 *   - Coll: The joined collection
 *   - on: selector || fn(doc) => selector || [fromProp, toProp, toSelector]
 *   - single: boolean. When `true`, linked as a single document, otherwise as an array
 *   - postFetch: fn(joinedDocsOrDoc, doc). Transformation function applied after fetch
 *   - ...options: Other options to be passed to the `fetch` or `find` operation.
 * Joins should be declared after all collections have been loaded. */
export function join(Collection, joins) {
  if (!joins) {
    joinsDictionnary.set(Collection, undefined);
    return;
  }

  Object.entries(joins).forEach(([key, { Coll, on, fields }]) => {
    if (!Coll) {
      throw new Error(`Collection 'Coll' for '${key}' join is required.`);
    }

    if (!on) {
      throw new Error(`Join '${key}' has no 'on' condition specified.`);
    }

    const joinType = typeOf(on);
    if (!KNOWN_TYPES.includes(joinType)) {
      throw new Error(
        `Join '${key}' has an unrecognized 'on' condition type of '${joinType}'. Should be one of '${knownTypesCaption}'.`
      );
    }

    if (isFunc(on) && !fields) {
      warn(
        `Join '${key}' is defined with a function 'on', but no 'fields' are explicitely specified. This could lead to failed joins if the keys necessary for the join are not specified at query time.`
      );
    }
  });

  joinsDictionnary.set(Collection, {
    ...joinsDictionnary.get(Collection),
    ...joins,
  });
}

export function getJoins(Coll) {
  return joinsDictionnary.get(Coll) || {};
}

/* Get `joinPrefix` */
export function getJoinPrefix() {
  return joinPrefix;
}

/* Set new `joinPrefix` */
export function setJoinPrefix(prefix) {
  joinPrefix = prefix;
}
