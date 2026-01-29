export default {
  count: (Coll, selector, options) => Coll.find(selector, options).count(),

  findList: (Coll, selector, options) => Coll.find(selector, options).fetch(),

  getTransform: (Coll) => Coll._transform,

  insert: (Coll, doc) => Coll.insert(doc),

  remove: (Coll, selector) => Coll.remove(selector),

  update: (Coll, selector, modifier, options) => {
    /* Allow multi document update by default */
    return Coll.update(selector, modifier, { multi: true, ...options });
  },
};
