import { fetchList } from "./fetch";
import { combineFields } from "./fields";
import { getHook } from "./hook";
import { getProtocol } from "./protocol";
import { fireAndForget, isFunc, then } from "./util";

/**
 * Remove documents from a collection with hook support.
 *
 * Execution flow (sync or async depending on the active protocol):
 * 1) Compute the minimal fields to fetch for hooks (union of beforeRemove/onRemoved fields).
 * 2) If any hook is defined, fetch the matching documents once with those fields.
 * 3) Run `beforeRemove` hook (if present) with the array of docs.
 * 4) Call protocol.remove(Coll, selector).
 * 5) If something was removed and `onRemoved` exists, call it once per doc (fire-and-forget).
 *
 * Notes:
 * - Uses the `then` helper to normalize sync/async protocols and hooks.
 * - `onRemoved` is intentionally not awaited; it runs after remove is triggered.
 * - If no hooks are registered, no pre-fetch is performed.
 *
 * @template TColl
 * @param {TColl} Coll - The collection instance to remove from.
 * @param {Object} selector - MongoDB-style query selector.
 * @returns {number|Promise<number>} The number of removed documents (driver-dependent).
 *
 * @example
 * // Basic usage
 * const removed = await remove(Users, { inactive: true });
 *
 * @example
 * // With hooks configured elsewhere
 * // beforeRemove could check permissions; onRemoved could clear caches
 * const n = await remove(Posts, { authorId });
 */
export function remove(Coll, selector) {
  const protocol = getProtocol();

  const beforeRemoveHook = getHook(Coll, "beforeRemove");
  const onRemovedHook = getHook(Coll, "onRemoved");

  // Union of fields requested by before/on hooks; null means "no hooks, no fetch"
  const globalFields = getBeforeFields(beforeRemoveHook, onRemovedHook);

  return then(
    // Fetch docs only when at least one hook exists
    globalFields === null
      ? []
      : fetchList(Coll, selector, { fields: globalFields }),

    (docs) => {
      return then(
        // Run `beforeRemove` if defined
        isFunc(beforeRemoveHook?.fn) && beforeRemoveHook.fn(docs),

        () => {
          // Execute actual removal (can be sync or a Promise<number>)
          const removedCount = protocol.remove(Coll, selector);

          // If removal did nothing or there is no onRemoved hook, return as-is
          if (!removedCount || !isFunc(onRemovedHook?.fn)) return removedCount;

          /* Pass each (pre-fetched) doc to `onRemoved` hook.
           * Do NOT await, should run asynchronously if protocol allows. */
          fireAndForget(
            () => docs.forEach((doc) => onRemovedHook.fn(doc)),
            // eslint-disable-next-line no-console
            (err) => console?.error("'onRemoved' error:", err)
          );

          return removedCount;
        }
      );
    }
  );
}

/**
 * Compute the union of the fields requested by provided hook definitions.
 *
 * Returns:
 * - null when no hooks are provided (signals "no pre-fetch needed")
 * - a FieldSpec (possibly undefined meaning "all fields") combining hook fields
 *
 * @param {...{fields?: import('./fields').FieldSpec|true|undefined}|undefined} maybeHooks
 * @returns {import('./fields').FieldSpec|true|undefined|null}
 *   Combined fields, or null if there were no hooks at all.
 * @internal
 */
function getBeforeFields(...maybeHooks) {
  const hookDefs = maybeHooks.filter((hookDef) => hookDef);
  if (!hookDefs.length) return null;

  return hookDefs.reduce(
    (fields, hookDef) => combineFields(fields, hookDef.fields),
    null
  );
}
