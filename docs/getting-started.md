[← Documentation overview](../README.md#documentation)

# Installation and configuration

**IMPORTANT**: For concision, the **examples will use the synchronous Meteor protocol** to avoid `async/await` boilerplate. Of course, your code will have to be adapted when used with an asynchronous protocol.

```bash
npm install coll-fns
```

## `setProtocol(protocol)`

You will have to **define which protocol to use** before using any of the library's functionality.

```js
import { setProtocol, protocols } from "coll-fns";

/* Built-in protocols include:
 * - meteorAsync
 * - meteorSync
 * - node
 *
 * Can also define a custom protocol! */
setProtocol(protocols.meteorAsync);
```

In a Meteor project, you should probably define a **different protocol on client** (synchronous) **and server** (asynchronous).

```js
import { setProtocol, protocols } from "coll-fns";

const protocol = Meteor.isServer ? protocols.meteorAsync : protocols.meteorSync;
setProtocol(protocol);
```

There's also a **native NodeJS MongoDB driver** protocol built-in (`protocols.node`).

### Execution context (`bindEnvironment`)

Protocols can optionally expose a `bindEnvironment(fn)` method.  
It is used by hooks internals to run callbacks in the expected runtime context.

- In Meteor Fiber-based servers, this prevents errors like:
  - `Meteor code must always run within a Fiber...`
- In environments that don't need special wrapping, it can be omitted.

`protocols.meteorSync` already handles this automatically:

- On Meteor server with Fibers, it uses `Meteor.bindEnvironment` when available.
- On Meteor client (or any environment where `Meteor.bindEnvironment` is unavailable), it falls back to a normal direct call.

So if you use `protocols.meteorSync` on both client and server in a Fiber-based Meteor app, **no override is required** specifically for this behavior.

<details style="margin-bottom: 1rem">
<summary><strong>Custom protocol</strong></summary>

You could even define a **custom protocol** for the library to work with another interface to MongoDB or even to a completely different storage system! Joins and hooks should then work the same way (let me know if you do 🤓!).

```js
import { setProtocol } from "coll-fns";

const customProtocol = {
  /* Return a documents count */
  count(/* Coll, selector = {}, options = {} */) {},

  /* Return a list of documents. */
  findList(/* Coll, selector = {}, options = {} */) {},

  /* Return the name of the collection. */
  getName(/* Coll */) {},

  /* Optional. Return a function that will transform each document
   * after being fetched with descendants. */
  getTransform(/* Coll */) {},

  /* Optional. Wrap callbacks to preserve runtime context
   * (ex: Meteor.bindEnvironment with Fibers). */
  bindEnvironment(/* fn */) {},

  /* Insert a document in a collection
   * and return the inserted _id. */
  insert(/* Coll, doc, options */) {},

  /* Observe document changes.
   * Must return a handle with a `stop()` method. */
  observe(/* Coll, selector = {}, callbacks = {}, options = {} */) {},

  /* Remove documents in a collection
   * and return the number of removed documents. */
  remove(/* Coll, selector, options */) {},

  /* Stable stringify function used for internal query keys.
   * EJSON canonical stringify is used as a good default,
   * but can be overridden. */
  stringify(/* value */) {},

  /* Update documents in a collection
   * and return the number of modified documents. */
  update(/* Coll, selector, modifier, options */) {},
};

setProtocol(customProtocol);
```

`observe` expected shape:

```js
observe(Coll, selector = {}, callbacks = {}, options = {}) {
  const { added, changed, removed } = callbacks;

  // Your implementation subscribes reactively to selector/options changes.
  // Callbacks should be invoked with:
  // - added(id, fields)
  // - changed(id, fields)
  // - removed(id)
  //
  // Then return an object exposing a stop() method.
  return {
    stop() {
      // Tear down underlying observer/resources.
    },
  };
}
```

Notes:

- `observe` can be sync or async (returning a Promise of the stop-handle).
- `fields` should contain changed/added fields payload expected by your transport.
- `publish()` relies on this contract to keep nested observers in sync.

If your runtime has special callback context requirements, implement `bindEnvironment`.

```js
const customProtocol = {
  // ...
  bindEnvironment(fn) {
    if (typeof Meteor?.bindEnvironment === "function") {
      return Meteor.bindEnvironment(fn);
    }
    return fn;
  },
};
```

If your runtime has no such requirement, simply omit `bindEnvironment`.

If you want to use the [`publish()`](reactive-publications.md#publishpublication-coll-selector-options) composite publication helper:

- `observe` must be defined on the protocol.
- `stringify` can be defined if the default EJSON implementation is not sufficient.

</details>

## Bypassing `coll-fns`

`coll-fns` intentionally keeps collection instances untouched. It doesn't add any methods nor change exsting ones' behaviour. To bypass any `coll-fns` functionality, simply **use the normal collection methods** (ex: `Coll.insert`, `Coll.find().fetchAsync()`, `Coll.removeOne()`). Joins and hooks will only get fired when using the library's functions... and if joins and hooks have been pre-defined, of course! 😉
