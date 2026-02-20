import { combineFields } from "./fields";
import { getProtocol } from "./protocol";
import { isArr, isFunc, isPromise, then } from "./util";
import { _getLockedPool } from "./pool";

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

/* Hook types that are fire-and-forget.
 * These are should not rethrow errors to the calling context,
 * since it might crash the process if unhandled.
 * They will hence receive a default error handler if not defined by the user. */
const FIRE_AND_FORGET_HOOK_TYPES = ["onInserted", "onUpdated", "onRemoved"];

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
 * Can return a boolean or a Promise<boolean>.
 * @typedef {(...args:any[]) => boolean|Promise<boolean>} HookUnlessPredicate
 */

/**
 * Optional predicate that must be truthy for the hook to run.
 * Receives the same arguments as the HookFn.
 * Can return a boolean or a Promise<boolean>.
 * @typedef {(...args:any[]) => boolean|Promise<boolean>} HookWhenPredicate
 */

/**
 * Optional error handler for hooks.
 * Called when a hook function throws an error (typically in fire-and-forget hooks).
 * Receives the enhanced hook definition which includes metadata (Coll, collName, hookType).
 * @typedef {(err:Error, hookDef:EnhancedHookDef) => void} HookErrorHandler
 */

/**
 * Hook definition object.
 * - before:   Only meaningful for "onUpdated". If true, the "before" document should be fetched.
 * - fields:   Projection of fields to fetch for the documents the hook needs.
 *             Combined across all hooks of the same type via combineFields.
 *             `undefined` or `true` means "all fields".
 * - fn:       The hook function (required).
 * - onError:  Optional error handler. For non-throwing hook types (onInserted, onUpdated,
 *             onRemoved), a default handler is provided if not specified.
 * - unless:   Optional predicate; if truthy, prevents the hook from running.
 * - when:     Optional predicate; if truthy, allows the hook to run.
 * @typedef {Object} HookDef
 * @property {boolean} [before]
 * @property {import('./fields').FieldSpec|true|undefined} [fields]
 * @property {HookFn} fn
 * @property {boolean} [fireAndForget] Internal flag to indicate deferred execution mode.
 * @property {HookErrorHandler} [onError]
 * @property {HookUnlessPredicate} [unless]
 * @property {HookWhenPredicate} [when]
 */

/**
 * Enhanced hook definition with internal metadata added by the framework.
 * Extends user-provided HookDef with:
 * - Coll: The collection instance
 * - collName: String name of the collection
 * - hookType: The hook type (beforeInsert, onInserted, etc.)
 * - onError: Guaranteed to be defined (user-provided or default handler)
 * @typedef {HookDef & {Coll: any, collName: string, hookType: HookType, onError: HookErrorHandler}} EnhancedHookDef
 */

/**
 * Single registry holding hook definitions per collection instance.
 * Map<CollectionInstance, Record<HookType, HookDef[]>>
 * @type {Map<*, Record<HookType, HookDef[]>>}
 * @internal
 */
const hooksRegistry = new Map();

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
 *     fn(doc) {
 *       if (!doc.email) throw new Error('Email required');
 *     }
 *   }],
 *   onInserted: [{
 *     fields: { email: 1 },
 *     fn(doc) { console.log('Inserted user', doc); }
 *   }]
 * });
 */
export function hook(
  Coll, // Collection class instance
  hooksObj // { ...[hookType]: array of hook definition  }
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
 * Enhances the hook definition with metadata (Coll, collName, hookType, onError).
 * For non-throwing hook types (onInserted, onUpdated, onRemoved), attaches a default
 * error handler that logs to console.error if no custom onError is provided.
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

  const { getName } = getProtocol();

  const collHooks = getHookDefinitions(Coll);
  const prevHooks = collHooks[hookType] || [];

  const noThrow = FIRE_AND_FORGET_HOOK_TYPES.includes(hookType);
  const defaultOnError = noThrow ? defaultErrorHandler : undefined;

  /* Enhance hook definition with metadata and default error handling.
   * For fire-and-forget hooks (onInserted, onUpdated, onRemoved),
   * a default console error handler is provided unless explicitly overridden. */
  const enhancedHookDef = {
    onError: defaultOnError,
    ...hookDef,
    Coll,
    collName: getName(Coll),
    hookType,
  };

  const nextHooks = [...prevHooks, enhancedHookDef];
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
function getHookDefinitions(Coll, hookType) {
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

  const fireAndForget = FIRE_AND_FORGET_HOOK_TYPES.includes(hookType);

  return combineHookDefinitions(hookDefinitions, fireAndForget);
}

/* Calls pool to use. Will be lazily defined on first hooks processing. */
let callsPool;

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
function combineHookDefinitions(
  hookDefs = [],
  fireAndForget = false // Should the hooks be fired and forgotten?
) {
  if (!hookDefs.length) return undefined;

  const { fields, before } = combineHookOptions(hookDefs);

  /* Create a combined hook definition which handler function will
   * run each hook with the provided arguments.
   * Hooks are executed for side effects only; their return values are ignored. */
  return {
    before,
    fields,
    fn(...args) {
      if (fireAndForget) {
        hookDefs.forEach((hookDef) =>
          poolHook({ ...hookDef, fireAndForget }, ...args)
        );
        return;
      }

      return then(hookDefs.map((hookDef) => runHook(hookDef, ...args)));
    },
  };
}

/* Reduce hook definitions to derive combined fields and `before` option */
function combineHookOptions(hookDefs = []) {
  return hookDefs.reduce(
    (acc, hookDef) => {
      return {
        fields: combineFields(acc.fields, hookDef.fields),
        before: acc.before || hookDef.before,
      };
    },
    { fields: null, before: undefined }
  );
}

function poolHook(hookDef = {}, ...args) {
  const pool = callsPool ?? initPool();
  pool.add(runHook, hookDef, ...args);
}

/**
 * Convert a HookDef into an executable handler (or undefined) by applying
 * the optional unless/when predicates with the invocation arguments.
 *
 * - If unless returns truthy, the hook is skipped.
 * - If when is provided and returns falsy, the hook is skipped.
 * - If an onError handler is defined, wraps the hook function in a try-catch
 *   to prevent errors from propagating (used for fire-and-forget hooks).
 * - Otherwise returns the hook's fn unwrapped.
 *
 * @param {HookDef} param0 - Hook definition.
 * @param {...any} args - Arguments the hook would receive.
 * @returns {HookFn|undefined} The executable function or undefined if filtered out.
 * @internal
 */
function runHook(hookDef = {}, ...args) {
  const { fireAndForget, fn, onError, unless, when } = hookDef;
  const { bindEnvironment } = getProtocol();

  /* Protocol might add a `bindEnvironment` function (ex: Meteor.bindEnvironment with Fibers)
   * that must be used if provided. */
  function runInEnvironment(fn, ...args) {
    if (!isFunc(fn)) return;

    if (!fireAndForget || !isFunc(bindEnvironment)) {
      return fn(...args);
    }

    return bindEnvironment(fn)(...args);
  }

  if (!isFunc(fn)) return;
  const handleError = (err) => {
    if (!isFunc(onError)) throw err;
    runInEnvironment(onError, err, hookDef);
  };

  /* Normalize sync/async hooks without forcing a Promise return
   * for fully synchronous paths. */
  try {
    const maybeResult = then(runInEnvironment(unless, ...args), (prevented) => {
      if (prevented) return;

      const maybeShouldRun = !when || runInEnvironment(when, ...args);
      return then(maybeShouldRun, (shouldRun) => {
        if (!shouldRun) return;
        return runInEnvironment(fn, ...args);
      });
    });

    if (!isPromise(maybeResult)) return maybeResult;
    return maybeResult.catch(handleError);
  } catch (err) {
    return handleError(err);
  }
}

function defaultErrorHandler(err, { collName, hookType }) {
  // eslint-disable-next-line no-console
  console?.error(
    `Error in '${hookType}' hook of '${collName}' collection:`,
    err
  );
}

/* Initialize calls pool. */
function initPool() {
  if (callsPool) return callsPool;

  /* Return the configured pool and lock it */
  callsPool = _getLockedPool();
  return callsPool;
}
