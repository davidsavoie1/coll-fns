import { fetchList } from "./fetch";
import { combineFields } from "./fields";
import { getHook } from "./hook";
import { getProtocol } from "./protocol";
import { indexById, isFunc, then } from "./util";

/* Update document inside a collection.
 * Wrapped by `beforeUpdate` and `onUpdated` hooks.
 * Written with `then` helper and callbacks ON PURPOSE
 * so that it can be used either with a synchronous
 * or asynchronous protocol without any difference. */
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
        /* Execute `beforeUpdate` hook if defined */
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

                /* Pass the before and after versions to each comparator. */
                (afterDocs) => {
                  /* Pass each after and before pairs to hook.
                   * Do NOT await, should run asynchronously if protocol allows. */
                  afterDocs.forEach((after) => {
                    const before = beforeById[after._id];
                    onUpdatedHook.fn(after, before);
                  });

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
