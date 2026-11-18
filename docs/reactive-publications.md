[← Documentation overview](../README.md#documentation)

# Nested reactive publications

If `coll-fns` is used in a Meteor project, using publications is a way to create fully reactive applications. `publish` function helps to publish complex hierarchical data.

## When to use `publish`

Use `publish()` when the publication tree is dynamic and cannot be represented as a simple static list of cursors.

**Important caveat (Meteor):** if a publication can return plain cursor(s) directly from `Meteor.publish`, prefer that approach. Native cursor-return publications are simpler and usually more optimized by Meteor internals than any userland helper.

`publish()` is intended for cases where you need one or more of:

- nested reactive children depending on parent documents
- selector recomputation based on changed parent fields
- observer reuse and invalidation logic you do not want to hand-roll repeatedly

## `publish(publication, Coll, selector, options)`

Create a reactive publication tree (Meteor-style) with support for:

- explicit child observers (`{ Coll, on, ... }`)
- join shorthand children (`{ join: "joinKey", ... }`)
- implicit join children derived from parent requested join fields
- a local join context (`ctx`) shared by the complete publication tree
- stateless field mappings applied before documents are sent to the client

`publish` internally uses protocol methods:

- `observe` to track cursor changes
- `getName` to emit DDP collection names
- `stringify` to build stable query reuse keys

As with normal joins, child `on` values can be:

- static selector objects
- functions `(parent, ...ancestors) => selector`
- join-array selectors: `[from, to, toSelector?]`

Refer to the [`join()`](joins-and-fetch.md#joincoll-joindefinitions) section for more details.

The same context accepted by `fetchList()` can be passed in publication options. It resolves joins and the join prefix at every level of the tree:

```js
await publish(this, Posts, selector, {
  ctx,
  fields: {
    "+": {
      author: {
        "+": {
          permissions: 1,
        },
      },
    },
  },
});
```

The root context always applies to every child observer.

```js
import { Meteor } from "meteor/meteor";
import { join, publish, setJoinPrefix } from "coll-fns";
import {
  Posts,
  Users,
  Comments,
  Tags,
  FeatureFlags,
  PostStats,
} from "/imports/api/collections";

setJoinPrefix("+");

join(Posts, {
  author: { Coll: Users, on: ["authorId", "_id"], single: true },
  comments: { Coll: Comments, on: ["_id", "postId"], sort: { createdAt: -1 } },
  stats: { Coll: PostStats, on: ["_id", "postId"], single: true },
});

join(Comments, {
  author: { Coll: Users, on: ["authorId", "_id"], single: true },
});

Meteor.publish("posts.tree", async function postsTree() {
  await publish(
    this,
    Posts,
    { status: "published" },
    {
      fields: {
        title: 1,
        authorId: 1,
        tagIds: 1,
        editorId: 1,
        "+": {
          stats: 1,
          comments: {
            body: 1,
            createdAt: 1,
            "+": {
              author: { displayName: 1 },
            },
          },
        },
      },
      children: [
        /* Predefined join on Posts collection */
        {
          join: "author",
          fields: { displayName: 1, avatarUrl: 1 },
        },

        /* Array selector */
        {
          Coll: Tags,
          on: [["tagIds"], "_id"],
          fields: { label: 1, color: 1 },
          deps: undefined, // Array selector children implicitely derive deps
        },

        /* Function selector */
        {
          Coll: Users,
          on: (post) => ({ _id: post.editorId }),
          fields: { displayName: 1 },
          deps: ["editorId"],
        },

        /* Object selector. Always returns the same data irrespective of parent. */
        {
          Coll: FeatureFlags,
          on: { scope: "posts_publication" },
          fields: { key: 1, enabled: 1 },
          deps: false,
        },
      ],
    }
  );
});
```

## Publication readiness and concurrency

Readiness is controlled per child with `awaited` (default: `true`):

- `awaited: true`: wait for this child and its awaited descendants before calling `ready()`
- `awaited: false`: do not wait for this child or any of its descendants; the complete branch loads/reacts in background

Use `awaited: true` for data the screen must have immediately, and `awaited: false` for optional or heavy branches.
If not specified, a child inherits `awaited` from its parent. Once a branch is detached with `awaited: false`, a descendant cannot make it contribute to the initial readiness phase again by setting `awaited: true`.

`awaited` only controls initial observer creation. Children created or reconciled after reactive changes always run in the active background pool because `ready()` has already been emitted.

`options.maxConcurrent` controls how many child observer creations can run at
the same time (`10` by default). This can only be defined at the publication root, not on children.

Why it matters:

- each parent `added`/`changed` can trigger many child observer creations
- unbounded concurrency can create CPU spikes and DB pressure
- too little concurrency can slow initial publication warm-up

What it controls exactly:

- only child observer creation tasks are throttled
- observer reuse still applies (duplicate query keys are collapsed)
- invalidation logic still runs; the option just smooths creation bursts

Practical guidance:

- decrease it if your publication causes heavy DB load or event-loop stalls
- increase it if your DB/runtime handles parallelism well and warm-up is slow
- keep in mind this is per `publish()` call, not a single global cap

Example:

```js
Meteor.publish("posts.tree", async function postsTree() {
  await publish(
    this,
    Posts,
    { status: "published" },
    {
      maxConcurrent: 5,
      children: [
        { Coll: Users, on: ["authorId", "_id"], awaited: true },
        {
          Coll: FeatureFlags,
          on: { scope: "posts_publication" },
          awaited: false,
        },
      ],
    }
  );
});
```

## Publication context (`this` in Meteor)

`publish()` is designed first for Meteor publications. In Meteor usage, the first
argument should be the publication session/context (`this`) received in
`Meteor.publish(name, function () { ... })`.

Because `coll-fns` uses Meteor's low-level `added`/`changed`/`removed` publication API, await its initialization without returning its resolved handle to Meteor. `publish()` calls `this.ready()` itself and registers its cleanup through `this.onStop()`:

```js
Meteor.publish("posts.tree", async function () {
  await publish(this, Posts, { status: "published" });
});
```

Avoid `return publish(...)` and `return await publish(...)`: on success, the promise resolves to an internal `{ stop }` handle, not to a cursor or an array of cursors as expected from a cursor-return publication. Initialization errors are sent through `this.error(error)`, which terminates the affected subscription without rethrowing into the publication handler.

Minimal expected shape of `publication`:

- `ready()` (required)
- `added(collectionName, id, fields)` (optional but normally provided by Meteor)
- `changed(collectionName, id, fields)` (optional but normally provided by Meteor)
- `removed(collectionName, id)` (optional but normally provided by Meteor)
- `onStop(fn)` (optional, used for cleanup registration)
- `error(err)` (optional, used as error sink)

Example:

```js
Meteor.publish("posts.tree", async function () {
  // `this` is the publication context/session.
  await publish(this, Posts, { status: "published" });
});
```

If `ready` is missing, `publish()` throws.

## How child declarations work

`children` entries can be objects or falsy values (`false`, `null`, `undefined`).
Falsy entries are ignored, which allows short-circuit declarations like
`isEnabled && { ...childArgs }`.

Object entries can be defined with either:

- explicit child args:
  - `{ Coll, on, fields?, mappings?, deps?, awaited?, children?, ...cursorOptions }`
- join shorthand:
  - `{ join: "joinKey", ...overrides }`

Additionally, join children can be derived implicitly from requested parent join fields.

Conflict rule:

- If the same join key is declared both as explicit child (`{ join: "..." }`) and in parent join fields (`fields["+"][joinKey]` or root join key without prefix), `publish()` throws and asks you to choose one style.

## Ancestors chain

For function selectors and function deps, the helper passes:

- first argument: direct parent document
- remaining arguments: full ancestors chain (grandparent, great-grandparent, ...)

This is useful when deep children must depend on context from higher levels.

```js
Meteor.publish("resources.tasks.actions", async function () {
  await publish(
    this,
    Resources,
    { archived: false },
    {
      children: [
        {
          Coll: Tasks,
          on: (resource) => ({ resourceId: resource._id }),
          deps: ["_id"],
          children: [
            {
              Coll: Actions,
              on: (task, resource) => ({
                taskId: task._id,
                tenantId: resource.tenantId,
              }),
              deps(changedFields, task, resource) {
                // Re-run when task link changes or resource tenancy changes.
                if ("tenantId" in changedFields) return true;
                return ["_id", "tenantId"];
              },
            },
          ],
        },
      ],
    }
  );
});
```

## How `deps` works

`deps` controls when child observers are invalidated and recomputed after parent `changed` events.

Supported values:

- `true`: always invalidate
- `false`: never invalidate
- `"field"` or `["fieldA", "fieldB"]`: invalidate only when those keys are present in changed fields
- `{ fieldA: 1, fieldB: true }`: object shorthand converted to watched keys (truthy top-level keys only)
- function `(changedFields, parent, ...ancestors) => depsLike`: dynamic rule returning any other supported `deps` value, synchronously or asynchronously
- `undefined`: special behavior

Special behavior when `deps` is `undefined`:

- static selector object child: treated as no invalidation (`[]`)
- function selector child: treated as potentially dependent and will always invalidate conservatively

The same meanings apply when a function returns a `deps` value:

- `true` always invalidates and `false` never invalidates
- a string, array, `Set` or object watches the corresponding changed fields
- `undefined` invalidates conservatively

For array selectors, implicit deps are auto-derived from the `from` key.

`deps` matching supports dot-notation paths without traversing the changed value:

- a top-level dependency matches its exact key in `changedFields`
- a dot-notation dependency matches either its exact key or its top-level root; for example, `root.leaf` looks for `root` in `changedFields`
- nested object deps only contribute top-level keys; use a dot-notation key when the precise path must also be included in the parent field projection.

The use of dot-notation deps is useful to limit nested fields to fetch, while staying consistent with the root level changed fields behaviour.

## Mapping published fields

The `mappings` option can reshape individual fields immediately before they are emitted to the client. Mappings are applied to both `added` and `changed` events without retaining copies of published documents.

A falsy `mappings` value means that mappings are not applicable, which allows conditional declarations such as `mappings: shouldMap && fieldMappings`.

Fields without a mapping are published unchanged. A mapping function transforms one field while preserving its name (1:1):

```js
publish(this, Documents, selector, {
  mappings: {
    title: (value) => value.trim(),
  },
});
```

An object mapping replaces its source field with one or more derived fields (1:n). Each output function receives the current value of the same source field:

```js
Meteor.publish("documents.private", async function () {
  const { userId } = this;

  await publish(this, Documents, selector, {
    fields: {
      title: 1,
      [`secretValuesByUserId.${userId}`]: 1,
    },
    mappings: {
      secretValuesByUserId: {
        secretValues: (values) => values?.[userId],
      },
    },
  });
});
```

The client receives `secretValues`, but never receives the source field `secretValuesByUserId`. An empty object mapping omits a source field without producing a replacement (1:0):

```js
mappings: {
  internalMetadata: {},
}
```

Mappings are synchronous and stateless. A mapped result can depend only on the current value of its source field; deriving a value from multiple document fields would not be reliable for incremental `changed` events. When a source is removed, its mapping receives `undefined`, allowing the output fields to be removed from the client as well.

Mapping definitions are validated when their observer is created. Producing the same output key from multiple mappings emits a warning. Avoid mapping to a name also published by an unmapped field, since the values would conflict.

Mappings affect only the fields sent through the publication callbacks. Joins, `deps`, selectors and child observers continue to use the original observed documents. Distinct mapping objects also receive distinct observer reuse keys so an observer cannot be reused with another representation.

## Debugging

`publish()` supports lightweight lifecycle debugging with:

- `debug: true` to log all internal debug events
- `debug: ["EVENT_NAME", ...]` to log selected events only
- `debug: { EVENT_NAME: true, ... }` to log selected events only

Observer events:

- `CREATED`: a new observer was successfully created and registered.
- `BYPASSED`: observer creation was skipped because selector resolved to a void selector.
- `REUSED`: an existing observer for the same query key was reused.
- `INVALIDATED`: child observer graph for a parent document was recomputed after relevant parent changes.
- `UNFOLLOWED`: one follower link to a sub-observer was removed.
- `CANCELLED`: an observer was cancelled and its local cleanup started.

Observer documents events:

- `DOC_ADDED`: a document was published through `added`.
- `DOC_CHANGED`: a published document emitted a `changed` update.
- `DOC_REMOVED`: a document was removed from publication (observer count for that document dropped to zero).

Publication events (available on root only):

- `READY`: emitted once when `publish()` calls `publication.ready()`.
- `STOPPED`: emitted once when the publication stop handler runs.

Debug scope:

- Root `debug` applies to the root observer and root publication locations (`READY`, `STOPPED`).
- Each child defines its own `debug` argument.
- Implicit join-derived children (from parent `fields`) inherit parent `debug`.

## Built-in optimizations

`publish()` is designed to stay controlled even with nested reactive trees.

In practical terms, it aims to protect you from:

- creating the same observer repeatedly for equivalent child queries
- runaway bursts of child observer creation
- stale async creations being attached after data already changed
- leaked child observers when parent links disappear
- duplicate add/remove churn for documents shared by multiple branches

Why this matters:

- lower risk of memory growth from forgotten/stale observers
- fewer unnecessary observers and DB watches
- more predictable behavior during frequent parent changes
- safer use of nested publications in real apps, not only toy examples

`maxConcurrent` is part of this safety model: it prevents uncontrolled parallel
creation bursts and lets you tune throughput vs load.

## Using `publish` outside Meteor

The helper can be used outside Meteor only if both layers are provided:

- protocol layer (`setProtocol`) supporting at least:
  - `observe`
  - `getName` (optional, default implementation provided)
  - `stringify` (optional, default implementation provided)
- publication transport/context object implementing the callbacks [listed above](#publication-context-this-in-meteor)
  (`added/changed/removed/ready/onStop/error`)

Protocol methods handle database reactivity.
`publication` handles how data changes are emitted to clients.

## Current limitations

- `publish()` is a helper, not a replacement for simple cursor-return publications.
- Deep/dynamic trees can still be expensive if selectors are broad and highly volatile.
- If `deps` are too broad (or omitted for dynamic selectors), invalidations may be frequent.
- For best results, keep parent selectors selective and declare precise `deps`.
- Multiple observers can contribute fields to the same `collection/_id`. If one stops following the document while another remains, fields contributed only by the first observer are not currently retracted independently. This limitation predates `mappings`; use compatible projections and mappings for overlapping observers.
