/**
 * Return a lowercase JS runtime type string for a value.
 * Examples: 'object', 'array', 'string', 'number', 'function', 'date', 'null', 'undefined'
 * @param {*} obj
 * @returns {string}
 */
export const typeOf = (obj) =>
  ({}).toString.call(obj).split(" ")[1].slice(0, -1).toLowerCase();

/**
 * Check if a value is an array.
 * @param {*} x
 * @returns {x is any[]}
 */
export const isArr = (x) => Array.isArray(x);

/**
 * Check if an array is empty (treats undefined as empty).
 * @param {any[]} [x=[]]
 * @returns {boolean}
 */
export const isEmpty = (x = []) => x.length <= 0;

/**
 * Check if a value is a function.
 * @param {*} x
 * @returns {x is Function}
 */
export const isFunc = (x) => typeof x === "function";

/**
 * Check if a value is null or undefined.
 * @param {*} x
 * @returns {x is null|undefined}
 */
export const isNil = (x) => [null, undefined].includes(x);

/**
 * Check if a value is a plain object (not an array, not null).
 * @param {*} x
 * @returns {x is Record<string, any>}
 */
export const isObj = (x) => x && !isArr(x) && typeOf(x) === "object";

/**
 * Check if a value is a Promise-like (has a then function).
 * @param {*} x
 * @returns {x is Promise<any>}
 */
export function isPromise(x) {
  return isFunc(x?.then);
}

/**
 * Heuristic: value is a selector if it's a plain object or a string (id).
 * @param {*} x
 * @returns {boolean}
 */
export const isSelector = (x) => isObj(x) || typeOf(x) === "string";

/**
 * Check if a value is a MongoDB-style modifier object with at least one key.
 * @param {*} x
 * @returns {boolean}
 */
export const isModifier = (x) => isObj(x) && !isEmpty(Object.keys(x));

/**
 * Extract unique first-level field names touched by a modifier's nested paths.
 * Example: { $set: { 'profile.name': 'A', age: 1 } } -> ['profile', 'age']
 * @param {Record<string, any>} modifier
 * @returns {string[]}
 */
export function get2ndLevelFields(modifier) {
  if (!isModifier(modifier)) return [];
  return Object.values(modifier).flatMap((fieldsMap = {}) => {
    if (!isObj(fieldsMap)) return [];
    return [
      ...new Set(
        Object.keys(fieldsMap).map((key) => {
          const [rootKey] = key.split(".");
          return rootKey;
        }),
      ),
    ];
  });
}

/**
 * Shallow-merge two objects by merging their second-level props.
 * For each top-level key: out[key] = { ...prev[key], ...added[key] }
 * @template T extends Record<string, any>, U extends Record<string, any>
 * @param {T} prev
 * @param {U} added
 * @returns {Record<string, any>}
 */
export function assign(prev, added) {
  const allKeys = [...new Set([...Object.keys(prev), ...Object.keys(added)])];
  return allKeys.reduce(
    (acc, key) => ({ ...acc, [key]: { ...prev[key], ...added[key] } }),
    {},
  );
}

/**
 * Return all items from toKeep that are not present in toRemove (by strict equality).
 * @template T
 * @param {T[]} toKeep
 * @param {T[]} toRemove
 * @returns {T[]}
 */
export function difference(toKeep, toRemove) {
  return toKeep.filter((item) => toRemove.indexOf(item) < 0);
}

/**
 * Check whether sourceArr contains any of the values in searchedArr.
 * @template T
 * @param {T[]} searchedArr
 * @param {T[]} sourceArr
 * @returns {boolean}
 */
export function includesSome(searchedArr, sourceArr) {
  return sourceArr.some((el) => searchedArr.indexOf(el) >= 0);
}

/**
 * Rename object keys using a dictionary mapping.
 * Keys not present in the dictionary are preserved.
 * @param {Record<string, string>} dictionnary
 * @param {Record<string, any>} object
 * @returns {Record<string, any>}
 */
export function renameKeys(dictionnary, object) {
  return map(([k, v]) => [dictionnary[k] || k, v], object);
}

/**
 * Union of two arrays preserving order and removing duplicates.
 * @template T
 * @param {T[]} arr1
 * @param {T[]} arr2
 * @returns {T[]}
 */
export function union(arr1, arr2) {
  const itemsToAdd = arr2.filter((item) => arr1.indexOf(item) < 0);
  return [...arr1, ...itemsToAdd];
}

/**
 * Keep only unique items from a list by converting each item to a comparable value.
 * - If toValueOrProp is a function, it's used to compute the comparable value.
 * - If it's a string, it's treated as a property name to read from each item.
 * - Otherwise, item identity is used.
 * @template T
 * @param {((x: T) => any)|string} toValueOrProp
 * @param {T[]} list
 * @returns {T[]}
 */
export function uniqueBy(toValueOrProp, list) {
  const toValue = isFunc(toValueOrProp)
    ? toValueOrProp
    : typeOf(toValueOrProp) === "string"
      ? (x) => x[toValueOrProp]
      : (x) => x;

  return list.reduce((acc, item) => {
    const value = toValue(item);
    const exists = acc.find((prevItem) => toValue(prevItem) === value);
    return exists ? acc : [...acc, item];
  }, []);
}

/* eslint-disable no-console */
/**
 * Thin wrapper around console.warn (safe in environments without console).
 * @param {...any} args
 */
export const warn = (...args) =>
  console && console.warn && console.warn(...args);
/* eslint-enable no-console */

/**
 * Concatenate two arrays and remove duplicate values (strict equality).
 * @template T
 * @param {T[]} arr1
 * @param {T[]} arr2
 * @returns {T[]}
 */
export function combineNoDuplicates(arr1, arr2) {
  return [...arr1, ...arr2].reduce(
    (acc, el) => (acc.includes(el) ? acc : [...acc, el]),
    [],
  );
}

/**
 * Build an object keyed by _id from an array of documents.
 * @template T extends { _id: string }
 * @param {T[]} [docs=[]]
 * @returns {Record<string, T>}
 */
export function indexById(docs = []) {
  return Object.fromEntries(docs.map((doc) => [doc._id, doc]));
}

/**
 * Get a (possibly nested) property value using dot-notation.
 * If an intermediate value is an array, returns a flattened array of sub-values.
 * Examples:
 * - getPropValue('a.b', { a: { b: 1 } }) -> 1
 * - getPropValue('a.b', { a: [{ b: 1 }, { b: 2 }] }) -> [1,2]
 * @param {string} dotKey
 * @param {Record<string, any>} doc
 * @returns {any}
 */
export function getPropValue(dotKey, doc) {
  const [rootKey, ...rest] = dotKey.split(".");
  const rootValue = doc[rootKey];

  if (rest.length < 1) return rootValue;

  const subDotKey = rest.join(".");
  if (isObj(rootValue)) return getPropValue(subDotKey, rootValue);
  if (isArr(rootValue))
    return rootValue.flatMap((subDoc) => {
      const subValue = getPropValue(subDotKey, subDoc);
      return isArr(subValue) ? subValue : [subValue];
    });
  return rootValue;
}

/**
 * Universal "then" helper that works with:
 * - Promises (awaits then applies fn(value, true))
 * - Arrays: if any element is a Promise, waits Promise.all, else passes array as-is
 * - Plain values: calls fn(value, false)
 *
 * This allows writing sync/async-agnostic code paths.
 *
 * @template T, R
 * @param {T|Promise<T>|Array<any>} maybePromise
 * @param {(value: any, isAsync: boolean) => R|Promise<R>} fn
 * @returns {R|Promise<R>}
 */
export function then(maybePromise, fn) {
  /* If `maybePromise` is an array, check if ANY element is a promise. */
  if (isArr(maybePromise)) {
    const arr = maybePromise;
    if (arr.some(isPromise)) {
      return Promise.all(arr).then((value) => fn(value, true));
    }

    return fn(arr, false);
  }

  if (isPromise(maybePromise))
    return maybePromise.then((value) => fn(value, true));

  return fn(maybePromise, false);
}

/**
 * Map over arrays or objects.
 * - If x is an array, behaves like Array.prototype.map(fn).
 * - If x is a plain object, maps over Object.entries and rebuilds an object from returned [k, v] tuples.
 * - If x is omitted, returns a curried function waiting for the collection.
 *
 * For objects, fn receives ([key, value]) and must return [nextKey, nextValue].
 *
 * @template T, U
 * @param {(value: any, index?: number) => any} fn
 * @param {T[]|Record<string, any>} [x]
 * @returns {U[]|Record<string, any>|((x: any)=>any)}
 * @throws {TypeError} If x is neither an array nor a plain object.
 */
export function map(fn, x) {
  /* Return a curried function if object is undefined. */
  if (x === undefined) return (y) => map(fn, y);

  /* If object is an array, dispatch to native method. */
  if (isArr(x)) return x.map(fn);

  /* Ensure plain object */
  if (!isObj(x))
    throw new TypeError(`'map' only works on array or plain object`);

  /* If not an array, assume a plain object.
   * If not so, will throw an error. */
  return Object.fromEntries(Object.entries(x).map(fn));
}

/**
 * Filter arrays or objects.
 * - If x is an array, behaves like Array.prototype.filter(pred).
 * - If x is a plain object, filters Object.entries and rebuilds an object from kept entries.
 * - If x is omitted, returns a curried function waiting for the collection.
 *
 * For objects, pred receives ([key, value]) and must return a boolean.
 *
 * @template T
 * @param {(value: any, index?: number) => boolean} pred
 * @param {T[]|Record<string, any>} [x]
 * @returns {T[]|Record<string, any>|((x: any)=>any)}
 * @throws {TypeError} If x is neither an array nor a plain object.
 */
export function filter(pred, x) {
  /* Return a curried function if object is undefined. */
  if (x === undefined) return (y) => filter(pred, y);

  /* If object is an array, dispatch to native method. */
  if (isArr(x)) return x.filter(pred);

  /* Ensure plain object */
  if (!isObj(x))
    throw new TypeError(`'filter' only works on array or plain object`);

  /* If not an array, assume a plain object.
   * If not so, will throw an error. */
  return Object.fromEntries(Object.entries(x).filter(pred));
}
