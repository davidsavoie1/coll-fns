/**
 * Protocol interface implemented by adapters (Meteor, Node, etc.).
 * All methods may return synchronously or as a Promise.
 *
 * @typedef {Object} Protocol
 * @property {(Coll:any, selector?:Object, options?:Object) => number|Promise<number>} count
 *   Count documents matching selector.
 * @property {(Coll:any, selector?:Object, options?:Object) => Array|Promise<Array>} findList
 *   Return an array of documents for selector/options.
 * @property {(Coll:any) => ((doc:any)=>any)|undefined} getTransform
 *   Optional per-collection transform applied to each fetched document.
 * @property {(fn:Function) => Function} [bindEnvironment]
 *   Optional callback wrapper used to preserve runtime execution context
 *   (for example Meteor Fibers with Meteor.bindEnvironment).
 * @property {(Coll:any, doc:Object, options?:Object) => any|Promise<any>} insert
 *   Insert a document and return the inserted _id (or driver-specific result).
 * @property {(Coll:any, selector:Object, options?:Object) => number|Promise<number>} remove
 *   Remove matching documents and return the number removed.
 * @property {(Coll:any, selector:Object, modifier:Object, options?:Object) => number|Promise<number>} update
 *   Update matching documents and return the number modified.
 */

/**
 * Default protocol that throws for unimplemented methods.
 * Adapters should be provided via setProtocol to override these.
 * @type {Protocol}
 * @internal
 */
const DEFAULT_PROTOCOL = {
  /* Return a documents count */
  count(/* Coll, selector = {}, options = {} */) {
    throw new Error(`'count' method must be defined with 'setProtocol'.`);
  },

  /* Return a list of documents. */
  findList(/* Coll, selector = {}, options = {} */) {
    throw new Error(`'findList' method must be defined with 'setProtocol'.`);
  },

  /* Return the name of the collection.
   * Defaults to empty string, since not critical. */
  getName(/* Coll */) {
    return "";
  },

  /* Optional. Return a function that will transform each document
   * after being fetched with descendants. */
  getTransform(/* Coll */) {
    return undefined;
  },

  /* Optional. Wrap callbacks to preserve runtime environment context. */
  bindEnvironment(fn) {
    return fn;
  },

  /* Insert a document in a collection
   * and return the inserted _id. */
  insert(/* Coll, doc, options */) {
    throw new Error(`'insert' method must be defined with 'setProtocol'.`);
  },

  /* Remove documents in a collection
   * and return the number of removed documents. */
  remove(/* Coll, selector, options */) {
    throw new Error(`'remove' method must be defined with 'setProtocol'.`);
  },

  /* Update documents in a collection
   * and return the number of modified documents. */
  update(/* Coll, selector, modifier, options */) {
    throw new Error(`'update' method must be defined with 'setProtocol'.`);
  },
};

/**
 * The active protocol used by all high-level operations.
 * Initialized with DEFAULT_PROTOCOL and overridden via setProtocol.
 * @type {Protocol}
 * @internal
 */
let protocol = DEFAULT_PROTOCOL;

/**
 * Get the current protocol or a derived view of it.
 *
 * Usage:
 * - getProtocol() -> returns the active protocol object.
 * - getProtocol((p)=>wrap(p)) -> returns the result of calling your function with the active protocol.
 * - getProtocol(customObj) -> returns customObj (handy for inline overrides).
 *
 * @template T
 * @param {((p:Protocol)=>T)|Partial<Protocol>|undefined} overload
 * @returns {Protocol|T|Partial<Protocol>} The active protocol or the provided overload output.
 *
 * @example
 * // Get the active protocol
 * const p = getProtocol();
 *
 * @example
 * // Temporarily call a wrapped version without mutating global state
 * const wrapped = getProtocol((p) => ({ ...p, findList: (...args) => audit(p.findList(...args)) }));
 *
 * @example
 * // Provide a one-off protocol-like object
 * const custom = getProtocol({ findList: () => [] });
 */
export function getProtocol(overload) {
  if (!overload) return protocol;
  if (typeof overload === "function") return overload(protocol);
  if (typeof overload === "object") return overload;
  return protocol;
}

/**
 * Set the active protocol by merging user methods over DEFAULT_PROTOCOL.
 * Ensures all required methods exist (missing ones will still throw).
 *
 * @param {Partial<Protocol>} [methods={}] Implementation methods to install.
 * @example
 * import meteorAsync from './protocols/meteorAsync';
 * setProtocol(meteorAsync);
 */
export function setProtocol(methods = {}) {
  protocol = { ...DEFAULT_PROTOCOL, ...methods };
}
