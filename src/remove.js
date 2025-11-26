import { fetchList } from "./fetch";
import { combineFields } from "./fields";
import { getHook } from "./hook";
import { getProtocol } from "./protocol";
import { isFunc, then } from "./util";

/* Remove document inside a collection.
 * Wrapped by `beforeRemove` and `onRemoved hooks.
 * Written with `then` helper and callbacks ON PURPOSE
 * so that it can be used either with a synchronous
 * or asynchronous protocol without any difference. */
export function remove(Coll, selector) {
  const protocol = getProtocol();

  const beforeRemoveHook = getHook(Coll, "beforeRemove");
  const onRemovedHook = getHook(Coll, "onRemoved");

  const globalFields = getBeforeFields(beforeRemoveHook, onRemovedHook);

  return then(
    /* Fetch docs only if at least one hook has been defined. */
    globalFields === null
      ? []
      : fetchList(Coll, selector, { fields: globalFields }),

    (docs) => {
      return then(
        /* Execute `beforeRemove` hook if defined */
        isFunc(beforeRemoveHook?.fn) && beforeRemoveHook.fn(docs),

        () => {
          /* Execute actual removal */
          const removedCount = protocol.remove(Coll, selector);

          /* If removal didn't do anything, do not pass docs to hook */
          if (!removedCount || !isFunc(onRemovedHook?.fn)) return removedCount;

          /* Pass each doc to hook.
           * Do NOT await with `then`, should run asynchronously if protocol allows. */
          docs.forEach((doc) => onRemovedHook.fn(doc));

          return removedCount;
        }
      );
    }
  );
}

/* Return a valid field object (including `undefined` for all)
 * or `null` if no hook definition was provided as argument. */
function getBeforeFields(...maybeHooks) {
  const hookDefs = maybeHooks.filter((hookDef) => hookDef);
  if (!hookDefs.length) return null;

  return hookDefs.reduce(
    (fields, hookDef) => combineFields(fields, hookDef.fields),
    null
  );
}
