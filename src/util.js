export const typeOf = (obj) =>
  ({}).toString.call(obj).split(" ")[1].slice(0, -1).toLowerCase();

export const isArr = (x) => Array.isArray(x);
export const isEmpty = (x = []) => x.length <= 0;
export const isFunc = (x) => typeof x === "function";
export const isNil = (x) => [null, undefined].includes(x);
export const isObj = (x) => x && !isArr(x) && typeOf(x) === "object";

/* Check if a value is a promise */
export function isPromise(x) {
  return isFunc(x?.then);
}

export const isSelector = (x) => isObj(x) || typeOf(x) === "string";
export const isModifier = (x) => isObj(x) && !isEmpty(Object.keys(x));

export function get2ndLevelFields(modifier) {
  if (!isModifier(modifier)) return [];
  return Object.values(modifier).flatMap((fieldsMap = {}) => {
    if (!isObj(fieldsMap)) return [];
    return [
      ...new Set(
        Object.keys(fieldsMap).map((key) => {
          const [rootKey] = key.split(".");
          return rootKey;
        })
      ),
    ];
  });
}

/* Combine two objects by merging their 2nd level props. */
export function assign(prev, added) {
  const allKeys = [...new Set([...Object.keys(prev), ...Object.keys(added)])];
  return allKeys.reduce(
    (acc, key) => ({ ...acc, [key]: { ...prev[key], ...added[key] } }),
    {}
  );
}

/* Return all elements from first list that are not present in the second one. */
export function difference(toKeep, toRemove) {
  return toKeep.filter((item) => toRemove.indexOf(item) < 0);
}

/* Check whether or not a source array includes any of the searched arrray values. */
export function includesSome(searchedArr, sourceArr) {
  return sourceArr.some((el) => searchedArr.indexOf(el) >= 0);
}

export function renameKeys(dictionnary, object) {
  return map(([k, v]) => [dictionnary[k] || k, v], object);
}

/* Combine elements from two lists, without duplicates. */
export function union(arr1, arr2) {
  const itemsToAdd = arr2.filter((item) => arr1.indexOf(item) < 0);
  return [...arr1, ...itemsToAdd];
}

/* Filter an array to keep only unique items by first converting each item
 * to a comparable value. If converter is a string, it is considered a prop.
 * If it is not a function or string, compare items by their identity. */
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
export const warn = (...args) =>
  console && console.warn && console.warn(...args);
/* eslint-enable no-console */

/* Combine two arrays, preventing duplicate values (strict equality). */
export function combineNoDuplicates(arr1, arr2) {
  return [...arr1, ...arr2].reduce(
    (acc, el) => (acc.includes(el) ? acc : [...acc, el]),
    []
  );
}

export function indexById(docs = []) {
  return Object.fromEntries(docs.map((doc) => [doc._id, doc]));
}

/* Return a value of a prop that could be declared as "root.child.subChild..."
 * which could return a nested object value. If the root value is an array,
 * return an flattened array of sub values. */
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

/* Execute a `fn` on a `maybePromise`.
 * If `maybePromise` is a promise, it will be awaited before continuing.
 * If it is an array, it will return a `Promise.all` promise
 * if ANY element of the array is itseld a promise.
 * Otherwise, it will be processed synchronously.
 * The function `fn(value, isAsync)` will receive the awaited value
 * (or the value itself if not awaited) and a flag indicating if it was async.
 * Very useful to create universal code that should be able to handle
 * synchronous or asynchronous flows. */
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

/* Function that maps on enumerable values of an object.
 * Can work on array (v) and plain objects ([k, v]). */
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

/* Function that filters on enumerable values of an object.
 * Can work on array (v) and plain objects ([k, v]). */
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
