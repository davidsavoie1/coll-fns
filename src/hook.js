import { combineFields } from "./fields";
import { isArr, isFunc, then } from "./util";

const HOOK_TYPES = [
  "beforeInsert", // (docToInsert)
  "beforeUpdate", // (docsToUpdate, modifier)
  "beforeRemove", // (docsToRemove)

  "onInserted", // (doc)
  "onUpdated", // (doc, before)
  "onRemoved", // (doc)
];

/* Single map that holds definitions of hooks by collection name */
const hooksDictionnary = new Map();

/*
 *  hookDef = {
 *    before, // Bool. onUpdated only. When true, fetch document before update. Otherwise, document will be fetched, but only with its _id field to know which docs to retrieve after the update.
 *    fields, // Fields of document to fetch. Will be combined for all hooks of the same type. `undefined` or `true` means all fields and subsequent field restrictions won't apply.
 *    fn, // (doc, before<onUpdated>) => side effect. Function to run as hook
 *    unless, // (doc, before<onUpdated>) => bool. Predicate to prevent hook from running
 *    when, // (doc, before<onUpdated>) => bool. Predicate to run the hook
 *  };
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

/* Add a hook to a collection method's list of hooks. */
function addHookDefinition(
  Coll, // Collection class instance
  hookType, // Type of hook on which to add the hook (insert, update, remove)
  hookDef // The hook definition
) {
  if (!HOOK_TYPES.includes(hookType)) {
    throw new TypeError(`'${hookType}' is not a valid hook type`);
  }

  if (!isFunc(hookDef?.fn)) {
    throw new TypeError("'hook' must be a function or contain a 'fn' key");
  }

  const collHooks = getHookDefinitions(Coll);
  const prevHooks = collHooks[hookType] || [];
  const nextHooks = [...prevHooks, hookDef];
  hooksDictionnary.set(Coll, { ...collHooks, [hookType]: nextHooks });
}

/* Retrieve the hooks defined for a collection. */
export function getHookDefinitions(
  Coll, // Collection class instance
  hookType // Type of hook definitions to retrieve. Return them all if not defined.
) {
  const collHooks = hooksDictionnary.get(Coll) || {};
  if (!hookType) return collHooks;

  return collHooks[hookType];
}

export function getHook(Coll, hookType) {
  const hookDefinitions = getHookDefinitions(Coll, hookType);

  if (!hookDefinitions) return undefined;

  return combineHookDefinitions(hookDefinitions);
}

/* Combine multiple hook definitions together as a single simplified one. */
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
    { fields: null, before: undefined }
  );

  /* Given the hook type arguments, convert each hook to a handler,
   * then execute them with the arguments as part of a single promise. */
  function globalHandler(...args) {
    const handlers = hookDefs
      .map((hookDef) => hookToHandler(hookDef, ...args))
      .filter(isFunc);

    return then(
      handlers.map((handler) => handler(...args)),
      (res) => res
    );
  }

  return { fields, fn: globalHandler, before };
}

/* Apply arguments to optional `unless` and `when`
 * predicate functions potentially return a handler. */
function hookToHandler({ fn, unless, when }, ...args) {
  const prevented = unless?.(...args);
  if (prevented) return;

  const shouldRun = !when || when(...args);

  if (!shouldRun) return;

  return fn;
}
