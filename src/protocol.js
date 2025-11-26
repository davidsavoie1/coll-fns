const DEFAULT_PROTOCOL = {
  count(/* Coll, selector = {}, options = {} */) {
    throw new Error(`'count' method must be defined with 'setProtocol'.`);
  },

  cursor(/* Coll, selector = {}, options = {} */) {
    throw new Error(`'cursor' method must be defined with 'setProtocol'.`);
  },

  /* A function that takes a collection, selector and options
   * and returns a list of documents. */
  findList(/* Coll, selector = {}, options = {} */) {
    throw new Error(`'findList' method must be defined with 'setProtocol'.`);
  },

  /* A function that transforms each document defined at the collection level. */
  getTransform(/* Coll */) {
    return undefined;
  },

  /* A function that inserts a doc in a collection and returns the inserted _id. */
  insert(/* Coll, doc, options */) {
    throw new Error(`'insert' method must be defined with 'setProtocol'.`);
  },

  /* A function that removes docs in a collection and returns the number of removed documents. */
  remove(/* Coll, selector, options */) {
    throw new Error(`'remove' method must be defined with 'setProtocol'.`);
  },

  /* A function that updates docs in a collection and returns the number of modified documents. */
  update(/* Coll, selector, modifier, options */) {
    throw new Error(`'update' method must be defined with 'setProtocol'.`);
  },
};

let protocol = DEFAULT_PROTOCOL;

export function getProtocol(overload) {
  if (!overload) return protocol;
  if (typeof overload === "function") return overload(protocol);
  if (typeof overload === "object") return overload;
  return protocol;
}

/* Define protocol methods that will be merged with the default one. */
export function setProtocol(methods = {}) {
  protocol = { ...DEFAULT_PROTOCOL, ...methods };
}

/* Modify current protocol by adding/overwriting methods or applying a function to it. */
export function updateProtocol(fnOrMethods) {
  protocol =
    typeof fnOrMethods === "function"
      ? fnOrMethods(protocol)
      : { ...protocol, ...fnOrMethods };
}
