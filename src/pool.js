import { isFunc } from "./util";

const DROP = "drop";
const SHIFT = "shift";

const MAX_CONCURRENT = 10;
const MAX_PENDING = 250;

let poolLocked = false;

let pool = createDefaultPool();

function createDefaultPool() {
  return createPool({
    maxConcurrent: MAX_CONCURRENT,
    maxPending: MAX_PENDING,
  });
}

export function configurePool(args = {}) {
  if (poolLocked) {
    throw new Error(
      "'configurePool' must be called at startup before processing hooks"
    );
  }

  pool = createPool(args);
}

/* Wrapper function to set `bufferLocked` to true */
export function _getLockedPool() {
  poolLocked = true;
  return pool;
}

function createPool({
  maxConcurrent = MAX_CONCURRENT, // Maximum number of concurrent calls
  maxPending = MAX_PENDING, // Maximum number of pending calls
  onError, // (error, call) What to do when a call fails. Defaults to console.error.
  onOverflow = defaultOnOverflow, // drop|shift|(pendings, call) => reorderedPendings. What to do when overflow happens.
}) {
  validatePoolArgs({ maxConcurrent, maxPending, onError, onOverflow });

  /* List of calls waiting to be executed */
  let pendings = [];

  /* List of concurrent calls being executed */
  let concurrents = new Set();

  /* Dispatch the call to either be processed, enqueued
   * or to trigger an overflow. */
  function addCall(call) {
    /* Process immediately if concurrent space allows */
    if (concurrents.size < maxConcurrent) {
      processCall(call);
      return;
    }

    /* Otherwise, add it to the pendings list if space allows */
    if (pendings.length < maxPending) {
      pendings.push(call);
      return;
    }

    /* Otherwise, handle overflow */
    handleOverflow(call);
  }

  /* Add a call to the concurrents list and execute it. */
  async function processCall(call) {
    /* Additional safety, but shouldn't happen
     * since `addCall` makes the dispatching */
    if (concurrents.size >= maxConcurrent) {
      throw new Error("Max concurrent calls reached");
    }

    try {
      /* Add the call to the list */
      concurrents.add(call);

      /* Retrieve function and args */
      const { fn, args = [] } = call;

      /* Call the function with the arguments */
      await fn(...args);
    } catch (error) {
      /* If an error is thrown, handle it with provided handler */
      handleError(error, call);
    } finally {
      /* After completion, remove call from concurrents */
      concurrents.delete(call);

      /* Space has been made, so trigger a new call to be processed */
      processNextCall();
    }
  }

  /* If concurrent space allows, process the first pending call */
  function processNextCall() {
    /* Ensure concurrents space is sufficient */
    if (concurrents.size >= maxConcurrent) return;

    /* Take next pending call and process it */
    const nextCall = pendings.shift();
    if (nextCall) processCall(nextCall);
  }

  /* eslint-disable no-console */
  function handleError(error, call) {
    const handler = isFunc(onError) ? onError : console.error;

    Promise.resolve()
      .then(() => handler(error, call))
      /* Last resort error handler if `onError` itself throws */
      .catch((err) => console.error(err));
  }
  /* eslint-enable no-console */

  function handleOverflow(call) {
    /* When dropping, do nothing */
    if (onOverflow === DROP) return;

    if (onOverflow === SHIFT) {
      /* Make space by removing first call */
      pendings.shift();
      if (pendings.length < maxPending) {
        addCall(call);
      }
      return;
    }

    if (isFunc(onOverflow)) {
      handleManualOverflow(call);
      return;
    }

    // eslint-disable-next-line no-console
    console.error("Invalid 'onOverflow'");
  }

  /* If an overflow function is used,
   * it should return a new `pendings` list
   * that will replace the current one.
   * The function receives the current `pendings` list
   * and the call to be added. */
  function handleManualOverflow(call) {
    /* Clone current pendings to prevent mutation and allow comparison */
    const potentialPendings = [...pendings, call];

    /* User defined `onOverflow` should return a new pendings array */
    const reorderedPendings = onOverflow([...pendings], call);

    /* If `onOverflow` returns undefined, consider the pendings unchanged. */
    if (reorderedPendings === undefined) return;

    /* Ensure returned pendings is an array */
    if (!Array.isArray(reorderedPendings)) {
      throw new TypeError("'onOverflow' must return an array");
    }

    /* Comparison is made on the _id Symbol prop */
    const newPendings = reorderedPendings.reduce((acc, { _id }) => {
      const prevPending = potentialPendings.find((p) => p._id === _id);

      /* Prevent unknown entries */
      if (!prevPending) return acc;

      /* Prevent duplicate entries */
      if (acc.includes(prevPending)) return acc;

      return [...acc, prevPending];
    }, []);

    pendings = newPendings;
  }

  return {
    /* Add a function and its arguments as a call to be made */
    add(fn, ...args) {
      /* Construct a call object with unique _id */
      const call = {
        _id: Symbol(),
        fn,
        args: Array.from(args),
      };

      addCall(call);
    },

    /* Clear the pendings list. Active calls are not stopped. */
    clear() {
      pendings = [];
    },
  };
}

function defaultOnOverflow() {
  // eslint-disable-next-line no-console
  console.warn("'maxPending' limit reached. Call is dropped");
  /* Return undefined to keep pendings intact */
  return undefined;
}

/* Type check pool arguments. */
function validatePoolArgs(args = {}) {
  const { maxConcurrent, maxPending, onOverflow } = args;

  /* maxConcurrent */
  if (
    !(
      Number.isFinite(maxConcurrent) &&
      Number.isInteger(maxConcurrent) &&
      maxConcurrent >= 1
    )
  ) {
    throw new TypeError("'maxConcurrent' must be a finite positive integer.");
  }

  /* maxPending */
  if (
    !(
      maxPending === Infinity ||
      (Number.isInteger(maxPending) && maxPending >= 0)
    )
  ) {
    throw new TypeError(
      "'maxPending' must be a positive integer or `Infinity`"
    );
  }

  if (!(isFunc(onOverflow) || [DROP, SHIFT].includes(onOverflow))) {
    throw new TypeError(
      `'onOverflow' must be either a function or one of '${DROP}' or '${SHIFT}'`
    );
  }
}
