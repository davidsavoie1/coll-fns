import { nanoid } from "nanoid/non-secure";
import { getProtocol } from "./protocol";
import { fetchOne } from "./fetch";
import { createTokensRegistry, isFunc, isObj } from "./util";
import { createPool } from "./pool";
import {
  createDebugKey,
  createDebugLog,
  createQueryKey,
  createRegistry,
  deriveArgsByQueryKey,
  interpretFieldDeps,
  interpretSelector,
  KEY_SEPARATOR,
  normalizeArgs,
  VOID_SELECTOR,
} from "./publishHelpers";

const MAX_CONCURRENT = 10; // Maximum number of concurrent observer creation processed

const COLL_DOC_SEPARATOR = "|";

const DEBUG = {
  BYPASSED: "BYPASSED",
  CANCELLED: "CANCELLED",
  CREATED: "CREATED",
  // CREATING: "CREATING",
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
 * @property {boolean} [awaited=true] If true, this child subtree contributes to publication readiness.
 * If false, this subtree initializes/reacts in background and does not block `ready()`.
 * @property {(PublishChildArgs|false|null|undefined)[]} [children]
 * @property {boolean|string[]|Object} [debug]
 */

/**
 * Root publish args.
 * @typedef {Object} PublishArgs
 * @property {*} Coll
 * @property {PublishSelector} selector Root selector passed as `publish(..., selector, ...)`.
 * @property {Object} [fields]
 * @property {(PublishChildArgs|false|null|undefined)[]} [children]
 * @property {PublishDeps} [deps]
 * @property {boolean|string[]|Object} [debug]
 */

/**
 * Extra publish runtime options.
 * @typedef {Object} PublishOptions
 * @property {number} [maxConcurrent=10] Maximum concurrent child observer creations.
 * Readiness is controlled per child via `awaited` (default true on each node).
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

  /* Map of latest reconciled query keys a follower desires */
  const desiredQueryKeysByFollower = new Map();

  function isObserverDesired(followerKey, observer) {
    const desiredQueryKeys = desiredQueryKeysByFollower.get(followerKey);
    return desiredQueryKeys?.has(observer.queryKey);
  }

  let observer = null;
  let initializationError = undefined;

  /* Initialization only pool */
  const initPool = createPool({
    maxConcurrent: maxConcurrent ?? MAX_CONCURRENT,
    maxPending: Infinity,
    onError: (err) => {
      /* Save only first initialization error */
      if (!initializationError) {
        initializationError = err;
      }
      stopPublication();
    },
  });

  /* Active publication pool */
  const activePool = createPool({
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
      initializing = false,
    } = {}
  ) {
    if (publicationStopped) return null;

    const {
      Coll, // Meteor collection instance
      selector, // Object litteral or function that receives ancestors as arguments
      children = [], // [...{ ...args }] List of arguments to children observers. Non object arguments will be omitted, so they can be conditionally defined.
      deps, // Optional. List of parent field dependencies that must change to invalidate observers.
      debug, // Should debugging messages be displayed? true logs all; array of locations logs selected events; object maps locations to truthy/falsy values
      on = selector, // Link to parent document that will get interpreted as a selector
      awaited = true, // Should the observer initialization be awaited before readiness?
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

    /* Map of sequential numbers by followerKey that will be issued
     * at the start of `changed` callback with children. */
    const changedSeqByFollower = createTokensRegistry((prev = 0) => prev + 1);

    let resolveCreation, rejectCreation;
    const creationPromise = new Promise((resolve, reject) => {
      resolveCreation = resolve;
      rejectCreation = reject;
    });

    /* Save an observer creation promise as a placeholder
     * by its query key for reusability */
    observersByQuery.set(queryKey, creationPromise);

    /* === INTERNAL OBSERVER CREATION FUNCTIONS === */

    async function registerChildObserver({
      childArgs,
      followerKey,
      initializing,
      token,
      ancestors,
    }) {
      /* Prevent registering children after observer is cancelled. */
      if (cancelled || publicationStopped) return;

      /* Prevent registering child if its token has been replaced or removed */
      if (!tokenByFollower.check(followerKey, token)) return;

      const subObserver = await createOrReuseObserver(
        { awaited, ...childArgs },
        {
          ancestors,
          initializing,
        }
      );

      if (!subObserver) return;

      /* Check again after promise. If created too late, drop it safely,
       * but only if no follower is still interested. */
      if (cancelled || publicationStopped) {
        subObserver.unfollowMaybeCancel(followerKey);
        return;
      }

      if (!tokenByFollower.check(followerKey, token)) {
        if (!isObserverDesired(followerKey, subObserver)) {
          subObserver.unfollowMaybeCancel(followerKey);
        }
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

    function unfollowSubObserverIfCurrent(
      followerKey,
      subObserver,
      unfollowToken
    ) {
      if (!tokenByFollower.check(followerKey, unfollowToken)) return;

      if (isObserverDesired(followerKey, subObserver)) return;

      unfollowSubObserver(followerKey, subObserver);
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
      // log(DEBUG.CREATING, debugKey);

      /* No need to create an observer for VOID_SELECTOR. Bypass by returning null. */
      if (actSelector === VOID_SELECTOR) {
        log(DEBUG.BYPASSED, debugKey);
        observersByQuery.delete(queryKey);
        resolveCreation(null);
        return null;
      }

      let _initializing = initializing;

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
          validChildren.forEach((childArgs) => {
            const childAwaited = childArgs.awaited ?? awaited;
            /* Awaited children are scheduled on initialization pool while this observer
             * is still in its bootstrap phase. Non-awaited children (or live phase work)
             * are scheduled on active pool and do not block publication readiness. */
            const pool = _initializing && childAwaited ? initPool : activePool;

            pool.add(registerChildObserver, {
              childArgs,
              followerKey,
              initializing: _initializing,
              token,
              ancestors: newAncestors,
            });
          });
        },

        /* When a document from the cursor changes... */
        async changed(_id, fields) {
          /* Prevent any more DDP operations when cancelled */
          if (cancelled) return;

          log(DEBUG.DOC_CHANGED, coll, _id, fields);
          publication.changed?.(coll, _id, fields);

          /* If no child publication, no further processing required. */
          if (!validChildren?.length) return;

          /* Recreate the follower key that was used when doc was added. */
          const followerKey = createFollowerKey(_id);

          /* Attribute a new sequential token to the change
           * so we can keep track of `changed` order */
          const changedSeq = changedSeqByFollower.generate(followerKey);

          /* Fetch the updated doc with the fields defined in the cusor options
           * in order to recompute the children selectors and invalidate those
           * that have changed. */
          const updatedDoc = await fetchOne(
            Coll,
            { _id },
            { fields: options.fields, transform: null }
          );

          /* No current parent state exists; supersede in-flight changed reconciliations. */
          if (!updatedDoc) {
            changedSeqByFollower.register(followerKey);
            return;
          }

          const newAncestors = [updatedDoc, ...ancestors];

          /* If deps are defined, invalidate observers only when
           * one of the deps is targeted by the changed fields or ancestors. */
          const invalidated = await shouldInvalidatePred(
            fields,
            ...newAncestors
          );

          if (!invalidated) return;

          /* If invalidated, register the token as current and proceed
           * unless a more recent change (higher sequence) was already registered. */
          if (changedSeqByFollower.get(followerKey) > changedSeq) return;

          changedSeqByFollower.register(followerKey, changedSeq);

          log(DEBUG.INVALIDATED, debugKey);

          const currObserversByQueryKey =
            await getObserversByQueryKey(followerKey);

          /* Recompute the children query keys from new version of doc */
          const newArgsByQueryKey = await deriveArgsByQueryKey(
            newAncestors,
            validChildren
          );

          /* After async work, token must still be the last one registered
           * for the entries to be adjusted */
          if (!changedSeqByFollower.check(followerKey, changedSeq)) return;

          /* Register the query keys the follower is still interested in */
          desiredQueryKeysByFollower.set(
            followerKey,
            new Set(newArgsByQueryKey.keys())
          );

          const token = tokenByFollower.register(followerKey);

          const missingEntries = Array.from(newArgsByQueryKey.entries()).reduce(
            (acc, [queryKey, args]) => {
              if (currObserversByQueryKey.has(queryKey)) return acc;
              return [...acc, args];
            },
            []
          );

          if (missingEntries.length) {
            /* Create child observers that are missing from current ones */
            missingEntries.forEach((args) => {
              /* Document changes are always added on active pool */
              activePool.add(registerChildObserver, {
                childArgs: args,
                followerKey,
                initializing: false,
                token,
                ancestors: newAncestors,
              });
            });
          }

          /* Unfollow current child observers no longer needed */
          currObserversByQueryKey.forEach((obs, queryKey) => {
            if (newArgsByQueryKey.has(queryKey)) return;
            activePool.add(
              unfollowSubObserverIfCurrent,
              followerKey,
              obs,
              token
            );
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

          /* Remove follower from desired query keys Map */
          desiredQueryKeysByFollower.delete(followerKey);

          /* Increment changed sequence to invalidate in-flight changes. */
          changedSeqByFollower.register(followerKey);

          /* Invalidate previous token for this follower
           * to ensure no previous child observer creation is allowed */
          tokenByFollower.reset(followerKey);

          /* Retrieve follower observers from the registry */
          const followerObservers =
            observersByFollowers.get(followerKey) || new Set();

          /* Unfollow each observer linked to this doc follower key. */
          followerObservers.forEach((subObserver) => {
            /* Document removals are always added on active pool */
            activePool.add(unfollowSubObserver, followerKey, subObserver);
          });
        },
      };

      const observer = await protocol.observe(
        Coll,
        actSelector,
        observeCallbacks,
        options
      );

      _initializing = false;

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
        Array.from(observersByFollowers.entries()).forEach(
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
  observer = await createOrReuseObserver(rest, { initializing: true });

  if (!observer) throw new Error("`publish` failed to create root observer");

  /* Publication stop and cleanup function */
  function stopPublication() {
    publicationStopped = true;

    /* Immediately stop main observer. */
    observer?.cancel?.();

    /* Stop all registered observers. */
    observersByQuery.forEach((observer) => observer?.cancel?.());

    /* Clear the registry maps.
     * Probably redundant since registries are inside the publication closure. */
    observersByQuery.clear();
    observersByFollowers.clear();
    desiredQueryKeysByFollower.clear();

    log(DEBUG.STOPPED);
  }

  const handle = {
    stop: stopPublication,
  };

  /* Call the stop function when publication is stopped */
  publication.onStop?.(handle.stop);

  /* Mark publication as ready after everything has been set up. */
  await initPool.waitForIdle();

  if (initializationError) throw initializationError;

  publication.ready();

  log(DEBUG.READY);

  /* Return an object with a `stop` method
   * to mimick a regular observer returned value. */
  return handle;
}
