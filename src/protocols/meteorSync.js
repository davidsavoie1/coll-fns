export default {
  count: (Coll, selector, options) => Coll.find(selector, options).count(),

  findList: (Coll, selector, options) => Coll.find(selector, options).fetch(),

  getName: (Coll) => Coll._name || "",

  getTransform: (Coll) => Coll._transform,

  bindEnvironment(fn) {
    const maybeMeteor = globalThis?.Meteor;
    const bind = maybeMeteor?.bindEnvironment;
    if (typeof bind !== "function") return fn;
    return bind(fn);
  },

  insert: (Coll, doc) => Coll.insert(doc),

  remove: (Coll, selector) => Coll.remove(selector),

  update: (Coll, selector, modifier, options) => {
    /* Allow multi document update by default */
    return Coll.update(selector, modifier, { multi: true, ...options });
  },
};
