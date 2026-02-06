# AI Agent Instructions for coll-fns

## Architecture Overview

**coll-fns** is a functional library for MongoDB collection operations with advanced hook and join support. Three foundational patterns define the architecture:

### 1. Protocol Abstraction Pattern

- **File**: [src/protocol.js](/src/protocol.js)
- Database operations abstract via a swappable `Protocol` interface with methods: `count`, `findList`, `insert`, `update`, `remove`, `getName`, `getTransform`.
- Users call `setProtocol()` once at startup to register an adapter (e.g., `meteorAsync`, `node`).
- Built-in adapters in [src/protocols/](/src/protocols/) handle Meteor (sync/async) and Node.js.
- **Why**: Allows same codebase to work across runtime environments (Meteor client/server, Node.js) without conditional logic.

### 2. Registry Pattern

- Hooks and joins are stored in global `Map` registries keyed by collection instance:
  - [src/hook.js](/src/hook.js): `hooksRegistry` — per-collection hook arrays keyed by type.
  - [src/join.js](/src/join.js): `joinsDictionary` — per-collection join definitions keyed by name.
- Mutations (register/remove) update the same registry entry, enabling incremental registration across multiple calls.

### 3. Sync/Async Agnosticism

- The `then()` utility ([src/util.js](/src/util.js#L237-L255)) handles both sync operations (returns plain value) and async (returns Promise).
- Example: `then(maybePromise, fn)` awaits if needed, otherwise calls `fn` directly.
- **Why**: Allows identical code paths to work with sync Meteor methods and async Node.js protocols without branching.

## Write Operations & Hook Execution Flow

All write operations (`insert`, `update`, `remove`) follow a consistent lifecycle:

1. **Before Hook**: Validation/transformation (can throw to prevent write).
2. **Protocol Write**: Executes database mutation.
3. **After Hook (Fire-and-Forget)**: Asynchronous side effects; errors logged but never rethrown.

See [src/insert.js](/src/insert.js), [src/update.js](/src/update.js), [src/remove.js](/src/remove.js) for implementations.

- `beforeInsert(doc)` — validates/mutates doc before insertion.
- `beforeUpdate(docs, modifier)` — validates before update; receives pre-fetch docs.
- `beforeRemove(docs)` — validates before removal; receives docs to be removed.
- `onInserted(doc)`, `onUpdated(afterDoc, beforeDoc)`, `onRemoved(doc)` — side effects, never await.

## Joins System

Joins are globally registered, pre-defined relationships between collections. See [src/join.js](/src/join.js).

### Three Join Types (via the `on` property)

1. **Array Join**: `on: [fromProp, toProp, toSelector?]`
   - Equality-based: `parentDoc[fromProp] === childDoc[toProp]`
   - Array-valued fields use bracket notation: `["authorIds"]` means the field is an array
   - Optional `toSelector` adds extra filtering (e.g., `{ active: true }`)
   - **Example**: `on: ["_id", "postId"]` matches parent.\_id == child.postId

2. **Object Join**: `on: { active: true, archived: false }`
   - Static selector applied to all parent documents
   - Useful for fetching global config or a fixed set of related docs

3. **Function Join**: `on: (parentDoc) => ({ selector })`
   - Dynamic selector computed per parent document
   - **Critical**: If using function joins, declare `fields` property to ensure required linking keys are prefetched (otherwise they won't be available when the function runs)
   - Warning is emitted if `fields` is missing

### Join Definition Properties

- **Coll**: Target collection to join with (required)
- **on**: Relation descriptor — array, object, or function (required)
- **single**: Boolean (default false). If true, attach a single doc instead of an array
- **postFetch(joined, parentDoc)**: Optional transform function applied to joined value before attaching
- **fields**: Base collection fields needed when `on` is a function (required for safety)
- **limit**: Max documents per join (applies when `single=false`)
- **options**: Any extra options passed to the underlying fetch/find

### Join Usage in Fetches

- Joins are activated via the `fields` option when fetching
- If `joinPrefix` is set (e.g., `'+'`), join fields go under that prefix: `{ fields: { '+': { author: 1, comments: { text: 1 } } } }`
- If no prefix, join names are detected by matching against registered join definitions
- Nested field specs control which fields are fetched from joined collections (e.g., `{ author: { name: 1 } }` fetches only the author's name)
- Recursive joins are supported (same collection joined to itself) when depth is specified in fields

### Field Projection & Join Merging

- [src/fields.js](/src/fields.js): Merges field projections across multiple sources (hooks, joins).
  - `combineFields()` — union of field specs from `beforeUpdate`, `onUpdated`, and user-requested fields.
  - `dispatchFields()` — separates base collection fields from join fields (for nested projection).
  - `flattenFields()` — converts nested objects to MongoDB dot-notation when needed.

**Pattern**: When a hook requires certain fields, those are merged into prefetch queries so a single fetch provides all needed data.

## Key Code Patterns

### Type Guards & Validation

Use utility predicates from [src/util.js](/src/util.js):

- `isFunc(x)`, `isArr(x)`, `isObj(x)`, `isPromise(x)`, `isSelector(x)`, `isModifier(x)`.
- These are used throughout to validate arguments and handle different input types uniformly.

### Fire-and-Forget Error Handling

- `fireAndForget(fn, onError)` — wraps potentially async operations that should not throw to callers.
- Used in all after-hooks (`onInserted`, `onUpdated`, `onRemoved`).
- If `onError` is provided, errors are caught and logged; otherwise they're swallowed to prevent process crashes.

### Curried/Higher-Order Utilities

- `map(fn, x)` and `filter(pred, x)` in [src/util.js](/src/util.js#L271-L337) support both arrays and plain objects.
- Omitting the second argument returns a curried function (useful for composition).

### JSDoc Convention

All exports use comprehensive JSDoc with `@typedef`, `@param`, `@returns`, `@example` blocks. Type hints drive IDE autocompletion and serve as inline documentation.

## Fetch Optimization

[src/fetch.js](/src/fetch.js) includes:

- `fetchList()`, `fetchOne()`, `fetchIds()`, `exists()`, `count()` — all support nested field projections via joins.
- Field computations merge hook requirements automatically (no manual coordination needed).

## Common Development Tasks

### Defining Joins

1. Identify the relationship (one-to-one, one-to-many, many-to-many)
2. Choose join type based on relationship:
   - Static data → **object join**
   - ID-based references → **array join**
   - Complex logic → **function join** (with `fields` property)
3. Register in `join()` with complete `JoinDef` object
4. For function joins, always declare `fields` property to avoid missing data
5. Use `single: true` for one-to-one relationships only

### Working with Joins in Fetches

Example with `joinPrefix` enabled:

```js
setJoinPrefix("+");

// Fetch with nested join fields
const posts = await fetchList(
  Posts,
  {},
  {
    fields: {
      title: 1,
      "+": {
        author: { name: 1, email: 1 }, // One-to-one join
        comments: { text: 1, author_id: 1 }, // One-to-many join
      },
    },
  }
);
```

Result structure: `{ title, author: {...}, comments: [{...}, {...}] }`

If no `joinPrefix`, join names are auto-detected:

```js
// Without prefix - join names must match registered definitions
await fetchList(
  Posts,
  {},
  {
    fields: {
      title: 1,
      author: { name: 1 }, // Detected as join (registered in Posts)
      comments: { text: 1 }, // Detected as join
    },
  }
);
```

### Combining Hooks and Joins

Hooks can request fields via their `fields` property. These are merged with fetched fields, ensuring the hook gets what it needs without extra user coordination.

**Example**: `beforeUpdate` hook needs `authorId` to validate permissions, join needs it too — fetch happens once with both requirements merged.

### Adding Support for Function Joins

When defining a function join that depends on parent data:

```js
join(Users, {
  recentPosts: {
    Coll: Posts,
    // Function reads parent.authorId
    on: (user) => ({
      authorId: user._id,
      createdAt: { $gt: Date.now() - 86400000 },
    }),
    // MUST declare fields so linking keys are available
    fields: { _id: 1 },
  },
});
```

### Adding a New Hook Type

1. Add hook type to `HOOK_TYPES` array in [src/hook.js](/src/hook.js#L8-L22).
2. Decide if it's a "no-throw" type (fire-and-forget) or throws to caller.
3. Update write operation file (e.g., [src/update.js](/src/update.js)) to call `getHook()` and invoke at the right lifecycle phase.
4. Document in [README.md](/README.md) hook definition section.

### Adding Protocol Support

1. Create `src/protocols/myProtocol.js` exporting a Protocol object.
2. Implement required methods: `count`, `findList`, `insert`, `update`, `remove`.
3. Optional: `getName(Coll)` (for logging) and `getTransform(Coll)` (per-collection document transforms).
4. Users call `setProtocol(require('./protocols/myProtocol'))` at startup.

### Modifying Field Projection Logic

- Field merging happens in `combineFields()` [src/fields.js](/src/fields.js).
- Hook field requirements are gathered in write operation files (e.g., `getBeforeFields()` in [src/update.js](/src/update.js#L64-L86)).
- Test that merged projections correctly fetch linking keys (e.g., `authorId` when joining on it).

## Testing Considerations

- No test framework configured yet (see [package.json](/package.json)).
- Manual testing via REPL or example scripts recommended for now.
- Key areas to test: hook lifecycle against all three write operations, field merging edge cases, protocol swapping mid-execution.

## Build & Distribution

- **Build**: `npm run build` uses `microbundle` to generate ESM (`dist/coll-fns.mjs`) and CommonJS (`dist/coll-fns.cjs`).
- **Dev Watch**: `npm run dev` rebuilds on file changes.
- **Entry Point**: [src/index.js](/src/index.js) — all exports must be re-exported here.
