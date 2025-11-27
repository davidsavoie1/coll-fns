import { combineFields } from "./fields";
import { isArr, isFunc, then } from "./util";

/**
 * List of supported hook types.
 * - beforeInsert:    runs before inserting a document.        (docToInsert)
 * - beforeUpdate:    runs before updating documents.          (docsToUpdate, modifier)
 * - beforeRemove:    runs before removing documents.          (docsToRemove)
 * - onInserted:      runs after a document is inserted.       (doc)
 * - onUpdated:       runs after a document is updated.        (doc, beforeDoc?)
 * - onRemoved:       runs after a document is removed.        (doc)
 * @type {Array<HookType>}
 * @readonly
 */
const HOOK_TYPES = [
  "beforeInsert", // (docToInsert)
  "beforeUpdate", // (docsToUpdate, modifier)
  "beforeRemove", // (docsToRemove)

  "onInserted", // (doc)
  "onUpdated", // (doc, before)
  "onRemoved", // (doc)
];

/**
 * @typedef {'beforeInsert'|'beforeUpdate'|'beforeRemove'|'onInserted'|'onUpdated'|'onRemoved'} HookType
 */

/**
 * Generic hook function signature.
 * The concrete arguments depend on the HookType (see HOOK_TYPES above).
 * Returning a promise is supported.
 * @typedef {(…args:any[]) => any|Promise<any>} HookFn
 */

/**
 * Optional predicate to prevent a hook from running.
 * If returns a truthy value, the hook is skipped.
 * Receives the same arguments as the HookFn.
 * @typedef {(...args:any[]) => boolean} HookUnlessPredicate
 */

/**
 * Optional predicate that must be truthy for the hook to run.
 * Receives the same arguments as the HookFn.
 * @typedef {(...args:any[]) => boolean} HookWhenPredicate
 */

/**
 * Hook definition object.
 * - before: Only meaningful for "onUpdated". If true, the "before" document should be fetched.
 * - fields: Projection of fields to fetch for the documents the hook needs.
 *           Combined across all hooks of the same type via combineFields.
 *           `undefined` or `true` means "all fields".
 * - fn:     The hook function (required).
 * - unless: Optional predicate; if truthy, prevents the hook from running.
 * - when:   Optional predicate; if truthy, allows the hook to run.
 * @typedef {Object} HookDef
 * @property {boolean} [before]
 * @property {import('./fields').FieldSpec|true|undefined} [fields]
 * @property {HookFn} fn
 * @property {HookUnlessPredicate} [unless]
 * @property {HookWhenPredicate} [when]
 */

/**
 * Single registry holding hook definitions per collection instance.
 * Map<CollectionInstance, Record<HookType, HookDef[]>>
 * @type {Map<*, Record<HookType, HookDef[]>>}
 * @internal
 */
const hooksRegistry = new Map();

/*
 *  hookDef = {
 *    before, // Bool. onUpdated only. When true, fetch document before update. Otherwise, document will be fetched, but only with its _id field to know which docs to retrieve after the update.
 *    fields, // Fields of document to fetch. Will be combined for all hooks of the same type. `undefined` or `true` means all fields and subsequent field restrictions won't apply.
 *    fn, // (doc, before<onUpdated>) => side effect. Function to run as hook
 *    unless, // (doc, before<onUpdated>) => bool. Predicate to prevent hook from running
 *    when, // (doc, before<onUpdated>) => bool. Predicate to run the hook
 *  };
 */

/**
 * Register multiple hooks for a collection.
 * The hooksObj keys must be valid HookType values, and each value must be an array of HookDef.
 *
 * @template TColl
 * @param {TColl} Coll - Collection class instance.
 * @param {Record<HookType, HookDef[]>} hooksObj - Object mapping hook types to arrays of hook definitions.
 * @throws {TypeError} If a hook list is not an array or an unknown hook type is provided.
 * @example
 * hook(Users, {
 *   beforeInsert: [{
 *     fields: { email: 1 },
 *     fn(doc) {
 *       if (!doc.email) throw new Error('Email required');
 *     }
 *   }],
 *   onInserted: [{
 *     fn(doc) { console.log('Inserted user', doc._id); }
 *   }]
 * });
 */
export function hook(
  Coll, // Collection class instance
  hooksObj, // { ...[hookType]: array of hook definition  }
) {
  Object.entries(hooksObj).forEach(([hookType, hooks]) => {
    if (!isArr(hooks)) {
      throw new TypeError(`'${hookType}' hooks must be an array`);
    }

    hooks.forEach((_hook) => addHookDefinition(Coll, hookType, _hook));
  });
}

/**
 * Add a hook definition for a given collection and hook type.
 *
 * @template TColl
 * @param {TColl} Coll - Collection class instance.
 * @param {HookType} hookType - The hook type.
 * @param {HookDef} hookDef - The hook definition to add.
 * @throws {TypeError} If hookType is invalid or hookDef.fn is not a function.
 * @internal
 */
function addHookDefinition(Coll, hookType, hookDef) {
  if (!HOOK_TYPES.includes(hookType)) {
    throw new TypeError(`'${hookType}' is not a valid hook type`);
  }

  if (!isFunc(hookDef?.fn)) {
    throw new TypeError("'hook' must be a function or contain a 'fn' key");
  }

  const collHooks = getHookDefinitions(Coll);
  const prevHooks = collHooks[hookType] || [];
  const nextHooks = [...prevHooks, hookDef];
  hooksRegistry.set(Coll, { ...collHooks, [hookType]: nextHooks });
}

/**
 * Retrieve the hook definitions for a collection.
 *
 * - If hookType is omitted, returns the full record of hook arrays keyed by HookType.
 * - If hookType is provided, returns the array of HookDef for that type or undefined.
 *
 * @template TColl
 * @param {TColl} Coll - Collection class instance.
 * @param {HookType} [hookType] - Optional hook type filter.
 * @returns {Record<HookType, HookDef[]>|HookDef[]|undefined} Hook definitions.
 */
export function getHookDefinitions(Coll, hookType) {
  const collHooks = hooksRegistry.get(Coll) || {};
  if (!hookType) return collHooks;
  return collHooks[hookType];
}

/**
 * Get a combined hook for a collection and type.
 * This merges multiple HookDef into a single executable hook with:
 * - fields: combined via combineFields across all HookDef.fields
 * - before: true if any HookDef sets before=true
 * - fn: a runner that applies all matching hooks honoring their when/unless predicates
 *
 * @template TColl
 * @param {TColl} Coll - Collection class instance.
 * @param {HookType} hookType - The hook type.
 * @returns {{ fields: any, fn: HookFn, before?: boolean }|undefined} Combined hook or undefined if none.
 */
export function getHook(Coll, hookType) {
  const hookDefinitions = getHookDefinitions(Coll, hookType);

  if (!hookDefinitions) return undefined;

  return combineHookDefinitions(hookDefinitions);
}

/**
 * Combine multiple hook definitions into a single aggregated definition.
 * - fields are merged with combineFields
 * - before is true if any definition requires it
 * - fn executes all hooks (respecting when/unless) and resolves once all are done
 *
 * @param {HookDef[]} [hookDefs=[]]
 * @returns {{ fields: any, fn: HookFn, before?: boolean }|undefined}
 * @internal
 */
function combineHookDefinitions(hookDefs = []) {
  if (!hookDefs.length) return undefined;

  /* Reduce hook definitions to derive combined fields and `before` option */
  const { fields, before } = hookDefs.reduce(
    (acc, hookDef) => {
      return {
        fields: combineFields(acc.fields, hookDef.fields),
        before: acc.before || hookDef.before,
      };
    },
    { fields: null, before: undefined },
  );

  /* Given the hook type arguments, convert each hook to a handler,
   * then execute them with the arguments as part of a single promise. */
  function globalHandler(...args) {
    const handlers = hookDefs
      .map((hookDef) => hookToHandler(hookDef, ...args))
      .filter(isFunc);

    return then(
      handlers.map((handler) => handler(...args)),
      (res) => res,
    );
  }

  return { fields, fn: globalHandler, before };
}

/**
 * Convert a HookDef into an executable handler (or undefined) by applying
 * the optional unless/when predicates with the invocation arguments.
 *
 * - If unless returns truthy, the hook is skipped.
 * - If when is provided and returns falsy, the hook is skipped.
 * - Otherwise returns the hook's fn.
 *
 * @param {HookDef} param0 - Hook definition.
 * @param {...any} args - Arguments the hook would receive.
 * @returns {HookFn|undefined} The executable function or undefined if filtered out.
 * @internal
 */
function hookToHandler({ fn, unless, when }, ...args) {
  const prevented = unless?.(...args);
  if (prevented) return;

  const shouldRun = !when || when(...args);

  if (!shouldRun) return;

  return fn;
}
