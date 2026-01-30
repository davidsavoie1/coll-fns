export default {
  count(Coll, selector, options) {
    /* Use rawCollection's countDocuments method if available
     * to prevent loading in memory */
    const rawColl = Coll.rawCollection();
    if (rawColl.countDocuments) return rawColl.countDocuments(selector);

    /* If `countDocuments` raw collection method is not available,
     * use the MongoDB async count method. */
    return Coll.find(selector, options).countAsync();
  },

  findList: (Coll, selector, options) =>
    Coll.find(selector, options).fetchAsync(),

  getName: (Coll) => Coll._name || "",

  getTransform: (Coll) => Coll._transform,

  insert: (Coll, doc) => Coll.insertAsync(doc),

  remove: (Coll, selector) => Coll.removeAsync(selector),

  update: (Coll, selector, modifier, options) => {
    /* Allow multi document update by default */
    return Coll.updateAsync(selector, modifier, { multi: true, ...options });
  },
};
