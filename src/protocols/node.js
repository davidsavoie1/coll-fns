import { renameKeys } from "../util";

/**
 * Node protocol for the official MongoDB driver.
 * Assumes Coll is an instance of mongodb.Collection.
 */
export default {
  /**
   * Count documents matching selector.
   * Uses countDocuments (preferred over deprecated cursor.count()).
   */
  count(Coll, selector = {}, options = {}) {
    return Coll.countDocuments(selector || {}, options);
  },

  /**
   * Return an array of documents for selector/options.
   */
  findList(Coll, selector = {}, options = {}) {
    const renamedOptions = renameKeys({ fields: "projection" }, options || {});
    return Coll.find(selector || {}, renamedOptions).toArray();
  },

  /**
   * Return the collection's name. Defaults to empty string.
   */
  getName: (Coll) => Coll.collectionName || "",

  /**
   * Optional per-collection transform; expose Coll.transform if present.
   */
  getTransform(Coll) {
    return typeof Coll?.transform === "function" ? Coll.transform : undefined;
  },

  /**
   * Insert a document and return insertedId.
   */
  insert(Coll, doc, options) {
    return Coll.insertOne(doc, options).then((res) => res?.insertedId);
  },

  /**
   * Remove documents. Honors options.multi (default true).
   */
  remove(Coll, selector = {}, options = {}) {
    const { multi = true, ...rest } = options || {};
    const p = multi
      ? Coll.deleteMany(selector || {}, rest)
      : Coll.deleteOne(selector || {}, rest);
    return p.then((res) => res?.deletedCount ?? 0);
  },

  /**
   * Update documents. Honors options.multi (default true).
   * Returns modifiedCount (or upsertedCount as fallback).
   */
  update(Coll, selector = {}, modifier = {}, options = {}) {
    const { multi = true, ...rest } = options || {};
    const p = multi
      ? Coll.updateMany(selector || {}, modifier || {}, rest)
      : Coll.updateOne(selector || {}, modifier || {}, rest);
    return p.then((res) => res?.modifiedCount ?? res?.upsertedCount ?? 0);
  },
};
