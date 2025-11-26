import { getProtocol } from "./protocol";
import { then } from "./util";
import {
  decrementRecursiveField,
  dispatchFields,
  normalizeFields,
} from "./fields";
import { getJoins } from "./join";
import {
  getPropValue,
  includesSome,
  isArr,
  isFunc,
  isObj,
  typeOf,
  uniqueBy,
} from "./util";

/* Retrieve documents of a collection, including joined collections subdocuments.
 * `fields` option differs from native collections' one, in that it accepts
 * nested objects instead of dot notation only.

 * Joins are defined on the collection with `join(Coll, { ...joins })`.
 * If `joinPrefix` is defined, joins are used only if they are 
 * explicitely declared in the query's `fields` under that key.
 * Otherwise, they will be derived from the declared joins on the collection.
 * 
 * A `transform` option can be used to transform each doc. 
 * If a global collection transform can be derived from the collection,
 * it can be specified in the protocol
 * with `setProtocol({ getTransform(Coll) {} })`. */
export function fetchList(Coll, selector = {}, options = {}) {
  const { count, findList, getTransform } = getProtocol();

  const joins = getJoins(Coll);

  const collTransform = getTransform(Coll);
  const { fields, transform = collTransform, ...restOptions } = options;

  const enhance = (doc) => (isFunc(transform) ? transform(doc) : doc);

  const { _: ownFields, "+": joinFields = {} } = dispatchFields(fields, joins);
  const usedJoinKeys = Object.keys(joinFields);

  /* Use joins only if they are defined and used. If fields are defined, but not
   * as an object, also omit joins. */
  if (!joins || !usedJoinKeys?.length || (fields && !isObj(fields))) {
    return then(
      findList(Coll, selector, {
        ...restOptions,
        fields: ownFields,
        transform: null,
      }),
      (docs) => docs.map(enhance)
    );
  }

  /* === END FETCH WHEN NO JOINS === */

  return then(
    /* When joins exist, exclude `transform` from first fetch to reapply it after joining. */
    findList(Coll, selector, {
      ...restOptions,
      fields: ownFields,
      transform: null,
    }),

    (docs) => {
      /* Partition joins by type to treat them differently */
      const joinsByType = usedJoinKeys.reduce((acc, joinKey) => {
        const join = joins[joinKey];
        if (!join) return acc;

        const type = typeOf(join.on);
        const enhancedJoin = { ...join, _key: joinKey };
        const prev = acc[type] || [];
        return { ...acc, [type]: [...prev, enhancedJoin] };
      }, {});

      const {
        array: arrJoins = [],
        object: objJoins = [],
        function: fnJoins = [],
      } = joinsByType;

      return then(
        /* If `on` is an array of type `[fromProp, toProp]`,
         * fetch all sub docs at once before distributing them.
         * `fromProp` can be specified as an array with single element
         * (ie `["fromProp"]`) if source document references multiple joined docs. */
        arrJoins.reduce((_docs, join) => {
          const {
            _key,
            Coll: joinColl,
            on,
            single,
            postFetch,
            limit: joinLimit,
            ...joinRest
          } = join;

          return then(_docs, (readyDocs) => {
            const [fromProp, toProp, toSelector = {}] = on;
            const fromArray = isArr(fromProp);
            const propList = fromArray
              ? readyDocs.flatMap((doc) => doc[fromProp[0]])
              : readyDocs.map((doc) => doc[fromProp]);

            const toArray = isArr(toProp);
            const subSelector = toArray
              ? {
                  ...toSelector,
                  [toProp[0]]: { $elemMatch: { $in: propList } },
                }
              : { ...toSelector, [toProp]: { $in: propList } };

            /* If recursive (field > 1), prefetch documents with minimum fields
             * to check if some are returned first.
             * If so, continue fetch with parent fields. */
            const isRecursive = joinColl === Coll && joinFields[_key] > 1;

            return then(
              isRecursive && count(Coll, subSelector),

              (recursiveCount) => {
                const stopRecursion = isRecursive && !recursiveCount;

                const subJoinFields = isRecursive
                  ? decrementRecursiveField(_key, fields)
                  : joinFields[_key];

                const { _: own } = dispatchFields(
                  subJoinFields,
                  getJoins(joinColl) || {}
                );

                const allOwnIncluded = !own || Object.keys(own).length <= 0;
                const shouldAddToProp =
                  isObj(subJoinFields) && !allOwnIncluded && toProp !== "_id";

                const subFields = shouldAddToProp
                  ? { ...subJoinFields, [toProp]: 1 }
                  : subJoinFields;

                const subOptions = {
                  ...options,
                  ...joinRest,
                  fields: normalizeFields(subFields),
                  limit: undefined,
                  transform: isRecursive ? transform : undefined,
                };

                return then(
                  stopRecursion
                    ? []
                    : fetchList(joinColl, subSelector, subOptions),

                  (allJoinedDocs) => {
                    const indexedByToProp = toArray
                      ? {}
                      : allJoinedDocs.reduce((acc, joinedDoc) => {
                          const toPropValue = getPropValue(toProp, joinedDoc);
                          if (isArr(toPropValue)) {
                            return toPropValue.reduce((acc2, v) => {
                              const prev = acc2[v] || [];
                              return { ...acc2, [v]: [...prev, joinedDoc] };
                            }, acc);
                          }
                          const prev = acc[toPropValue] || [];
                          return {
                            ...acc,
                            [toPropValue]: [...prev, joinedDoc],
                          };
                        }, {});

                    return readyDocs.map((doc) => {
                      let joinedDocs = [];

                      if (toArray) {
                        joinedDocs = allJoinedDocs.filter((joinedDoc) => {
                          const toList = joinedDoc[toProp[0]] || [];
                          if (!fromArray) return toList.includes(doc[fromProp]);

                          const fromList = doc[fromProp[0]] || [];
                          return includesSome(toList, fromList);
                        });
                      } else if (fromArray) {
                        const fromValues = doc[fromProp[0]] || [];
                        joinedDocs = uniqueBy(
                          "_id",
                          fromValues.flatMap(
                            (fromValue) => indexedByToProp[fromValue] || []
                          )
                        );
                      } else {
                        const fromValue = doc[fromProp];
                        joinedDocs = indexedByToProp[fromValue] || [];
                      }

                      const raw = single ? joinedDocs[0] : joinedDocs;
                      const afterPostFetch = isFunc(postFetch)
                        ? postFetch(raw, doc)
                        : raw;
                      return { ...doc, [_key]: afterPostFetch };
                    });
                  }
                );
              }
            );
          });
        }, docs),

        (docsWithArrJoins) => {
          return then(
            /* If join is of type object, it is static and all docs will use the same joined docs.
             * However, they could differ in their `postFetch` treatment, since parent document
             * is passed as an argument. Hence, fetch all joined docs once, then return a new
             * doc enhancer function that will be applied later. */
            objJoins.map((join) => {
              const { _key, on } = join;
              const subSelector = on;
              return createJoinFetcher({
                Coll,
                join,
                fields: joinFields[_key],
                subSelector,
                options: restOptions,
                parentFields: fields,
              });
            }),

            (objJoinsEnhancers) => {
              return then(
                /* For each document, apply all `objJoinsEnhancers` defined for object type joins,
                 * then use function joins and associate their results. */
                docsWithArrJoins.map((doc) => {
                  const docWithObjJoins = objJoinsEnhancers.reduce(
                    (_doc, fn) => fn(_doc),
                    doc
                  );

                  return then(
                    fnJoins.reduce((_doc, join) => {
                      const { _key, on } = join;

                      return then(
                        [
                          _doc,
                          createJoinFetcher({
                            Coll,
                            join,
                            fields: joinFields[_key],
                            subSelector: isFunc(on) ? on(doc) : on,
                            options: restOptions,
                            parentFields: fields,
                          }),
                        ],

                        ([_doc, joinFetcher]) => joinFetcher(_doc)
                      );
                    }, docWithObjJoins),

                    /* Apply transform function to each document with all joins */
                    (docWithFnJoins) => enhance(docWithFnJoins)
                  );
                }),

                (res) => res
              );
            }
          );
        }
      );
    }
  );
}

export function fetchOne(Coll, selector, options = {}) {
  return then(
    fetchList(Coll, selector, { ...options, limit: 1 }),
    (res) => res[0]
  );
}

export function fetchIds(Coll, selector, options) {
  return then(
    fetchList(Coll, selector, { ...options, fields: { _id: 1 } }),
    (res) => pluckIds(res)
  );
}

/* Fetch a single Coll document with the selector
 * and return a boolean indicating if at least one exists. */
export function exists(Coll, selector) {
  return then(
    /* Limit to _id field to ensure minimal data */
    fetchOne(Coll, selector, { fields: { _id: 1 } }),

    (doc) => !!doc
  );
}

function pluckIds(arr) {
  return arr.map(({ _id }) => _id);
}

/* HELPERS */

/* Create a function that takes a `doc` and returns
 * a single joined doc (if `single` is true) or an array of joined docs. */
function createJoinFetcher({
  Coll,
  join: {
    _key,
    Coll: joinColl,
    on,
    single,
    postFetch,
    limit: joinLimit,
    ...joinRest
  },
  fields,
  subSelector,
  options,
  parentFields,
}) {
  const { count } = getProtocol();

  const isRecursive = joinColl === Coll;

  return then(
    isRecursive && count(Coll, subSelector),

    (recursiveCount) => {
      const stopRecursion = isRecursive && (!fields || !recursiveCount);

      const joinFields = isRecursive
        ? decrementRecursiveField(_key, parentFields)
        : fields;

      const subOptions = {
        ...options,
        ...joinRest,
        fields: normalizeFields(joinFields),
        limit: single ? 1 : joinLimit || undefined,
      };

      return then(
        /* Fetch joined documents */
        stopRecursion ? [] : fetchList(joinColl, subSelector, subOptions),

        (joinedDocs) => {
          return (doc) => {
            const raw = single ? joinedDocs[0] : joinedDocs;
            const afterPostFetch = isFunc(postFetch)
              ? postFetch(raw, doc)
              : raw;
            return { ...doc, [_key]: afterPostFetch };
          };
        }
      );
    }
  );
}
