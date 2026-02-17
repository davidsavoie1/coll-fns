import { isFunc, isObj, then } from "./util";
import { getProtocol } from "./protocol";
import { exists, fetchList } from "./fetch";
import { update } from "./update";
import { remove } from "./remove";

const softRemoveRegistry = new Map();

/* Configure a collection to add a `softRemove` method
 * that will first fetch the targeted docs with requested `fields`
 * and use the `when` predicate to determine which should be kept.
 * Alternatively, `docToCollSelectorPairs` can be defined as a function
 * that takes a doc and returns a list of `[Coll, selector]` tuples.
 * These will be used to fetch related documents in other collections.
 * If any reference is found, doc will be soft removed.
 * If a `keepModifier` is defined, targeted docs will get updated
 * using it. Otherwise, they will simply get ignored by the removal. */
export function registerSoftRemove(
  Coll,
  {
    docToCollSelectorPairs, // (doc) => [...[Coll, selector]]
    fields = { _id: 1 }, // Fields to fetch from documents for predicate check
    keepModifier: defaultKeepModifier, // Modifier to apply to soft removed docs
    when, // (doc) => shouldKeep
  } = {}
) {
  if (!isObj(Coll)) {
    throw new TypeError("Collection must be an object");
  }

  const protocol = getProtocol();

  const collName = protocol.getName(Coll);

  const alreadyExists = softRemoveRegistry.has(Coll);

  if (alreadyExists) {
    throw new Error(
      `'registerSoftRemove' already exists for collection '${collName}'`
    );
  }

  if (![docToCollSelectorPairs, when].some(isFunc)) {
    throw new TypeError(
      `'${collName}' 'registerSoftRemove' must provide at least one predicate.`
    );
  }

  /* Use the provided arguments to create a unified predicate. */
  function shouldKeepDoc(doc) {
    return then(isFunc(when) && when(doc), (shouldKeep) => {
      if (shouldKeep) return true;

      if (!isFunc(docToCollSelectorPairs)) return false;

      return then(
        getCollSelectorPairs(docToCollSelectorPairs, doc),
        (collSelectorPairs) =>
          then(isReferencedBy(collSelectorPairs), (referenced) => !!referenced)
      );
    });
  }

  softRemoveRegistry.set(Coll, { fields, defaultKeepModifier, shouldKeepDoc });
}

function getSortRemoveArgs(Coll) {
  const registeredArgs = softRemoveRegistry.get(Coll);

  if (!registeredArgs) {
    const protocol = getProtocol();

    const collName = protocol.getName(Coll);

    throw new Error(
      `'softRemove' must be registered with 'registerSoftRemove' before using it with collection '${collName}'`
    );
  }

  return registeredArgs;
}

/* New collection method definition. */
export function softRemove(
  Coll,
  selector = {}, // Removal selector
  keepModifier, // Modifier to apply to soft removed docs or `() => keepModifier`
  {
    detailed = false, // A detailed result `{ removed, updated }` can be returned instead of default total cound
  } = {}
) {
  const { fields, shouldKeepDoc, defaultKeepModifier } =
    getSortRemoveArgs(Coll);

  /* Return total or detailed counts. */
  function formatResult({ removed = 0, updated = null }) {
    if (detailed) return { removed, updated };
    return (removed ?? 0) + (updated ?? 0);
  }

  return then(
    /* Fetch docs targeted by the removal
     * with provided fields and without transform. */
    fetchList(Coll, selector, {
      fields: { ...(fields ?? {}), _id: 1 },
      transform: null,
    }),

    (targetedDocs) => {
      /* Apply predicate on each doc and return its _id or null */
      return then(
        targetedDocs.map((doc) =>
          then(shouldKeepDoc(doc), (keep) => (keep ? doc._id : null))
        ),

        (docsResults) => {
          /* Keep only ids to keep */
          const idsToKeep = docsResults.filter((_id) => _id !== null);

          /* If no doc targeted for sort remove, simply proceed with removal. */
          if (!idsToKeep.length) {
            return then(remove(Coll, selector), (removed) =>
              formatResult({ removed })
            );
          }

          return then(
            normalizeKeepModifier(keepModifier ?? defaultKeepModifier),
            (actModifier) => {
              /* Otherwise, execute one removal and maybe one update */
              return then(
                [
                  remove(Coll, {
                    $and: [
                      isObj(selector) ? selector : { _id: selector },
                      { _id: { $nin: idsToKeep } },
                    ],
                  }),
                  actModifier
                    ? update(Coll, { _id: { $in: idsToKeep } }, actModifier)
                    : null,
                ],
                ([removed, updated]) => formatResult({ removed, updated })
              );
            }
          );
        }
      );
    }
  );
}

/* Take a doc and return a list of `[Coll, selector]` tuples. */
function getCollSelectorPairs(docToCollSelectorPairs, doc) {
  return then(docToCollSelectorPairs(doc), (collSelectorPairs) => {
    /* Validate shape of returned value. */
    if (
      !Array.isArray(collSelectorPairs) ||
      !collSelectorPairs.every(isValidCollSelector)
    ) {
      throw new TypeError(
        "'docToCollSelectorPairs' should return an array of '[Coll, selector]' tuples"
      );
    }

    return collSelectorPairs;
  });
}

/* Given a list of `[Coll, selector]` tuples,
 * check if at least one of them returns at least one doc. */
function isReferencedBy(collSelectorPairs = []) {
  return then(
    collSelectorPairs.map(([Coll, selector]) => exists(Coll, selector)),
    (results) => results.some((res) => res)
  );
}

function normalizeKeepModifier(keepModifier) {
  if (isValidKeepModifier(keepModifier)) return keepModifier || null;

  if (isFunc(keepModifier)) {
    return then(keepModifier(), (res) => {
      if (isValidKeepModifier(res)) return res || null;

      throw new TypeError(
        "'keepModifier' must be a valid modifier, a falsy value or a function that returns one of those."
      );
    });
  }

  throw new TypeError(
    "'keepModifier' must be a valid modifier, a falsy value or a function that returns one of those."
  );
}

function isValidKeepModifier(keepModifer) {
  return !keepModifer || isObj(keepModifer);
}

function isValidCollSelector(tuple) {
  return (
    Array.isArray(tuple) &&
    tuple.length === 2 &&
    isObj(tuple[0]) &&
    isValidSelector(tuple[1])
  );
}

function isValidSelector(selector) {
  return isObj(selector) || typeof selector === "string";
}
