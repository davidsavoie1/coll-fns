import { fetchOne } from "./fetch";
import { getHook } from "./hook";
import { getProtocol } from "./protocol";
import { fireAndForget, isFunc, then } from "./util";

/**
 * Insert a document into a collection with hook support.
 *
 * Execution flow (sync or async depending on the active protocol):
 * 1) Run `beforeInsert` hook if defined: can validate the doc.
 * 2) Call protocol.insert(Coll, doc) to perform the insertion.
 * 3) Run `onInserted` hook if defined:
 *    - If the hook requests only {_id: 1}, pass {_id} directly.
 *    - Otherwise fetch the inserted document with the requested fields,
 *      then pass it to the hook.
 *
 * Notes:
 * - Uses the `then` helper to normalize sync/async protocols and hooks.
 * - Does not await `onInserted` (fire-and-forget side effects).
 *
 * @template TColl
 * @param {TColl} Coll - The collection instance to insert into.
 * @param {Object} doc - The document to insert (will be passed to beforeInsert hooks).
 * @returns {any|Promise<any>} The inserted document _id (type depends on protocol/driver).
 *
 * @example
 * // Basic usage
 * const _id = await insert(Users, { name: 'Alice', email: 'a@ex.com' });
 */
export function insert(Coll, doc) {
  const protocol = getProtocol();
  const beforeInsertHook = getHook(Coll, "beforeInsert");

  return then(
    /* Run `beforeInsert` if present (may mutate/validate doc).
     * Can throw an error to prevent insertion. */
    isFunc(beforeInsertHook?.fn) && beforeInsertHook.fn(doc),

    () => {
      const onInsertedHook = getHook(Coll, "onInserted");

      return then(
        // Perform actual insert via protocol
        protocol.insert(Coll, doc),

        (_id) => {
          if (!onInsertedHook) return _id;

          const { fields, fn: onInserted } = onInsertedHook;

          // If hook only needs _id, no fetch is necessary
          const fieldKeys = fields ? Object.keys(fields) : [];
          const _idOnly = fieldKeys.length === 1 && fieldKeys[0] === "_id";

          return then(
            // Fetch inserted doc or pass {_id} directly
            _idOnly ? { _id } : fetchOne(Coll, { _id }, { fields }),

            (insertedDoc) => {
              /* Pass inserted doc to `onInserted` hook.
               * Do NOT await, should run asynchronously if protocol allows. */
              fireAndForget(
                () => onInserted(insertedDoc),
                // eslint-disable-next-line no-console
                (err) => console?.error("'onInserted' error:", err)
              );

              return _id;
            }
          );
        }
      );
    }
  );
}
