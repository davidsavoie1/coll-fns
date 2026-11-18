[← Documentation overview](../README.md#documentation)

# Hooks and write operations

Hooks allow you to **intercept and react to data mutations** (insertions, updates, removals) on collections. They are triggered conditionally **before or after** write operations, making them ideal for validation, cascading updates, logging, and other side effects.

## `hook(Coll, hooksObj)`

Register hooks on a collection to run before or after specific write operations (insert, update, remove).

The same object argument can define multiple hook types. Each hook type is defined using an array of hook definitions, making it possible to **define multiple hooks at once**.

Hooks can be **defined in multiple places** in your codebase. This allows grouping functionally related hooks together.

```js
import { hook } from "coll-fns";
import { Users, Posts } from "/collections";

hook(Users, {
  beforeInsert: [
    {
      fn(doc) {
        if (!doc.email) throw new Error("Email is required");

        doc.createdAt = new Date();
      },
    },
  ],

  onInserted: [
    {
      fn(doc) {
        console.log(`New user created: ${doc._id}`);
      },
    },
  ],
});
```

### Before hooks

These hooks run **before** the write operation and can **prevent the operation** by throwing an error.

- **`beforeInsert`**: Runs before inserting a document. Receives `(doc)`.
- **`beforeUpdate`**: Runs before updating documents. Receives `([...docsToUpdate], modifier)`.
- **`beforeRemove`**: Runs before removing documents. Receives `([...docsToRemove])`.

Although arguments can be mutated, it is not the main purpose of these hooks. Mutations are brittle and hard to debug.

`beforeUpdate` and `beforeRemove` receive an **array of targeted documents**, whereas `beforeInsert` receives a **single document**.

### After hooks

These hooks run **after** the write operation completes and are **fire-and-forget** (not awaited by the caller of the collection function). They are usually used to trigger side-effects. They should not throw errors that should get back to the caller.

- **`onInserted`**: Runs after a document is inserted. Receives `(doc)`.
- **`onUpdated`**: Runs after a document is updated. Receives `(afterDoc, beforeDoc)`.
- **`onRemoved`**: Runs after a document is removed. Receives `(doc)`.

**IMPORTANT!**

1. These hooks **might create incoherent state** when used as a denormalization technique (a common and helpful use case) if a downstream update fails. It is **NOT inherent to `coll-fns`**, but rather to eventual consistent database designs. Even if the after hooks were awaited, errors would not rollback prior successful updates.

2. Although hooks can define `onError` callbacks, if `fn` executes async code, **it MUST await it or return it as a promise**. Otherwise, `onError` callback will never get fired because the function will be running in a separate promise context. If `fn` starts async work and doesn’t return/await it, any error will become an **unhandled rejection (and may crash the process)**.

❌ **Wrong**

```js
hook(Coll, {
  fn(doc) {
    update(/* Some other collection */); // not awaited / not returned
  },
});
```

Might crash the process!

```
UnhandledPromiseRejection: Error: Validation failed
    at beforeUpdate (.../src/hooks.js:42:11)
    at update (.../src/update.js:128:7)
    ...
```

✅ **Right**

```js
hook(Coll, {
  async fn(doc) {
    await update(/* Some other collection */); // Awaited
  },
});
```

or

```js
hook(Coll, {
  fn(doc) {
    return update(/* Some other collection */); // Returned promise
  },
});
```

### Hook definition properties

Each hook definition is an object with the following properties:

```js
{
  /* Required. The function to execute.
   * Arguments depend on the hook type (see above).
   * Can be either synchronous or asynchronous. */
  fn(...args) { /* ... */ },

  /* Optional. Fields to fetch for the documents passed to the hook.
   * Fields for multiple hooks of the same type are automatically combined.
   * If any hook of a type requests all fields with `undefined` or `true`,
   * all other similar hooks will also get the entire documents.
   * Has no effect on `beforeInsert`: the doc to be inserted is the argument. */
  fields: { name: 1, email: 1 },

  /* Optional (`onUpdated` only). If true, fetch the document state
   * before the update with the same `fields` value.
   * Otherwise, only _id is fetched initially (they would have been
   * needed anyway to fetch their "after" versions). */
  before: true,

  /* Optional. Predicate that prevents the hook from running if it
   * returns a truthy value. Can be sync or async.
   * Receives the same arguments as fn. */
  unless(doc) { return doc.isBot; },

  /* Optional. Predicate that allows the hook to run only if it
   * returns a truthy value. Can be sync or async.
   * Receives the same arguments as fn. */
  when(doc) { return doc.status === "pending"; },

  /* Optional handler called if the hook function throws an error.
   * A default handler that logs to console.error is defined
   * for after-hooks (onInserted, onUpdated, onRemoved)
   * to prevent an error from crashing the server. */
  onError(err, hookDef) { /* ... */ },
}
```

### Examples

<details>
<summary>Data validation</summary>

```js
hook(Users, {
  beforeInsert: [
    {
      fn(doc) {
        if (!doc.email || !doc.email.includes("@")) {
          throw new Error("Invalid email");
        }
      },
    },
  ],
});
```

</details>

<details>
<summary>Cascading updates</summary>

```js
/* If user's name changed, update their posts' denormalized data */
hook(Users, {
  onUpdated: [
    {
      fields: { name: 1 },
      /* Use `when` predicate to run the hook only on this condition.
       * Could also have used `unless` or checked condition inside `fn`. */
      when: (after, before) => after.name !== before.name,

      /* Effect to run - uses update() which also supports hooks */
      fn(after) {
        const { _id, name } = after;
        update(Posts, { authorId: _id }, { $set: { authorName: name } });
      },
    },
  ],
});
```

</details>

<details>
<summary>Conditional hooks with when/unless</summary>

```js
hook(Posts, {
  beforeRemove: [
    {
      /* Limit fetched fields of docs to be removed */
      fields: { _id: 1 },
      /* Only run for non-admin users */
      unless() {
        return Meteor.user()?.isAdmin;
      },
      fn() {
        throw new Error("Only admins can delete posts");
      },
    },
  ],

  onRemoved: [
    {
      /* Only log removal of published posts */
      when(doc) {
        return doc.status === "published";
      },
      fn(doc) {
        logEvent("post_deleted", { postId: doc._id });
      },
    },
  ],
});
```

</details>

<details>
<summary>Cascading removals</summary>

```js
hook(Users, {
  beforeRemove: [
    {
      fn(usersToRemove) {
        const userIds = usersToRemove.map((u) => u._id);

        /* Prevent removal if user has published posts */
        const hasPublished = exists(Posts, {
          authorId: { $in: userIds },
          status: "published",
        });

        if (hasPublished) {
          throw new Error("Cannot delete users with published posts");
        }
      },
    },
  ],

  onRemoved: [
    {
      fn(user) {
        /* Clean up related data after user is removed.
         * See remove() for more details on how this integrates with hooks. */
        remove(Comments, { authorId: user._id });
      },
    },
  ],
});
```

</details>

The data mutation methods below use basically the same arguments as [Meteor collection methods](https://docs.meteor.com/api/collections.html#Mongo-Collection-updateAsync).

## `insert(Coll, doc)`

Insert a document into a collection. Returns the document \_id. Runs `beforeInsert` and `onInserted` hooks if defined.

```js
const newUser = insert(Users, {
  name: "Bob",
  email: "bob@example.com",
});
```

**Execution flow:**

1. Run `beforeInsert` hooks (can throw to prevent insertion)
2. Insert the document
3. Fire `onInserted` hooks asynchronously (without awaiting)

## `update(Coll, selector, modifier, options)`

Update documents matching the selector. Returns the number of documents modified. Runs `beforeUpdate` and `onUpdated` hooks if defined. Updates **multiple documents by default** (unlike Meteor's behavior).

```js
update(Users, { status: "pending" }, { $set: { status: "active" } });
```

**Execution flow:**

1. Fetch target documents with `beforeUpdate` and `onUpdated.before` fields
2. Run `beforeUpdate` hooks with `(docsToUpdate, modifier)` (can throw to prevent update)
3. Execute the update
4. Fetch updated documents again with `onUpdated` fields
5. Fire `onUpdated` hooks asynchronously with `(afterDoc, beforeDoc)` pairs

**Options:**

- `multi` (default: `true`): Update multiple documents or just the first match;
- `arrayFilters`: Optional. Used in combination with [MongoDB filtered positional operator](https://www.mongodb.com/docs/manual/reference/operator/update/positional-filtered/) to specify which elements to modify in an array field.

## `remove(Coll, selector)`

Remove documents matching the selector. Runs `beforeRemove` and `onRemoved` hooks if defined.

```js
remove(Users, { inactive: true });
```

**Execution flow:**

1. Fetch documents matching the selector with `beforeRemove` and `onRemoved` fields
2. Run `beforeRemove` hooks with matched documents (can throw to prevent removal)
3. Remove the documents
4. Fire `onRemoved` hooks asynchronously with each removed document

## `registerSoftRemove(Coll, options)`

Register soft-remove behavior for a collection. This is a startup-time registration step similar to joins/hooks registration.

`registerSoftRemove` defines which targeted documents should be kept when `softRemove` is called, and optionally how those kept documents should be updated.

```js
import { registerSoftRemove } from "coll-fns";

registerSoftRemove(Projects, {
  /* Optional. Fields fetched before evaluating keep predicates. */
  fields: { _id: 1, ownerId: 1, archived: 1 },

  /* Optional predicate. If true, the doc is kept. */
  when(project) {
    return project.archived;
  },

  /* Optional predicate by references.
   * Return [Coll, selector] pairs to test with exists(). */
  docToCollSelectorPairs(project) {
    return [
      [Tasks, { projectId: project._id, status: { $ne: "done" } }],
      [Invoices, { projectId: project._id }],
    ];
  },

  /* Optional default modifier applied to kept docs by softRemove(). */
  keepModifier: { $set: { archived: true, removedAt: new Date() } },
});
```

**Options**

- `fields`: fields to fetch before keep checks (merged with `_id` internally).
- `when(doc)`: optional predicate; truthy means keep.
- `docToCollSelectorPairs(doc)`: optional function returning `[[Coll, selector], ...]`; if any selector matches at least one doc, keep.
- `keepModifier`: optional default modifier used by `softRemove` for kept docs (can also be provided per call).

At least one of `when` or `docToCollSelectorPairs` must be provided.

## `softRemove(Coll, selector, keepModifier, options)`

Run a remove operation that can keep some matched documents (and optionally update those kept documents).

For backward compatibility, `selector` can be an identifier string. It is normalized to `{ _id: selector }` before any fetch, update or removal is delegated to the active protocol.

```js
import { softRemove } from "coll-fns";

/* Remove removable projects; archive the ones that must be kept. */
const result = await softRemove(
  Projects,
  { workspaceId },
  { $set: { archived: true, removedAt: new Date() } },
  { detailed: true }
);

// { removed: number, updated: number|null }
```

`keepModifier` can also be a function, including an async function. This is useful when the modifier must be built from runtime context.

```js
await softRemove(
  Posts,
  { _id: postId },
  () => ({
    $set: {
      removedAt: new Date(),
      removedBy: Meteor.userId(),
      status: "archived",
    },
  }),
  { detailed: true }
);
```

If no `keepModifier` is passed, the default one from `registerSoftRemove` is used.  
If neither is defined, kept docs are simply excluded from removal.

```js
/* Uses the registered default keepModifier */
await softRemove(Projects, { workspaceId });
```

**Execution flow**

1. Fetch docs targeted by `selector`.
2. Evaluate keep predicates per doc (`when` and/or `docToCollSelectorPairs`).
3. Remove docs not marked to keep.
4. If a keep modifier exists, update kept docs with it.

`softRemove` uses `coll-fns` `remove(...)` and `update(...)` internally.  
That means the usual hooks (`beforeRemove`/`onRemoved`, `beforeUpdate`/`onUpdated`) are still applied in the corresponding branch.

**Options**

- `detailed` (default `false`):
  - `false`: returns total affected count (`removed + updated`).
  - `true`: returns `{ removed, updated }`.

## `configurePool(options)`

After hooks can generate significant background work, especially when they trigger cascading writes and more after hooks.

`coll-fns` uses an internal execution pool for fire-and-forget after hooks.  
You can configure this pool at startup.

`configurePool` must be called **before any after hook is processed**.

### Default behavior

By default, the pool uses:

- `maxConcurrent: 10`
- `maxPending: 250`
- `onOverflow`: drop new call and warn in console

This prevents unbounded growth while allowing parallel processing.

### Options

```ts
configurePool({
  maxConcurrent?: number; // >= 1
  maxPending?: number | Infinity; // >= 0 or Infinity
  onOverflow?: "drop" | "shift" | (pendings, call) => reorderedPendings | void;
  onError?: (error, call) => void;
});
```

- `maxConcurrent`: maximum number of after hooks executed in parallel.
- `maxPending`: maximum number of queued hooks waiting for execution.
- `onOverflow`: policy to apply when pendings overflow
  - "drop": ignore the new call.
  - "shift": remove oldest pending call, enqueue the new one.
  - function: return a reordered/filtered pending list.
- `onError`: called when a pooled call fails. If omitted, errors are logged.

**Example**

```js
import { configurePool } from "coll-fns";

/* Must be called BEFORE any after hook is processed. */
configurePool({
  maxConcurrent: 20,
  maxPending: 1000,
  onOverflow: "shift",
  onError(error, call) {
    console.error("After-hook pool error:", error, call);
  },
});
```

**Notes**

- This configuration is **startup-only**. Calling configurePool after processing starts throws.
- If your workload is sensitive to ordering, keep maxConcurrent low or implement ordering constraints in your hook logic.
- Tune maxConcurrent/maxPending based on your app’s throughput and memory profile.

## Hook best practices

<details>
<summary><strong>Error handling</strong></summary>

**Before hooks** should throw errors to prevent operations:

```js
hook(Users, {
  beforeInsert: [
    {
      fn(doc) {
        if (!isValidEmail(doc.email)) {
          throw new Error("Invalid email");
        }
      },
    },
  ],
});
```

**After hooks** have a default error handler that logs to `console.error`. Define a custom `onError` handler if you need different behavior. Receives (err, hookDef) where hookDef is the hook definition enhanced with metadata, including `Coll`, `collName` and `hookType`.

```js
hook(Users, {
  onInserted: [
    {
      fn(doc) {
        /* ... */
      },
      onError(err, hookDef) {
        logToService(err, hookDef.collName);
      },
    },
  ],
});
```

</details>

<details>
<summary><strong>Field optimization</strong></summary>

Always declare which fields your hook needs with the `fields` property. This reduces database queries and improves performance:

```js
hook(Posts, {
  onUpdated: [
    {
      /* Only fetch these fields */
      fields: { authorId: 1, title: 1 },
      fn(afterPost, beforePost) {
        if (afterPost.title !== beforePost.title) {
          notifySubscribers(afterPost);
        }
      },
    },
  ],
});
```

</details>

<details>
<summary><strong>Conditional execution</strong></summary>

Use `when` and `unless` to avoid unnecessary side effects while keeping code clean and predictable:

```js
hook(Users, {
  onUpdated: [
    {
      fields: { status: 1 },
      /* Only run if status actually changed */
      unless(after, before) {
        return after.status === before.status;
      },
      fn(after, before) {
        sendStatusChangeEmail(after);
      },
    },
  ],
});
```

</details>

<details style="margin-bottom: 1rem">
<summary><strong>Async operations</strong></summary>

Hooks support both synchronous and asynchronous code. Returning a promise from a before-hook will delay the write operation:

```js
hook(Users, {
  beforeInsert: [
    {
      async fn(doc) {
        /* Wait for external service */
        doc.externalId = await createExternalUser(doc);
      },
    },
  ],
});
```

</details>
