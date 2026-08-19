import { isFunc, map, typeOf, warn } from "./util";

const PREFIX = Symbol("PREFIX");

/**
 * Optional prefix used to distinguish join fields within the `fields` option.
 * If set, join fields must be specified under this prefix, e.g.:
 * { fields: { [joinPrefix]: { author: 1, comments: { user: 1 } } } }
 * If falsy, join fields may be mixed with base fields and detected by their names.
 * @type {string|null}
 */
const DEFAULT_PREFIX = null;

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
 * Global join context will eventually get initialized only once.
 * Map<Collection, Record<string, JoinDef>>
 * @type {Map<*, Record<string, JoinDef>|null|undefined>}
 * @internal
 */
let globalJoinsDictionary = undefined;

/**
 * @typedef {string | [string]} JoinArrayProp
 * A dot-notation field path, optionally wrapped to mark it as array-valued.
 */

/**
 * @typedef {[JoinArrayProp, JoinArrayProp] | [JoinArrayProp, JoinArrayProp, Object]} JoinArrayOn
 * Array form describing relation:
 * - [fromProp, toProp] or [fromProp, toProp, toSelector]
 *   fromProp: dot-notation field path on the parent document
 *     (string or ['path'] to denote an array-valued path)
 *   toProp: dot-notation field path on the joined document
 *     (string or ['path'] to denote an array-valued path)
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
 * @property {(joined: any[]|any, parent: any) => any} [postFetch] - Synchronously transform the joined value before attaching it.
 * @property {Object} [deps] - Parent fields required to perform the join when `on` is a function.
 * @property {Object} [fields] - Backward-compatible alias for `deps`.
 * @property {number} [limit] - Limit for the joined fetch (applies when not single).
 * Additional properties are forwarded as options to the underlying joined fetch.
 */

/**
 * Register/augment join definitions for a collection.
 * Validates join shapes and emits warnings for potentially unsafe definitions.
 *
 * Notes:
 * - Calling with `joins` falsy disables all joins for the collection.
 * - Falsy entries in `joins` disable individual joins. In a local context,
 *   they also mask definitions inherited from the global dictionary.
 * - If `on` is a function and no `deps` are declared for the join, a warning is emitted,
 *   because required linking keys may not be fetched unless explicitly requested.
 *
 * @template TColl
 * @param {TColl} Collection - The collection instance to attach joins to.
 * @param {Record<string, JoinDef|null|undefined|false>|undefined|null|false} joins - Map of joinKey -> join definition.
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
export function join(Collection, joins, dict = getGlobalJoinsDict()) {
  if (!joins) {
    // Explicitly set to null to signal no joins for this collection
    dict.set(Collection, null);
    return;
  }

  const existingJoins = getJoins(Collection, dict);

  const normalizedJoins = map(([key, join]) => {
    if (!join) return [key, null];

    const { Coll, on, fields, deps = fields } = join;
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

    // When on is a function, the join likely depends on keys from the parent doc.
    // Encourage declaring the base deps required so callers don't forget them.
    if (isFunc(on) && !deps) {
      warn(
        `Join '${key}' is defined with a function 'on', but no 'deps' are explicitly specified. This could lead to failed joins if the keys necessary for the join are not specified at query time.`
      );
    }

    return [key, join];
  }, joins);

  /* Merge new join defs with existing ones on this collection.
   * `null` joins will remove existing ones. */
  dict.set(Collection, {
    ...existingJoins,
    ...normalizedJoins,
  });
}

/**
 * Retrieve declared joins for a collection. Default to empty object {}.
 *
 * @template TColl
 * @param {TColl} Coll - The collection instance.
 * @returns {Record<string, JoinDef>} The join definitions keyed by join name,
 * or an empty object when none are defined.
 */
export function getJoins(Coll, dict = getGlobalJoinsDict()) {
  return _getJoins(Coll, dict) || {};
}

function _getJoins(Coll, dict = getGlobalJoinsDict()) {
  return dict.get(Coll);
}

/**
 * Get the currently configured join fields prefix used in field projections.
 * If set, join fields should be nested under this key within `fields`.
 * @returns {string|null} The prefix (e.g., '+') or null if not set.
 */
export function getJoinPrefix(dict = getGlobalJoinsDict()) {
  return dict.get(PREFIX);
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
export function setJoinPrefix(prefix, dict = getGlobalJoinsDict()) {
  dict.set(PREFIX, prefix);
}

/**
 * Create a reusable local join context.
 *
 * By default, local definitions are merged over the global join dictionary.
 * `defaultToGlobal: false` creates an isolated context instead. Definitions can
 * override or disable global joins without mutating them. The prefix belongs to
 * the context and is inherited by every level of a fetch or publication tree.
 *
 * @param {Object} [options]
 * @param {boolean} [options.defaultToGlobal=true]
 * @param {string|null} [options.prefix=getJoinPrefix()]
 * @returns {{getJoins: Function, getJoinPrefix: Function, join: Function, setJoinPrefix: Function}}
 */
export function createJoinContext({
  defaultToGlobal = true,
  prefix = getJoinPrefix(),
} = {}) {
  const dict = new Map([[PREFIX, prefix]]);

  return {
    getJoins(Coll) {
      const ownJoins = _getJoins(Coll, dict);

      /* Allow explicit join disabling by setting joins to null */
      if (ownJoins === null) return null;

      if (!defaultToGlobal) return ownJoins;

      const globalJoins = _getJoins(Coll);
      return { ...(globalJoins || {}), ...(ownJoins || {}) };
    },

    getJoinPrefix() {
      return getJoinPrefix(dict);
    },

    join(Coll, joins) {
      join(Coll, joins, dict);
      /* Return `this` to allow chaining */
      return this;
    },

    setJoinPrefix(prefix) {
      setJoinPrefix(prefix, dict);
      /* Return `this` to allow chaining */
      return this;
    },
  };
}

/**
 * Resolve and bind the join operations exposed by a context, falling back to
 * the global dictionary for operations the context does not implement.
 * This also supports custom context objects with their own internal state.
 *
 * @param {Object} [ctx]
 * @returns {{getJoins: Function, getJoinPrefix: Function, join: Function, setJoinPrefix: Function}}
 * @internal
 */
export function useJoinContext(ctx) {
  return {
    getJoins: ctx?.getJoins ? ctx.getJoins.bind(ctx) : _getJoins,
    getJoinPrefix: ctx?.getJoinPrefix
      ? ctx.getJoinPrefix.bind(ctx)
      : getJoinPrefix,
    join: ctx?.join ? ctx.join.bind(ctx) : join,
    setJoinPrefix: ctx?.setJoinPrefix
      ? ctx.setJoinPrefix.bind(ctx)
      : setJoinPrefix,
  };
}

function getGlobalJoinsDict() {
  if (globalJoinsDictionary) return globalJoinsDictionary;
  globalJoinsDictionary = new Map([[PREFIX, DEFAULT_PREFIX]]);
  return globalJoinsDictionary;
}
