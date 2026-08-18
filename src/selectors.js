import { getPropValue, isArr } from "./util";

/* Selector that always matches no document (_id is always required). */
export const VOID_SELECTOR = { _id: { $exists: false } };

/**
 * Build a selector for an array-form join across one or more parent documents.
 * Both sides accept dot-notation field paths. Wrapping a path in an array marks
 * that side of the relation as array-valued; it does not represent path nesting.
 *
 * @param {[string|[string], string|[string], Object?]} on
 * @param {Object[]} [parents=[]]
 * @returns {Object}
 */
export function getArrayJoinSelector(on, parents = []) {
  const [from, to, toSelector] = on;

  /* If first element is an array as in `[["propToChildrenVals"], "childProp"]`,
   * `childrenPropVals` on parent documents contains a list
   * of values associated with the joined `childProp`. */
  const fromArray = isArr(from);

  /* If second element is an array as in `["parentProp", ["propToParentVals"]]`,
   * `propToParentVals` on children documents contain lists of values
   * associated with the joined `parentProp`. */
  const toArray = isArr(to);

  let joinSelector;

  /* ["propToChildVal", "childProp"] */
  if (!fromArray && !toArray) {
    const parentValues = getJoinPropValues(from, parents);
    if (!parentValues.length) return VOID_SELECTOR;
    joinSelector = { [to]: { $in: parentValues } };
  }

  /* [["propToChildrenVals"], "childProp"] */
  if (fromArray && !toArray) {
    const parentValues = getJoinPropChainedValues(from[0], parents);
    if (!parentValues.length) return VOID_SELECTOR;
    joinSelector = { [to]: { $in: parentValues } };
  }

  /* ["parentProp", ["propToParentVals"]] */
  if (!fromArray && toArray) {
    const parentValues = getJoinPropValues(from, parents);
    if (!parentValues.length) return VOID_SELECTOR;
    joinSelector = { [to[0]]: { $elemMatch: { $in: parentValues } } };
  }

  /* [["propToChildrenVals"], ["propToParentVals"]] */
  if (fromArray && toArray) {
    const parentValues = getJoinPropChainedValues(from[0], parents);
    if (!parentValues.length) return VOID_SELECTOR;
    joinSelector = { [to[0]]: { $elemMatch: { $in: parentValues } } };
  }

  /* Unlikely because all four cases have been considered... */
  if (!joinSelector) return VOID_SELECTOR;

  return !toSelector ? joinSelector : { ...toSelector, ...joinSelector };
}

/* Collect unique, defined scalar values found at a dot-notation path. */
function getJoinPropValues(prop, docs = []) {
  const uniqueValues = new Set();

  for (const doc of docs) {
    const value = getPropValue(prop, doc);
    if (value === undefined) continue;
    uniqueValues.add(value);
  }

  return Array.from(uniqueValues.values());
}

/* Collect unique, defined values from arrays found at a dot-notation path. */
function getJoinPropChainedValues(prop, docs = []) {
  const uniqueValues = new Set();

  for (const doc of docs) {
    const arr = getPropValue(prop, doc);
    if (!isArr(arr)) continue;
    arr.forEach((v) => {
      if (v === undefined) return;
      uniqueValues.add(v);
    });
  }

  return Array.from(uniqueValues.values());
}
