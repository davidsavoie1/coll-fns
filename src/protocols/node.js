import { renameKeys } from "./util";

export default {
  /* A function that takes a collection, selector and options
   * and returns a number of documents. */
  async count(Coll, selector = {}, options = {}) {
    const cursor = await Coll.find(selector, options);
    return cursor.count();
  },

  cursor: (Coll, selector, options) => {
    const renamedOptions = renameKeys({ fields: "projection" }, options);
    return Coll.find(selector, renamedOptions);
  },

  /* A function that takes a collection, selector and options
   * and returns a list of documents. */
  async findList(Coll, selector = {}, options = {}) {
    const renamedOptions = renameKeys({ fields: "projection" }, options);
    const cursor = await Coll.find(selector, renamedOptions);
    return cursor.toArray();
  },

  /* A function that transforms each document defined at the collection level.
   * For retrocompatibility with Metor collections. No default NodeJS implementation. */
  getTransform(/* Coll */) {
    return undefined;
  },

  /* A function that inserts a doc in a collection asynchronously
   * and returns the inserted _id. */
  async insert(Coll, doc, options) {
    const res = await Coll.insertOne(doc, options);
    return res?.insertedId;
  },

  async remove(Coll, selector, options) {
    const res = await Coll.deleteMany(selector, options);
    return res?.deletedCount;
  },

  async update(Coll, selector, modifier, options) {
    const res = await Coll[options.multi ? "updateMany" : "updateOne"](
      selector,
      modifier,
      options
    );
    return res?.modifiedCount;
  },
};
