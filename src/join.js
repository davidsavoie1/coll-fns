import { isFunc, typeOf, warn } from "./util";

/**
 * Allowed runtime types for the `on` property in a join definition.
 * - 'array'    => [fromProp, toProp, toSelector?]
 * - 'function' => (doc) => selector
 * - 'object'   => static selector object
 * @type {Array<'array'|'function'|'object'>}
 * @internal
 */
const KNOWN_TYPES = ["array", "function", "object"];
const knownTypesCaption = KNOWN_TYPES.join("', '");

/**
 * Global registry of join definitions per collection instance.
 * Map<Collection, Record<string, JoinDef>>
 * @type {Map<*, Record<string, JoinDef>|undefined>}
 * @internal
 */
let joinsDictionnary = new Map();

/**
 * Optional prefix used to distinguish join fields within the `fields` option.
 * If set, join fields must be specified under this prefix, e.g.:
 * { fields: { [joinPrefix]: { author: 1, comments: { user: 1 } } } }
 * If falsy, join fields may be mixed with base fields and detected by their names.
 * @type {string|null}
 */
let joinPrefix = null;

/**
 * @typedef {[*] | [string, string] | [string, string, Object]} JoinArrayOn
 * Array form describing relation:
 * - [fromProp, toProp] or [fromProp, toProp, toSelector]
 *   fromProp: field on parent doc (string or ['field'] to denote array-valued)
 *   toProp:   field on joined doc  (string or ['field'] to denote array-valued)
 *   toSelector: optional additional selector for joined docs
 */

/**
 * @typedef {(doc: any) => Object} JoinFunctionOn
 * Function form: receives the parent document and returns a selector
 * for fetching the related documents from the joined collection.
 */

/**
 * @typedef {Object} JoinObjectOn
 * Static selector object applied to the joined collection.
 */

/**
 * @typedef {JoinArrayOn | JoinFunctionOn | JoinObjectOn} JoinOn
 */

/**
 * @typedef {Object} JoinDef
 * @property {*} Coll - The target collection to join with.
 * @property {JoinOn} on - Relation description (array/function/object).
 * @property {boolean} [single] - If true, attach a single document instead of an array.
 * @property {(joined: any[]|any, parent: any) => any} [postFetch] - Transform the joined value before attaching.
 * @property {Object} [fields] - Base collection fields required to perform the join when `on` is a function.
 * @property {number} [limit] - Limit for the joined fetch (applies when not single).
 * @property {any} [options] - Any extra options passed through to the underlying fetch/find implementation.
 */

/**
 * Register/augment join definitions for a collection.
 * Validates join shapes and emits warnings for potentially unsafe definitions.
 *
 * Notes:
 * - Calling with `joins` falsy clears existing joins for the collection.
 * - If `on` is a function and no `fields` are declared for the join, a warning is emitted,
 *   because required linking keys may not be fetched unless explicitly requested.
 *
 * @template TColl
 * @param {TColl} Collection - The collection instance to attach joins to.
 * @param {Record<string, JoinDef>|undefined|null|false} joins - Map of joinKey -> join definition.
 * @example
 * join(Posts, {
 *   author: {
 *     Coll: Users,
 *     on: ['authorId', '_id'],
 *     single: true,
 *     postFetch(author, post) { return author && { _id: author._id, name: author.name }; }
 *   },
 *   comments: {
 *     Coll: Comments,
 *     on: ['_id', 'postId'],
 *     limit: 50
 *   }
 * });
 */
export function join(Collection, joins) {
  if (!joins) {
    // Explicitly set to undefined to signal no joins for this collection
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
        `Join '${key}' has an unrecognized 'on' condition type of '${joinType}'. Should be one of '${knownTypesCaption}'.`,
      );
    }

    // When on is a function, the join likely depends on keys from the parent doc.
    // Encourage declaring the base fields required so callers don't forget them.
    if (isFunc(on) && !fields) {
      warn(
        `Join '${key}' is defined with a function 'on', but no 'fields' are explicitely specified. This could lead to failed joins if the keys necessary for the join are not specified at query time.`,
      );
    }
  });

  // Merge new join defs with existing ones on this collection
  joinsDictionnary.set(Collection, {
    ...joinsDictionnary.get(Collection),
    ...joins,
  });
}

/**
 * Retrieve declared joins for a collection.
 *
 * @template TColl
 * @param {TColl} Coll - The collection instance.
 * @returns {Record<string, JoinDef>} The join definitions keyed by join name.
 */
export function getJoins(Coll) {
  return joinsDictionnary.get(Coll) || {};
}

/**
 * Get the currently configured join fields prefix used in field projections.
 * If set, join fields should be nested under this key within `fields`.
 * @returns {string|null} The prefix (e.g., '+') or null if not set.
 */
export function getJoinPrefix() {
  return joinPrefix;
}

/**
 * Set the join fields prefix used in field projections.
 * Pass a falsy value (e.g., null) to disable the prefix behavior.
 *
 * @param {string|null} prefix - Prefix symbol/key (e.g., '+') or null to disable.
 * @example
 * setJoinPrefix('+');
 * // later in queries:
 * // fetch(Posts, {}, { fields: { '+': { author: 1, comments: 1 }, title: 1 } })
 */
export function setJoinPrefix(prefix) {
  joinPrefix = prefix;
}
