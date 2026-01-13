import { fetchList } from "./fetch";
import { combineFields } from "./fields";
import { getHook } from "./hook";
import { getProtocol } from "./protocol";
import { fireAndForget, indexById, isFunc, then } from "./util";

/**
 * Update documents in a collection with hook support.
 *
 * Execution flow (sync or async depending on the active protocol):
 * 1) Determine the minimal fields to prefetch for hooks (union of beforeUpdate/onUpdated needs).
 * 2) If any hook exists, fetch the target documents once with those fields (limit 1 if multi=false).
 * 3) Run `beforeUpdate` hook with (docs, modifier) if present.
 * 4) Execute protocol.update(Coll, selector, modifier, options).
 * 5) If some docs were modified and `onUpdated` exists:
 *    - Re-fetch affected docs by _id with `onUpdated.fields`
 *    - Call `onUpdated(afterDoc, beforeDoc)` for each (fire-and-forget).
 *
 * Notes:
 * - Uses `then` helper to normalize sync/async protocols and hooks.
 * - `onUpdated` is not awaited; it is intended for side effects.
 *
 * @template TColl
 * @param {TColl} Coll - The collection instance.
 * @param {Object} selector - MongoDB-style selector to match documents.
 * @param {Object} modifier - MongoDB-style update modifier (e.g., {$set: {...}}).
 * @param {Object} [options] - Update options.
 * @param {boolean} [options.multi=true] - Update multiple documents by default.
 * @returns {number|Promise<number>} Number of modified documents (driver-dependent).
 *
 * @example
 * // Activate all pending users
 * await update(Users, { status: 'pending' }, { $set: { status: 'active' } }, { multi: true });
 *
 * @example
 * // Update a single document
 * await update(Users, { _id }, { $set: { name: 'Alice' } }, { multi: false });
 */
export function update(
  Coll,
  selector,
  modifier,
  {
    multi = true, // Ensure update targets multiple documents by default.
    ...restOptions
  } = {}
) {
  const protocol = getProtocol();

  const beforeUpdateHook = getHook(Coll, "beforeUpdate");
  const onUpdatedHook = getHook(Coll, "onUpdated");

  const options = { multi, ...restOptions };

  // Fields to prefetch before update (null => no hooks => no prefetch)
  const fieldsBefore = getBeforeFields(beforeUpdateHook, onUpdatedHook);

  return then(
    /* Fetch docs only if at least one hook has been defined. */
    fieldsBefore === null
      ? []
      : fetchList(Coll, selector, {
          fields: fieldsBefore,
          limit: multi ? undefined : 1,
        }),
    (docs) => {
      return then(
        /* Run `beforeUpdate` hook if defined.
         * Can throw an error to prevent update. */
        isFunc(beforeUpdateHook?.fn) && beforeUpdateHook.fn(docs, modifier),

        () => {
          return then(
            /* Execute the update */
            protocol.update(Coll, selector, modifier, options),

            (updatedCount) => {
              /* If update didn't work, don't execute comparators. */
              if (!updatedCount || !isFunc(onUpdatedHook?.fn))
                return updatedCount;

              /* Save a version of targeted docs prior to the update */
              const beforeById = indexById(docs);

              return then(
                /* Fetch again each targeted document by its previously saved _id */
                fetchList(
                  Coll,
                  { _id: { $in: Object.keys(beforeById) } },
                  { fields: onUpdatedHook.fields }
                ),

                (afterDocs) => {
                  /* Pass each after and before pairs to `onUpdated` hook.
                   * Do NOT await, should run asynchronously if protocol allows. */
                  fireAndForget(
                    () =>
                      afterDocs.forEach((after) => {
                        const before = beforeById[after._id];
                        onUpdatedHook.fn(after, before);
                      }),
                    // eslint-disable-next-line no-console
                    (err) => console?.error("'onUpdated' error:", err)
                  );

                  return updatedCount;
                }
              );
            }
          );
        }
      );
    }
  );
}

/**
 * Compute fields to prefetch before the update for hooks.
 *
 * Returns:
 * - null if no hooks are defined (signals "no prefetch needed")
 * - the union of:
 *   - beforeUpdate.fields (if any)
 *   - onUpdated.fields, or {_id:1} if onUpdated.before is falsy
 *
 * @param {{fields?: import('./fields').FieldSpec|true|undefined}|undefined} beforeHook
 * @param {{fields?: import('./fields').FieldSpec|true|undefined, before?: boolean}|undefined} afterHook
 * @returns {import('./fields').FieldSpec|true|undefined|null}
 *   Combined fields, or null if there are no hooks at all.
 * @internal
 */
function getBeforeFields(beforeHook, afterHook) {
  /* If no hooks, return null */
  if (!beforeHook && !afterHook) return null;

  if (!afterHook) return beforeHook?.fields;

  const { fields, before } = afterHook;

  /* If `before` is false, documents before update are not necessary.
   * Only their ids will be fetched so after update documents
   * can be retrieved. */
  const fieldsBefore = before ? fields : { _id: 1 };

  if (!beforeHook) return fieldsBefore;

  return combineFields(beforeHook.fields, fieldsBefore);
}
