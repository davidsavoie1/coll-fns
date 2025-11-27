import { getProtocol } from "./protocol";
import { then } from "./util";

/**
 * Count documents in a collection matching the selector.
 *
 * Works with both synchronous and asynchronous protocols.
 *
 * @template TColl
 * @param {TColl} Coll - The collection instance to count documents in.
 * @param {Object} selector - MongoDB-style query selector (e.g., { status: 'active' }).
 * @returns {number|Promise<number>} The number of matching documents.
 *
 * @example
 * // Count all active users
 * const active = await count(UsersCollection, { status: 'active' });
 *
 * @example
 * // Count all documents
 * const total = await count(UsersCollection, {});
 */
export function count(Coll, selector) {
  const { count: _count } = getProtocol();

  // Normalize sync/async protocol result to a Promise-like flow
  return then(_count(Coll, selector), (res) => res);
}
