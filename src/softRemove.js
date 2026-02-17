import { isFunc, isObj, then } from "./util";
import { getProtocol } from "./protocol";
import { exists, fetchList } from "./fetch";
import { update } from "./update";
import { remove } from "./remove";

const softRemoveRegistry = new Map();

/**
 * Register soft-remove behavior for a collection.
 *
 * The registered config is consumed by `softRemove(Coll, ...)`:
 * - fetches target docs with `fields`
 * - keeps docs when `when(doc)` is truthy and/or when
 *   `docToCollSelectorPairs(doc)` resolves to at least one existing reference
 * - optionally applies `keepModifier` to kept docs during softRemove.
 *
 * At least one predicate source must be provided:
 * - `when`
 * - `docToCollSelectorPairs`
 *
 * @template TColl
 * @param {TColl} Coll - Collection instance to register.
 * @param {Object} [options={}]
 * @param {(doc:any) => boolean|Promise<boolean>} [options.when]
 *   Predicate returning whether a targeted doc should be kept.
 * @param {(doc:any) => Array<[any, Object|string]>|Promise<Array<[any, Object|string]>>} [options.docToCollSelectorPairs]
 *   Function returning `[Coll, selector]` tuples to check references with `exists(...)`.
 *   If any reference exists, the doc is kept.
 * @param {Object} [options.fields={_id:1}]
 *   Fields fetched from targeted docs before predicate evaluation (`_id` is always included).
 * @param {Object|(() => Object|Promise<Object>)|null|undefined} [options.keepModifier]
 *   Default modifier (or factory) applied to kept docs when `softRemove` is called
 *   without an explicit keepModifier argument.
 *
 * @throws {TypeError} If Coll is not an object, or if no predicate is provided.
 * @throws {Error} If soft-remove is already registered for the collection.
 *
 * @example
 * registerSoftRemove(Posts, {
 *   when(post) {
 *     return post.locked === true;
 *   },
 *   fields: { _id: 1, locked: 1 },
 * });
 *
 * @example
 * registerSoftRemove(Users, {
 *   docToCollSelectorPairs(user) {
 *     return [
 *       [Posts, { authorId: user._id }],
 *       [Comments, { authorId: user._id }],
 *     ];
 *   },
 *   keepModifier: () => ({
 *     $set: { removedAt: new Date(), status: "archived" },
 *   }),
 * });
 */
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

/**
 * Soft-remove documents from a collection based on pre-registered keep predicates.
 *
 * Flow:
 * 1) Fetch docs matching selector with registered fields.
 * 2) Keep docs that match `when` and/or `docToCollSelectorPairs` predicates.
 * 3) Remove docs not kept.
 * 4) Optionally update kept docs with keepModifier.
 *
 * Notes:
 * - Requires prior registration with `registerSoftRemove(Coll, ...)`.
 * - Uses `coll-fns` `remove`/`update` internally, so corresponding hooks still run.
 * - Works with sync and async protocols.
 *
 * @template TColl
 * @param {TColl} Coll - Collection instance.
 * @param {Object|string} [selector={}] - Selector of docs to target.
 * @param {Object|(() => Object|Promise<Object>)|null|undefined} [keepModifier]
 *   Modifier to apply to kept docs, or a (possibly async) factory returning one.
 *   If omitted, falls back to the registered default keepModifier.
 *   If falsy, kept docs are ignored (not removed, not updated).
 * @param {{detailed?: boolean}} [options={}]
 * @param {boolean} [options.detailed=false]
 *   When true, returns `{ removed, updated }`; otherwise returns `removed + updated`.
 * @returns {number|{removed:number, updated:number|null}|Promise<number|{removed:number, updated:number|null}>}
 *
 * @example
 * // Basic usage
 * const total = await softRemove(Posts, { authorId });
 *
 * @example
 * // Detailed usage with runtime keep modifier
 * const res = await softRemove(
 *   Posts,
 *   { _id: postId },
 *   () => ({ $set: { removedAt: new Date() } }),
 *   { detailed: true }
 * );
 * // => { removed, updated }
 */
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
