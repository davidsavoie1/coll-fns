import { dispatchFields } from "./fields";
import { getJoins } from "./join";
import { getProtocol } from "./protocol";
import { hasOwn, isArr, isFunc, isObj } from "./util";

export const KEY_SEPARATOR = "|";

/* Selector that always matches no document (_id is always required). */
export const VOID_SELECTOR = { _id: { $exists: false } };

/* Create an enhanced Map that can manipulate nested Set values. */
export function createRegistry() {
  const registry = new Map();

  /* Find a value in a nested Set */
  registry.find = function (
    key, // Key in the Map
    pred // (value) Predicate function to apply to Set values
  ) {
    const set = registry.get(key);
    if (!set) return undefined;

    return Array.from(set.values()).find(pred);
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
export function createDebugKey(Coll, selector = {}) {
  const protocol = getProtocol();
  return [protocol.getName(Coll), protocol.stringify(selector)].join(
    KEY_SEPARATOR
  );
}

/* Stringify arguments to collection cursor to create a unique identifier */
export function createQueryKey(Coll, selector = {}, options = {}) {
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
export async function deriveArgsByQueryKey(ancestors, children) {
  if (!children?.length) return new Map();

  const entries = await Promise.all(
    children.map(async (childArgs) => {
      const {
        Coll,
        selector,
        children,
        on = selector,
        ...options
      } = normalizeArgs(childArgs);

      const actSelector = await interpretSelector(on, ancestors);

      /* Create a key from the cursor arguments so it can be reused. */
      const queryKey = createQueryKey(Coll, actSelector, options);

      return [queryKey, childArgs];
    })
  );

  return new Map(entries);
}

/* Take all children publications arguments and derive
 * a single function of `(fields, ...ancestors) => bool`
 * for which a thruthy result will trigger observers invalidation.
 * If any child publication doesn't specify any deps (implicity or explicit),
 * force observers invalidation on each parent document change. */
export function interpretFieldDeps(children) {
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
  const depsFns = Array.from(depsAsSet).map((dep) => {
    return async function (fields, ...ancestors) {
      if (typeof dep === "boolean") return dep;

      /* A function dep should return the same type of list as `deps` argument,
       * ie a list of keys to watch in the changed `fields`.
       * If it returns a falsy value, it will be treated as undefined deps
       * and trigger observers invalidation each time. */
      if (isFunc(dep)) {
        const res = await dep(fields, ...ancestors);
        if (isArr(res)) return res.some((key) => hasOwn(fields, key));

        return !res;
      }

      /* A key dep will simply check if it is included in the changed `fields` */
      if (typeof dep === "string") return hasOwn(fields, dep);

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
 * - [] = list of keys the changed `fields` must include to invalidate
 * - Function = dynamically normalized deps
 * - undefined = unspecified deps
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
export async function interpretSelector(selector, ancestors = []) {
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

export function createDebugLog(debug) {
  const hasLocation = (location) => {
    if (!debug) return false;
    if (debug === true) return true;
    if (isArr(debug)) return debug.includes(location);
    if (isObj(debug)) return !!debug[location];
    return false;
  };

  return function log(location, ...content) {
    if (hasLocation(location)) {
      // eslint-disable-next-line no-console
      console.log(location, ...content);
    }
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
 * - every child must be an object or a falsy value to ignore
 * - a join key cannot be declared both explicitly in `children`
 *   and implicitly in parent `fields` join section
 * - parent own fields are separated from join fields and only own fields
 *   remain on the normalized parent args
 */
export function normalizeArgs({
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

  const normalizedChildren = children.reduce((acc, childArgs) => {
    if (!childArgs) {
      return acc;
    }

    if (!isObj(childArgs)) {
      const protocol = getProtocol();
      throw new Error(
        `Each child of '${protocol.getName(Coll)}' collection must be an object or a falsy value to ignore.`
      );
    }

    if (!childArgs.join) return [...acc, childArgs];
    const { join: explicitJoinKey, ...rest } = childArgs;

    if (joinKeys.includes(explicitJoinKey)) {
      throw new Error(
        `Join '${explicitJoinKey}' is defined both in parent fields and as an explicit child. Choose one or the other.`
      );
    }

    return [...acc, joinToArgs(Coll, explicitJoinKey, rest)];
  }, []);

  const additionalJoinChildren = joinKeys.map((joinKey) =>
    joinToArgs(Coll, joinKey, { debug, fields: joinFields[joinKey] })
  );

  const allChildren = [...normalizedChildren, ...additionalJoinChildren];

  /* Children can depend on parent fields to compute their selectors.
   * Ensure those parent fields are present in the parent observer projection. */
  const ownFieldKeysFromDeps = allChildren.flatMap((childArgs) =>
    deriveParentFieldDeps(childArgs)
  );

  const ownFieldsFromDeps = Object.fromEntries(
    Array.from(new Set(ownFieldKeysFromDeps)).map((key) => [key, 1])
  );

  const ownFieldsWithDeps =
    fields === undefined || ownFields === undefined
      ? ownFields
      : { ...ownFields, ...ownFieldsFromDeps };

  return {
    Coll,
    selector,
    fields: ownFieldsWithDeps,
    children: allChildren,
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

function deriveParentFieldDeps({ deps, selector, on = selector }) {
  const parentFieldDeps = new Set();

  if (isArr(on)) {
    const [from] = on;
    const fromDep = isArr(from) ? from[0] : from;
    if (typeof fromDep === "string") parentFieldDeps.add(fromDep);
  }

  const normalizedDeps = normalizeDeps(deps);
  if (!isArr(normalizedDeps)) return Array.from(parentFieldDeps);

  normalizedDeps.forEach((dep) => {
    if (typeof dep === "string") parentFieldDeps.add(dep);
  });

  return Array.from(parentFieldDeps);
}
