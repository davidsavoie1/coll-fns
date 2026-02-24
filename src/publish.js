import { nanoid } from "nanoid/non-secure";
import { getProtocol } from "./protocol";
import { fetchOne } from "./fetch";
import { isArr, isFunc, isObj } from "./util";
import { createPool } from "./pool";
import { dispatchFields } from "./fields";
import { getJoins } from "./join";

const MAX_CONCURRENT = 10; // Maximum number of concurrent observer creation processed

const COLL_DOC_SEPARATOR = "|";
const KEY_SEPARATOR = "|";

const DEBUG = {
  BYPASSED: "BYPASSED",
  CANCELLED: "CANCELLED",
  CREATED: "CREATED",
  CREATING: "CREATING",
  INVALIDATED: "INVALIDATED",
  DOC_ADDED: "DOC_ADDED",
  DOC_CHANGED: "DOC_CHANGED",
  DOC_REMOVED: "DOC_REMOVED",
  READY: "READY",
  REUSED: "REUSED",
  STOPPED: "STOPPED",
  UNFOLLOWED: "UNFOLLOWED",
};

/**
 * Publication context compatible with Meteor publish handlers.
 * @typedef {Object} PublicationContext
 * @property {(coll:string, id:any, fields:Object) => void} [added]
 * @property {(coll:string, id:any, fields:Object) => void} [changed]
 * @property {(coll:string, id:any) => void} [removed]
 * @property {() => void} ready
 * @property {(error:unknown) => void} [error]
 * @property {(stopFn:Function) => void} [onStop]
 */

/**
 * Child selector supported by publish children:
 * - static selector object
 * - selector function receiving ancestors
 * - join-array selector [from, to, toSelector?]
 * @typedef {Object|Function|Array} PublishSelector
 */

/**
 * Child observer dependencies used to decide invalidation on parent change.
 * Key matching is flat (exact key in changed fields), not deep path traversal.
 * Object deps are supported and converted to a list of top-level truthy keys.
 * @typedef {boolean|string|string[]|Set<string>|Object|Function|undefined} PublishDeps
 */

/**
 * Child publication args for nested observers.
 * May be explicit (`Coll` + `on`) or join shorthand (`join` key).
 * @typedef {Object} PublishChildArgs
 * @property {*} [Coll]
 * @property {string} [join]
 * @property {PublishSelector} [on]
 * @property {PublishSelector} [selector] Backward-compatible alias for `on`.
 * @property {Object} [fields]
 * @property {PublishDeps} [deps]
 * @property {PublishChildArgs[]} [children]
 * @property {boolean|Object} [debug]
 */

/**
 * Root publish args.
 * @typedef {Object} PublishArgs
 * @property {*} Coll
 * @property {PublishSelector} selector Root selector passed as `publish(..., selector, ...)`.
 * @property {Object} [fields]
 * @property {PublishChildArgs[]} [children]
 * @property {PublishDeps} [deps]
 * @property {boolean|Object} [debug]
 */

/**
 * Extra publish runtime options.
 * @typedef {Object} PublishOptions
 * @property {number} [maxConcurrent=10] Maximum concurrent child observer creations.
 */

/**
 * Create a reactive publication tree using protocol observation + nested children.
 *
 * `children` can be declared in two ways:
 * - explicit child args (`{ Coll, on, ... }`)
 * - join shorthand (`{ join: "joinKey", ... }`) resolved from `join()` definitions
 *
 * Join children can also be derived implicitly from parent `fields`.
 *
 * @param {PublicationContext} publication Publication callbacks context.
 * @param {*} Coll Root collection.
 * @param {PublishSelector} selector Root selector.
 * @param {PublishOptions} [options={}] Internal scheduling options.
 * @returns {Promise<{stop: Function}>} Handle with a `stop` method.
 */
export async function publish(
  publication, // { added, changed, removed, ready, error, onStop }
  Coll,
  selector,
  options = {}
) {
  if (!isFunc(publication.ready)) {
    throw new Error(
      "'publication' context with a 'ready' method must be passed to 'publish'"
    );
  }

  const args = { ...options, Coll, selector };

  try {
    return await runPublication(publication, args);
  } catch (error) {
    if (isFunc(publication.error)) {
      publication.error(error);
    } else {
      throw error;
    }
  }
}

/**
 * Internal publication runner.
 * Creates/reuses observers, manages nested subscriptions, and handles cleanup.
 *
 * @param {PublicationContext} publication
 * @param {PublishArgs} [args={}]
 * @param {PublishOptions} [options={}]
 * @returns {Promise<{stop: Function}>}
 */
async function runPublication(publication, args = {}) {
  const log = createDebugLog(args.debug);

  /* Remove options that are relevant (or should be discarded) only on root */
  const { maxConcurrent, on, ...rest } = args;

  /* Publication-level stop flag to prevent late observers from leaking. */
  let publicationStopped = false;

  /* === REGISTRIES ===
   * Create registries inside publication to create closures. */

  /* Map of `observerId.docId` => Set(...observers) */
  const observersByFollowers = createRegistry();

  /* Map of observer by key representing the maybe reusable query */
  const observersByQuery = createRegistry();

  /* Map of observers by published document */
  const observersCountByDoc = createRegistry();

  const pool = createPool({
    maxConcurrent: maxConcurrent ?? MAX_CONCURRENT,
    maxPending: Infinity,
  });

  /* === INTERNAL FUNCTIONS ===
   * Defined inside publication to close over the registries. */

  async function createOrReuseObserver(
    /* Public arguments passed from publication function */
    args = {},

    /* Internal arguments */
    {
      ancestors = [], // List of ancestor documents
    } = {}
  ) {
    if (publicationStopped) return null;

    const {
      Coll, // Meteor collection instance
      selector, // Object litteral or function that receives ancestors as arguments
      children = [], // [...{ ...args }] List of arguments to children observers. Non object arguments will be omitted, so they can be conditionally defined.
      deps, // Optional. List of parent field dependencies that must change to invalidate observers.
      debug, // Should debugging messages be displayed? true will log all. Otherwise, an object of predefined location can be used with thruthy or falsy value to log or not
      on = selector, // Link to parent document that will get interpreted as a selector
      ...options // Cursor options
    } = normalizeArgs(args);

    if (!selector && !on) {
      throw new Error(`'selector' or 'on' is necessary to create an observer.`);
    }

    const log = createDebugLog(debug);

    /* Keep only children with object arguments. */
    const validChildren = children.filter(isObj);

    /* Create a unique id for the observer */
    const observerId = nanoid();

    /* Create a unique follower key from the observer's id and the doc id */
    const createFollowerKey = (docId) =>
      [observerId, coll, docId].join(KEY_SEPARATOR);

    const protocol = getProtocol();

    /* Retrieve collection name for publishing data over DDP */
    const coll = protocol.getName(Coll);

    /* Flag cancelled state to prevent cancelling more than once */
    let cancelled = false;

    /* Flat list of all subObservers for this observer only (closure) */
    const subObservers = new Set();

    /* Selector might be an object, a function or an array.
     * Interpret it first so that an actual object selector remains. */
    const actSelector = await interpretSelector(on, ancestors);

    /* Simplified key for debugging purposes */
    const debugKey = createDebugKey(Coll, actSelector);

    /* Create a key from the cursor arguments so it can be reused. */
    const queryKey = createQueryKey(Coll, actSelector, options);

    const shouldInvalidatePred = interpretFieldDeps(validChildren);

    /* Search for an already existing observer for the specified selector */
    const existingObserver = observersByQuery.get(queryKey);

    /* If an observer for this query already exists,
     * return it and bypass observer creation.
     * This might be a promise that will resolve to an observer. */
    if (existingObserver) {
      log(DEBUG.REUSED, debugKey);
      return existingObserver;
    }

    /* === OBSERVER WILL GET CREATED === */

    /* Observer's list of `collname|docId` docs added through DDP. */
    const docsList = new Set();

    /* Map of token by followerKey to ensure only latest operation succeeds */
    const tokenByFollower = createTokensRegistry();

    let resolveCreation, rejectCreation;
    const creationPromise = new Promise((resolve, reject) => {
      resolveCreation = resolve;
      rejectCreation = reject;
    });

    /* Save an observer creation promise as a placeholder
     * by its query key for reusability */
    observersByQuery.set(queryKey, creationPromise);

    /* === INTERNAL OBSERVER CREATION FUNCTIONS === */

    async function registerChildObserver(
      childArgs,
      followerKey,
      token,
      ancestors
    ) {
      /* Prevent registering children after observer is cancelled. */
      if (cancelled || publicationStopped) return;

      /* Prevent registering child if its token has been replaced or removed */
      if (!tokenByFollower.check(followerKey, token)) return;

      const subObserver = await createOrReuseObserver(childArgs, { ancestors });

      if (!subObserver) return;

      /* Check again after promise. If created too late, drop it safely. */
      if (
        cancelled ||
        publicationStopped ||
        !tokenByFollower.check(followerKey, token)
      ) {
        subObserver.unfollowMaybeCancel(followerKey);
        return;
      }

      /* Register the subObserver in the observer's followers list
       * and in the `observersByFollowers` registry */
      addFollower(followerKey, subObserver);

      /* Save the subObserver in the current observer's subObservers list */
      subObservers.add(subObserver);
    }

    /* Unfollow a `subObserver` from a specific `followerKey` */
    function unfollowSubObserver(followerKey, subObserver) {
      /* Unfollow the subObserver for this follower link */
      subObserver.unfollowMaybeCancel(followerKey);

      /* Remove from the current observer's `subObservers` list */
      subObservers.delete(subObserver);

      /* Remove from the global followers' observers registry */
      observersByFollowers.pull(followerKey, subObserver);

      /* subObserver can still be active for another observer
       * using the same query key, so keep it in query observers register. */
    }

    /* Return a Map of `queryKey => observer` for a specific `followerKey` */
    async function getObserversByQueryKey(followerKey) {
      const observersSet = observersByFollowers.get(followerKey);
      if (!observersSet) return new Map();

      /* Await the observer's list, since some might still be pointing to a placeholder promise */
      const observers = await Promise.all(observersSet.values());

      return new Map(observers.map((obs) => [obs.queryKey, obs]));
    }

    function isOwnFollowerKey(followerKey) {
      const [keyObserverId] = followerKey.split(KEY_SEPARATOR);
      return keyObserverId === observerId;
    }

    /* DDP add doc, keeping docs registries in sync */
    function addDoc(coll, _id, fields) {
      const completeDocId = [coll, _id].join(COLL_DOC_SEPARATOR);

      /* Add doc to observer's docs list */
      docsList.add(completeDocId);

      /* Increment global registry doc's observers count */
      const prevCount = observersCountByDoc.get(completeDocId) ?? 0;
      observersCountByDoc.set(completeDocId, prevCount + 1);

      /* Publish document over DDP */
      log(DEBUG.DOC_ADDED, coll, _id);
      publication.added?.(coll, _id, fields);
    }

    /* DDP remove doc, keeping docs registries in sync */
    function decrementDocCountAndRemoveIfZero(coll, _id) {
      const completeDocId = [coll, _id].join(COLL_DOC_SEPARATOR);

      /* Remove doc from observer's docs list */
      docsList.delete(completeDocId);

      /* Decrement global registry doc's observers count */
      const prevCount = observersCountByDoc.get(completeDocId) ?? 0;
      const nextCount = Math.max(0, prevCount - 1);

      /* If count drops to 0, actually remove doc.
       * Otherwise, simply save new decremented observers count. */
      if (nextCount <= 0) {
        observersCountByDoc.delete(completeDocId);

        /* Publish removal over DDP */
        log(DEBUG.DOC_REMOVED, coll, _id);
        publication.removed?.(coll, _id);
      } else {
        observersCountByDoc.set(completeDocId, nextCount);
      }
    }

    /* === CREATE OBSERVER === */

    try {
      log(DEBUG.CREATING, debugKey);

      /* No need to create an observer for VOID_SELECTOR. Bypass by returning null. */
      if (actSelector === VOID_SELECTOR) {
        log(DEBUG.BYPASSED, debugKey);
        observersByQuery.delete(queryKey);
        resolveCreation(null);
        return null;
      }

      const observeCallbacks = {
        /* When a document is added to the cursor... */
        async added(_id, fields) {
          /* Prevent any more DDP operations when cancelled */
          if (cancelled) return;

          addDoc(coll, _id, fields);

          /* If no children publications, no further processing required. */
          if (!validChildren?.length) return;

          /* Key representing a specific document for a specific observer.
           * Used to save all observers linked to this document for further retrieval. */
          const followerKey = createFollowerKey(_id);

          /* Generate a token to save in the registry and that
           * must still be the same when registering child observer. */
          const token = tokenByFollower.register(followerKey);

          /* Add the added document to the ancestors list */
          const doc = { ...fields, _id };
          const newAncestors = [doc, ...ancestors];

          /* For each added document, create a new subObserver
           * for each child publication. */
          validChildren.forEach((childArgs) =>
            pool.add(
              registerChildObserver,
              childArgs,
              followerKey,
              token,
              newAncestors
            )
          );
        },

        /* When a document from the cursor changes... */
        async changed(_id, fields) {
          /* Prevent any more DDP operations when cancelled */
          if (cancelled) return;

          log(DEBUG.DOC_CHANGED, coll, _id, fields);
          publication.changed?.(coll, _id, fields);

          /* If no child publication, no further processing required. */
          if (!validChildren?.length) return;

          /* Fetch the updated doc with the fields defined in the cusor options
           * in order to recompute the children selectors and invalidate those
           * that have changed. */
          const updatedDoc = await fetchOne(
            Coll,
            { _id },
            { fields: options.fields, transform: null }
          );

          const newAncestors = [updatedDoc, ...ancestors];

          /* If deps are defined, invalidate observers only when
           * one of the deps is targeted by the changed fields or ancestors. */
          const invalidated = await shouldInvalidatePred(
            fields,
            ...newAncestors
          );
          if (!invalidated) return;
          log(DEBUG.INVALIDATED, debugKey);

          /* Recreate the follower key that was used when doc was added. */
          const followerKey = createFollowerKey(_id);

          const currObserversByQueryKey =
            await getObserversByQueryKey(followerKey);

          /* Recompute the children query keys from new version of doc */
          const newArgsByQueryKey = await deriveArgsByQueryKey(
            newAncestors,
            validChildren
          );

          const missingEntries = [...newArgsByQueryKey.entries()].reduce(
            (acc, [queryKey, args]) => {
              if (currObserversByQueryKey.has(queryKey)) return acc;
              return [...acc, args];
            },
            []
          );

          if (missingEntries.length) {
            const token = tokenByFollower.register(followerKey);

            /* Create child observers that are missing from current ones */
            missingEntries.forEach((args) => {
              pool.add(
                registerChildObserver,
                args,
                followerKey,
                token,
                newAncestors
              );
            });
          }

          /* Unfollow current child observers no longer needed */
          currObserversByQueryKey.forEach((obs, queryKey) => {
            if (newArgsByQueryKey.has(queryKey)) return;
            pool.add(unfollowSubObserver, followerKey, obs);
          });
        },

        /* When a document is removed from the cursor... */
        removed(_id) {
          /* Prevent any more DDP operations when cancelled */
          if (cancelled) return;

          decrementDocCountAndRemoveIfZero(coll, _id);

          /* Unregister the document follower link from the observers... */

          /* Recreate the follower key that was used when doc was added. */
          const followerKey = createFollowerKey(_id);

          /* Invalidate previous token for this follower
           * to ensure no previous child observer creation is allowed */
          tokenByFollower.remove(followerKey);

          /* Retrieve follower observers from the registry */
          const followerObservers =
            observersByFollowers.get(followerKey) || new Set();

          /* Unfollow each observer linked to this doc follower key. */
          followerObservers.forEach((subObserver) =>
            pool.add(unfollowSubObserver, followerKey, subObserver)
          );
        },
      };

      const observer = await protocol.observe(
        Coll,
        actSelector,
        observeCallbacks,
        options
      );

      log(DEBUG.CREATED, debugKey);

      /* If publication is already stopped, immediately stop and drop observer. */
      if (publicationStopped) {
        observer.stop();
        observersByQuery.delete(queryKey);
        resolveCreation(null);
        return null;
      }

      /* === ENHANCE OBSERVER === */

      /* Associate additional properties on observer */
      observer.id = observerId;
      observer.queryKey = queryKey;
      observer.docsList = docsList;

      /* Add a `cancel` method that stops the observer and cancels its descendants. */
      observer.cancel = function () {
        /* Do not process again when already cancelled */
        if (cancelled) return;

        /* Stop current observer */
        observer.stop();

        /* Unfollow or cancel all subObservers, then clear the list */
        subObservers.forEach((subObserver) =>
          subObserver.unfollowMaybeCancel()
        );
        subObservers.clear();

        /* Retrieve all doc observers linked to the current `observerId`
         * in the `observersByFollowers` registry
         * and unfollow them. */
        [...observersByFollowers.entries()].forEach(
          ([followerKey, subObservers = new Set()]) => {
            if (!isOwnFollowerKey(followerKey)) return;

            subObservers.forEach((subObserver) =>
              subObserver.unfollowMaybeCancel(followerKey)
            );

            /* Remove stale registry entry now that this follower key was fully removed. */
            observersByFollowers.delete(followerKey);
          }
        );

        /* Maybe apply DDP removal for each of the observer's docs */
        Array.from(docsList).forEach((completeDocId) => {
          const [coll, _id] = completeDocId.split(COLL_DOC_SEPARATOR);
          decrementDocCountAndRemoveIfZero(coll, _id);
        });

        /* Drop doc bookkeeping now that this observer is cancelled. */
        docsList.clear();

        /* Cancellation should have been triggered by a publication stop
         * or followers count dropping below one.
         * Since only one observer can be registered for a query key,
         * remove it from the registry when cancelled. */
        observersByQuery.delete(queryKey);

        /* Flag observer as cancelled */
        cancelled = true;

        log(DEBUG.CANCELLED, debugKey);
      };

      /* Add an `unfollow` method that allows a follower link
       * to stop its tracking. If followers count
       * drops below 1, also cancel the observer. */
      observer.unfollowMaybeCancel = function (followerKey) {
        if (observer.followers) {
          observer.followers.delete(followerKey);
          log(DEBUG.UNFOLLOWED, "from", debugKey, "by", followerKey);
        }

        /* Keep global registry tidy when unfollowing directly. */
        observersByFollowers.pull(followerKey, observer);

        if (!observer.followers || observer.followers.size < 1) {
          observer.cancel();
        }
      };

      /* Replace the placeholder with the actual observer
       * by its query key for reusability */
      observersByQuery.set(queryKey, observer);

      resolveCreation(observer);
      return observer;
    } catch (error) {
      /* Ensure no dangling placeholder */
      observersByQuery.delete(queryKey);
      rejectCreation(error);
      throw error;
    }
  }

  /* Add a follower key to an observer's list of followers
   * and push follower link in the `observersByFollowers` global registry. */
  function addFollower(followerKey, observer) {
    const followers = observer.followers;

    /* Add follower to the followers list or create the missing list */
    if (followers) {
      followers.add(followerKey);
    } else {
      observer.followers = new Set([followerKey]);
    }

    /* Save the observer in its follower list of observers */
    observersByFollowers.push(followerKey, observer);
  }

  /* === AFTER INTERNAL FUNCTIONS === */

  /* Create the main publication observer */
  const observer = await createOrReuseObserver(rest);

  if (!observer) throw new Error("`publish` failed to create root observer");

  /* Publication stop and cleanup function */
  function stopPublication() {
    publicationStopped = true;

    /* Immediately stop main observer. */
    observer.cancel();

    /* Stop all registered observers. */
    observersByQuery.forEach((observer) => observer?.cancel?.());

    /* Clear the registry maps.
     * Probably redundant since registries are inside the publication closure. */
    observersByQuery.clear();
    observersByFollowers.clear();

    log(DEBUG.STOPPED);
  }

  const handle = {
    stop: stopPublication,
  };

  /* Call the stop function when publication is stopped */
  publication.onStop?.(handle.stop);

  /* Mark publication as ready after everything has been set up. */
  publication.ready();

  log(DEBUG.READY);

  /* Return an object with a `stop` method
   * to mimick a regular observer returned value. */
  return handle;
}

/* === HELPERS === */

/* Create an enhanced Map that can manipulate nested Set values. */
function createRegistry() {
  const registry = new Map();

  /* Find a value in a nested Set */
  registry.find = function (
    key, // Key in the Map
    pred // (value) Predicate function to apply to Set values
  ) {
    const set = registry.get(key);
    if (!set) return undefined;

    return [...set.values()].find(pred);
  };

  /* Push a value to a nested Set */
  registry.push = function (key, val) {
    const set = registry.get(key);

    if (set) {
      set.add(val);
    } else {
      registry.set(key, new Set([val]));
    }

    return registry;
  };

  /* Pull a value from a nested Set */
  registry.pull = function (key, val) {
    /* If registry doesn't have the key, do nothing */
    if (!registry.has(key)) return registry;

    const set = registry.get(key);

    if (set) {
      /* If set is found, just remove value from it */
      set.delete(val);

      /* If item removal from set leads to an empty set,
       * remove the key from the registry to prevent memory leaks. */
      if (!set.size) registry.delete(key);
    }

    return registry;
  };

  return registry;
}

/* Stringify arguments to collection cursor to create a key for debug messages */
function createDebugKey(Coll, selector = {}) {
  const protocol = getProtocol();
  return [protocol.getName(Coll), protocol.stringify(selector)].join(
    KEY_SEPARATOR
  );
}

/* Stringify arguments to collection cursor to create a unique identifier */
function createQueryKey(Coll, selector = {}, options = {}) {
  const protocol = getProtocol();
  const { fields, limit, skip, sort } = options;

  return (
    createDebugKey(Coll, selector) +
    [fields, sort, limit, skip]
      .filter((x) => x !== undefined)
      .map((x) => {
        if (isObj(x)) return protocol.stringify(x);
        return x.toString();
      })
      .join(KEY_SEPARATOR)
  );
}

/* Build query-key index for child args after resolving selectors from ancestors. */
async function deriveArgsByQueryKey(ancestors, children) {
  if (!children?.length) return new Map();

  const entries = await Promise.all(
    children.map(async (childArgs) => {
      const { Coll, selector, children, on = selector, ...options } = childArgs;

      const actSelector = await interpretSelector(on, ancestors);

      /* Create a key from the cursor arguments so it can be reused. */
      const queryKey = createQueryKey(Coll, actSelector, options);

      return [queryKey, childArgs];
    })
  );

  return new Map(entries);
}

/* Selector that always matches no document (_id is always required). */
const VOID_SELECTOR = { _id: { $exists: false } };

/* Take all children publications arguments and derive
 * a single function of `(fields, ...ancestors) => bool`
 * for which a thruthy result will trigger observers invalidation.
 * If any child publication doesn't specify any deps (implicity or explicit),
 * force observers invalidation on each parent document change. */
function interpretFieldDeps(children) {
  if (!children?.length) return () => false;

  /* Reduce into a Set of true, false, String, function */
  const depsAsSet = children.reduce((acc, childArgs) => {
    /* Negating the accumulator short-circuits the reduce */
    if (!acc) return undefined;

    /* Returns a boolean, an array, a function or undefined */
    const deps = deriveArgsDeps(childArgs);

    /* If any child is true or undefined, return `true`
     * to short-circuit reducing process
     * and force observers invalidation. */
    if (deps === true || deps === undefined) return true;

    /* Array deps is an array, add each one to the accumulator Set */
    if (isArr(deps)) {
      deps.forEach((dep) => acc.add(dep));
    } else {
      /* Any other case of `deps` is directly added to the accumulator */
      acc.add(deps);
    }

    return acc;
  }, new Set());

  /* If combined deps returns true, return an always true function */
  if (depsAsSet === true) return () => true;

  /* Transform each dep element into an individual invalidation function. */
  const depsFns = [...depsAsSet].map((dep) => {
    return async function (fields, ...ancestors) {
      if (typeof dep === "boolean") return dep;

      /* A function dep should return the same type of list as `deps` argument,
       * ie a list of keys to watch in the changed `fields`.
       * If it returns a falsy value, it will be treated as undefined deps
       * and trigger observers invalidation each time. */
      if (isFunc(dep)) {
        const res = await dep(fields, ...ancestors);
        if (isArr(res)) return res.some((key) => Object.hasOwn(fields, key));

        return !res;
      }

      /* A key dep will simply check if it is included in the changed `fields` */
      if (typeof dep === "string") return Object.hasOwn(fields, dep);

      /* Any other type is invalid and will trigger invalidation */
      return true;
    };
  });

  /* Combine all individual invalidation functions into a single one
   * so it is easier to use directly on fields change. */
  return async (...args) => {
    /* Use a `for..of` loop to short-circuit further evaluation
     * as soon as an invalidation function returns true. */
    for (const depsFn of depsFns) {
      const shouldInvalidate = await depsFn(...args);
      if (shouldInvalidate) return true;
    }

    return false;
  };
}

/* Derive a list of props or a function
 * that will eventually derive such a list
 * from the arguments to `createOrReuseObserver`.
 * Any `undefined` deps will force observers invalidation. */
function deriveArgsDeps({ deps, selector, on = selector }) {
  const normalizedDeps = normalizeDeps(deps);

  /* true or false normalized deps should have precedance */
  if (typeof normalizedDeps === "boolean") return normalizedDeps;

  /* If selector is static and deps are undefined,
   * return an empty list, because nothing should make it rerun. */
  if (isObj(on) && normalizedDeps === undefined) return [];

  /* Only array selector will generate additional implicit deps */
  if (!isArr(on)) return normalizedDeps;

  /* If selector is an array, derive implicit deps from it. */
  const [from] = on;

  /* `from` can be either a prop or a nested array prop */
  const implicitDep = isArr(from) ? from[0] : from;

  if (isArr(normalizedDeps)) return [implicitDep, ...normalizedDeps];
  if (isFunc(normalizedDeps)) return [implicitDep, normalizedDeps];
  return [implicitDep];
}

/* Normalize deps to return either
 * - true = always invalidate
 * - false = never invalidate
 * - [] = List of keys the changed `fields` must include to invalidate
 * - Object = list of top-level truthy keys
 * - Function (fields, ...ancestors) => normalized deps
 *
 * Note: key matching is flat and exact against changed fields keys. */
function normalizeDeps(deps) {
  /* `undefined` deps is a special case where user didn't specify anything. */
  if (deps === undefined) return undefined;

  /* Returns a boolean */
  if (typeof deps === "boolean") return deps;

  /* Returns a function */
  if (isFunc(deps)) {
    return async (...args) => {
      const res = await deps(...args);
      return normalizeDeps(res);
    };
  }

  /* Returns an array */
  if (isArr(deps)) return deps;

  /* Keep only truthy value keys of an object */
  if (isObj(deps)) {
    return Object.entries(deps)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }

  if (deps instanceof Set) return [...deps];

  if (typeof deps === "string") return [deps];

  /* Any other scenario is considered as no invalidation. */
  return false;
}

/* Resolve supported selector inputs (object, function, join-array) into an object selector. */
async function interpretSelector(selector, ancestors = []) {
  if (!selector) return VOID_SELECTOR;

  /* Function selector `(parent, ...ancestors) => selector` */
  if (isFunc(selector)) {
    const computedSelector = await selector(...ancestors);
    if (computedSelector) return computedSelector;

    // eslint-disable-next-line no-console
    console.warn(
      "[`publish`]: `selector` function should produce a valid selector object"
    );

    return VOID_SELECTOR;
  }

  /* `selector` can be an array where:
   * - first element is the join prop from the parent document
   * - second element is the join prop to the child documents
   * - third element is an additional selector to consider */
  if (isArr(selector)) {
    const [parent] = ancestors || [];

    /* Array selector needs a parent. */
    if (!parent) {
      // eslint-disable-next-line no-console
      console.warn(
        "[`publish`]: A parent is necessary to use a join selector."
      );
      return VOID_SELECTOR;
    }

    const [from, to, toSelector] = selector;

    /* If first element is an array as in `[["propToChildrenVals"], "childProp"]`,
     * `childrenPropVals` on parent document contains a list
     * of values associated with the joined `childProp`. */
    const fromArray = isArr(from);

    /* If second element is an array as in `["parentProp", ["propToParentVals"]]`,
     * `propToParentVals` on children documents contain lists of values
     * associated with the joined `parentProp`. */
    const toArray = isArr(to);

    let joinSelector;

    /* ["propToChildVal", "childProp"] */
    if (!fromArray && !toArray) {
      const parentValue = parent[from];
      if (parentValue === undefined) return VOID_SELECTOR;
      joinSelector = { [to]: parentValue };
    }

    /* [["propToChildrenVals"], "childProp"] */
    if (fromArray && !toArray) {
      const parentValues = parent[from[0]];
      if (parentValues === undefined) return VOID_SELECTOR;
      joinSelector = { [to]: { $in: parentValues || [] } };
    }

    /* ["parentProp", ["propToParentVals"]] */
    if (!fromArray && toArray) {
      const parentValue = parent[from];
      if (parentValue === undefined) return VOID_SELECTOR;
      joinSelector = { [to[0]]: { $elemMatch: { $eq: parentValue } } };
    }

    /* [["propToChildrenVals"], ["propToParentVals"]] */
    if (fromArray && toArray) {
      const parentValues = parent[from[0]];
      if (parentValues === undefined) return VOID_SELECTOR;
      joinSelector = { [to[0]]: { $elemMatch: { $in: parentValues || [] } } };
    }

    /* Unlikely because all four cases have been considered... */
    if (!joinSelector) return VOID_SELECTOR;

    return !toSelector ? joinSelector : { ...toSelector, ...joinSelector };
  }

  /* Static plain object selector */
  if (typeof selector === "object") return selector;

  /* Default to null selector */
  return VOID_SELECTOR;
}

function createDebugLog(debug) {
  return function log(location, ...content) {
    if (debug && (debug === true || debug?.[location])) {
      // eslint-disable-next-line no-console
      console.log(location, ...content);
    }
  };
}

function createTokensRegistry() {
  const registry = new Map();

  return {
    check(followerKey, token) {
      return registry.get(followerKey) === token;
    },

    register(followerKey) {
      const token = nanoid();
      registry.set(followerKey, token);
      return token;
    },

    remove(followerKey) {
      registry.delete(followerKey);
    },
  };
}

/* Normalize publication args so children can be expressed either as:
 * - fully explicit child args (`{ Coll, on, ... }`)
 * - join shorthand (`{ join: "joinKey", ... }`)
 *
 * It also derives additional implicit children from requested join fields.
 * Child arguments are normalized when each child observer is created.
 *
 * Rules:
 * - every child must be an object
 * - a join key cannot be declared both explicitly in `children`
 *   and implicitly in parent `fields` join section
 * - parent own fields are separated from join fields and only own fields
 *   remain on the normalized parent args
 */
function normalizeArgs({
  Coll,
  children = [],
  deps,
  debug,
  fields,
  selector,
  on = selector,
  ...rest
}) {
  const joins = getJoins(Coll);

  /* Partition field spec into own (base collection) and join fields ('+') */
  const { _: ownFields, "+": joinFields = {} } = dispatchFields(fields, joins);

  const joinKeys = Object.keys(joinFields);

  const normalizedChildren = children.map((childArgs) => {
    if (!isObj(childArgs)) {
      const protocol = getProtocol();
      throw new Error(
        `Each child of '${protocol.getName(Coll)}' collection must be an object.`
      );
    }

    if (!childArgs.join) return childArgs;
    const { join: explicitJoinKey, ...rest } = childArgs;

    if (joinKeys.includes(explicitJoinKey)) {
      throw new Error(
        `Join '${explicitJoinKey}' is defined both in parent fields and as an explicit child. Choose one or the other.`
      );
    }

    return joinToArgs(Coll, explicitJoinKey, rest);
  });

  const additionalJoinChildren = joinKeys.map((joinKey) =>
    joinToArgs(Coll, joinKey, { debug, fields: joinFields[joinKey] })
  );

  return {
    Coll,
    selector,
    fields: ownFields,
    children: [...normalizedChildren, ...additionalJoinChildren],
    deps,
    debug,
    on,
    ...rest,
  };
}

/* Expand a join key declared on a parent collection into full child args.
 *
 * Returned child args inherit selector/deps/limit from the join definition,
 * and can be overridden with `rest` (for example `fields`, `children`, `sort`...).
 * It intentionally does not recursively normalize descendants here.
 * Descendant args are normalized later when their own observer is created.
 */
function joinToArgs(Coll, joinKey, rest) {
  const join = getJoins(Coll)?.[joinKey];

  if (!join) {
    const protocol = getProtocol();

    throw new Error(
      `Join '${joinKey}' is not defined on collection '${protocol.getName(Coll)}'.`
    );
  }

  const { Coll: ChildColl, on, fields, deps = fields, limit, single } = join;

  return {
    Coll: ChildColl,
    on,
    deps,
    limit: single ? 1 : limit,
    ...rest,
  };
}
