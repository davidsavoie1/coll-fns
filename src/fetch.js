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

/**
 * @typedef {Object} FetchOptions
 * @property {Object} [fields] - Field projection. Supports nested objects and '+' join fields.
 * @property {Object} [sort] - Sort specification (e.g., { createdAt: -1 }).
 * @property {number} [limit] - Max number of documents to return.
 * @property {number} [skip] - Number of documents to skip.
 * @property {Function} [transform] - Document transform function. If omitted, protocol getTransform(Coll) is used.
 * @property {Object} [joins] - Optional per-call join overrides (usually joins come from getJoins(Coll)).
 *
 * @typedef {Object} JoinDef
 * @property {*} Coll - Target collection of the join.
 * @property {[*]|Object|Function} on - How to relate parent docs to target docs:
 *   - Array form: [fromProp, toProp, toSelector?]
 *   - Object form: static selector for target docs
 *   - Function form: (doc) => selector, computed per parent doc
 * @property {boolean} [single] - If true, attach a single doc instead of an array.
 * @property {Function} [postFetch] - (joined, parentDoc) => any. Final shaping of joined value.
 * @property {number} [limit] - Limit for joined query when single is false.
 */

/**
 * Retrieve documents of a collection, with optional joined subdocuments.
 * - Fields accept nested objects; dot-notation is normalized internally.
 * - Joins are defined via getJoins(Coll). Join usage is controlled through '+' in fields.
 * - Works with both sync and async protocols.
 *
 * @template TColl
 * @param {TColl} Coll - The collection instance.
 * @param {Object} [selector={}] - MongoDB-style query selector.
 * @param {FetchOptions} [options={}] - Fetch options and join controls.
 * @returns {Array|Promise<Array>} List of documents, possibly augmented with join keys.
 *
 * @example
 * // Simple list
 * const users = await fetchList(Users, { status: 'active' }, { fields: { name: 1 } });
 *
 * @example
 * // Join authors on posts
 * const posts = await fetchList(Posts, {}, {
 *   fields: { title: 1, '+': { author: 1 } }
 * });
 */
export function fetchList(Coll, selector = {}, options = {}) {
  const { count, findList, getTransform } = getProtocol();

  const joins = getJoins(Coll);

  const collTransform = getTransform(Coll);
  const { fields, transform = collTransform, ...restOptions } = options;

  const enhance = (doc) => (isFunc(transform) ? transform(doc) : doc);

  // Partition field spec into own (base collection) and join fields ('+')
  const { _: ownFields, "+": joinFields = {} } = dispatchFields(fields, joins);
  const usedJoinKeys = Object.keys(joinFields);

  // If no joins or fields are not objects, perform a straight fetch
  if (!joins || !usedJoinKeys?.length || (fields && !isObj(fields))) {
    return then(
      findList(Coll, selector, {
        ...restOptions,
        fields: ownFields,
        transform: null,
      }),
      (docs) => docs.map(enhance),
    );
  }

  /* === END FETCH WHEN NO JOINS === */

  // When joins exist, exclude transform from base fetch to reapply after joining
  return then(
    findList(Coll, selector, {
      ...restOptions,
      fields: ownFields,
      transform: null,
    }),

    (docs) => {
      // Partition joins by "on" type to process differently
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

      // Process array-type joins: [fromProp, toProp, toSelector?]
      return then(
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

            // Support recursive joins by checking for additional depth and data existence
            const isRecursive = joinColl === Coll && joinFields[_key] > 1;

            return then(
              isRecursive && count(Coll, subSelector),

              (recursiveCount) => {
                const stopRecursion = isRecursive && !recursiveCount;

                const subJoinFields = isRecursive
                  ? decrementRecursiveField(_key, fields)
                  : joinFields[_key];

                // Determine whether we need to include toProp explicitly in subFields
                const { _: own } = dispatchFields(
                  subJoinFields,
                  getJoins(joinColl) || {},
                );

                const allOwnIncluded = !own || Object.keys(own).length <= 0;
                const shouldAddToProp =
                  isObj(subJoinFields) && !allOwnIncluded && toProp !== "_id";

                const subFields = shouldAddToProp
                  ? { ...subJoinFields, [toProp]: 1 }
                  : subJoinFields;

                /** @type {FetchOptions} */
                const subOptions = {
                  ...options,
                  ...joinRest,
                  fields: normalizeFields(subFields),
                  limit: undefined,
                  transform: isRecursive ? transform : undefined,
                };

                // Fetch all joined docs for this join and attach to each base doc
                return then(
                  stopRecursion
                    ? []
                    : fetchList(joinColl, subSelector, subOptions),

                  (allJoinedDocs) => {
                    // Build index by toProp for faster lookups when toProp is scalar
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
                        // toProp is an array on joined docs
                        joinedDocs = allJoinedDocs.filter((joinedDoc) => {
                          const toList = joinedDoc[toProp[0]] || [];
                          if (!fromArray) return toList.includes(doc[fromProp]);

                          const fromList = doc[fromProp[0]] || [];
                          return includesSome(toList, fromList);
                        });
                      } else if (fromArray) {
                        // fromProp is array on parent docs
                        const fromValues = doc[fromProp[0]] || [];
                        joinedDocs = uniqueBy(
                          "_id",
                          fromValues.flatMap(
                            (fromValue) => indexedByToProp[fromValue] || [],
                          ),
                        );
                      } else {
                        // Both scalar
                        const fromValue = doc[fromProp];
                        joinedDocs = indexedByToProp[fromValue] || [];
                      }

                      const raw = single ? joinedDocs[0] : joinedDocs;
                      const afterPostFetch = isFunc(postFetch)
                        ? postFetch(raw, doc)
                        : raw;
                      return { ...doc, [_key]: afterPostFetch };
                    });
                  },
                );
              },
            );
          });
        }, docs),

        (docsWithArrJoins) => {
          // Prepare object-type joins (static selector): fetched once, applied per doc
          return then(
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
              // For each doc, apply object-join enhancers, then function-type joins per doc
              return then(
                docsWithArrJoins.map((doc) => {
                  const docWithObjJoins = objJoinsEnhancers.reduce(
                    (_doc, fn) => fn(_doc),
                    doc,
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

                        ([_doc, joinFetcher]) => joinFetcher(_doc),
                      );
                    }, docWithObjJoins),

                    // Re-apply transform after all joins
                    (docWithFnJoins) => enhance(docWithFnJoins),
                  );
                }),

                (res) => res,
              );
            },
          );
        },
      );
    },
  );
}

/**
 * Fetch a single document matching the selector.
 *
 * @template TColl
 * @param {TColl} Coll - The collection instance.
 * @param {Object} selector - MongoDB-style query selector.
 * @param {FetchOptions} [options={}] - Fetch options.
 * @returns {Object|undefined|Promise<Object|undefined>} First matching document or undefined.
 */
export function fetchOne(Coll, selector, options = {}) {
  return then(
    fetchList(Coll, selector, { ...options, limit: 1 }),
    (res) => res[0],
  );
}

/**
 * Fetch only document IDs for the selector.
 *
 * @template TColl
 * @param {TColl} Coll - The collection instance.
 * @param {Object} selector - MongoDB-style query selector.
 * @param {FetchOptions} [options] - Fetch options.
 * @returns {Array<string>|Promise<Array<string>>} Array of IDs.
 */
export function fetchIds(Coll, selector, options) {
  return then(
    fetchList(Coll, selector, { ...options, fields: { _id: 1 } }),
    (res) => pluckIds(res),
  );
}

/**
 * Check existence of at least one document matching selector.
 *
 * @template TColl
 * @param {TColl} Coll - The collection instance.
 * @param {Object} selector - MongoDB-style query selector.
 * @returns {boolean|Promise<boolean>} True if a document exists.
 */
export function exists(Coll, selector) {
  return then(
    // Limit to _id field to ensure minimal data
    fetchOne(Coll, selector, { fields: { _id: 1 } }),

    (doc) => !!doc,
  );
}

/**
 * Extract _id values from an array of documents.
 * @param {Array<{_id: string}>} arr - Documents to pluck IDs from.
 * @returns {Array<string>} List of IDs.
 * @internal
 */
function pluckIds(arr) {
  return arr.map(({ _id }) => _id);
}

/* HELPERS */

/**
 * Create a join fetcher function for a given join definition.
 * Returns a function (doc) => docWithJoin that attaches joined data under join _key.
 *
 * Handles:
 * - Recursive joins (Coll === joinColl) with depth tracking via decrementRecursiveField
 * - Post-fetch shaping via join.postFetch
 *
 * @param {Object} args
 * @param {*} args.Coll - Parent collection.
 * @param {JoinDef & {_key: string}} args.join - The join definition with internal key.
 * @param {Object|number} args.fields - Join field spec or depth number (for '+').
 * @param {Object} args.subSelector - Selector for the joined collection.
 * @param {FetchOptions} args.options - Parent fetch options to forward.
 * @param {Object} args.parentFields - Parent fields, used for recursive depth.
 * @returns {Function|Promise<Function>} Function that attaches joined data to a doc.
 * @internal
 */
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
    // For recursive joins, check if there would be results to avoid unnecessary nested fetch
    isRecursive && count(Coll, subSelector),

    (recursiveCount) => {
      const stopRecursion = isRecursive && (!fields || !recursiveCount);

      const joinFields = isRecursive
        ? decrementRecursiveField(_key, parentFields)
        : fields;

      /** @type {FetchOptions} */
      const subOptions = {
        ...options,
        ...joinRest,
        fields: normalizeFields(joinFields),
        limit: single ? 1 : joinLimit || undefined,
      };

      // Fetch joined docs and build an applier function
      return then(
        stopRecursion ? [] : fetchList(joinColl, subSelector, subOptions),

        (joinedDocs) => {
          return (doc) => {
            const raw = single ? joinedDocs[0] : joinedDocs;
            const afterPostFetch = isFunc(postFetch)
              ? postFetch(raw, doc)
              : raw;
            return { ...doc, [_key]: afterPostFetch };
          };
        },
      );
    },
  );
}
