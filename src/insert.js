import { fetchOne } from "./fetch";
import { getHook } from "./hook";
import { getProtocol } from "./protocol";
import { isFunc, then } from "./util";

/* Insert document inside a collection.
 * Wrapped by `beforeInsert` and `onInserted` hooks.
 * Written with `then` helper and callbacks ON PURPOSE
 * so that it can be used either with a synchronous
 * or asynchronous protocol without any difference. */
export function insert(Coll, doc) {
  const protocol = getProtocol();
  const beforeInsertHook = getHook(Coll, "beforeInsert");

  return then(
    /* Execute `beforeInsert` hook if defined */
    isFunc(beforeInsertHook?.fn) && beforeInsertHook.fn(doc),

    () => {
      const onInsertedHook = getHook(Coll, "onInserted");

      return then(
        /* Execute actual insert */
        protocol.insert(Coll, doc),

        (_id) => {
          if (!onInsertedHook) return _id;

          const { fields, fn: onInserted } = onInsertedHook;

          /* Handle case where the only requested field is _id,
           * since no fetch is then necessary */
          const fieldKeys = fields ? Object.keys(fields) : [];

          const _idOnly = fieldKeys.length === 1 && fieldKeys[0] === "_id";

          return then(
            /* Fetch inserted doc or minimally use only its inserted _id */
            _idOnly ? { _id } : fetchOne(Coll, { _id }, { fields }),

            (insertedDoc) => {
              /* Do NOT await the after update hook with `then` */
              onInserted(insertedDoc);

              return _id;
            }
          );
        }
      );
    }
  );
}
