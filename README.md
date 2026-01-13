# coll-fns

Work with MongoDB collections using declarative joins and reusable hooks—fetch related docs without boilerplate and keep cross-collection logic in one place.

## Overview

Skip the repetitive glue code for joining collections and wiring related data. Define your relationships once, then ask for only the fields you need in a nested tree at query time. You keep flexibility (less denormalization needed) while still fetching children efficiently—often better than ad-hoc code copied across endpoints.

Hooks let you centralize cross-collection side effects and validations (e.g., propagate changes, enforce rules) so you don't repeat that logic in every mutation path.

**Works identically on Meteor server (async) and client (sync)** with the same code, and supports any MongoDB-compatible backend you plug in.

## Key Features

- **Powerful Join System**: Define relationships between collections with automatic field resolution and nested joins
- **Extensible Hooks**: React to CRUD operations with before/after hooks for validation, transformation, and side effects
- **Isomorphic by Design**: Write once, run anywhere - same API for client-side (sync) and server-side (async) code
- **Protocol-based Architecture**: Switch between different database backends seamlessly
- **Advanced Field Projections**: Support for nested fields, dot notation, and MongoDB-style projections
- **Promise/async Support**: Works with both synchronous and asynchronous protocols
- **TypeScript-ready**: Includes JSDoc types for better IDE support

## Installation

```bash
npm install coll-fns
```

## Quick Start

```js
import {
  setProtocol,
  fetchList,
  insert,
  update,
  remove,
  count,
  join,
  protocols,
} from "coll-fns";

// Set up your protocol
setProtocol(protocols.node(mongoClient));

// Use the API
const users = await fetchList(UsersCollection, { age: { $gte: 18 } });
await insert(UsersCollection, { name: "Alice", age: 25 });
await update(UsersCollection, { name: "Alice" }, { $set: { age: 26 } });
const total = await count(UsersCollection, {});
await remove(UsersCollection, { name: "Alice" });

// Define a join to fetch authors with posts
join(PostsCollection, {
  author: {
    Coll: UsersCollection,
    on: ["authorId", "_id"],
    single: true,
  },
});

// Use the join in a fetch
const posts = await fetchList(
  PostsCollection,
  {},
  {
    fields: {
      title: 1,
      content: 1,
      "+": { author: 1 },
    },
  }
);
// Result: Each post includes its author's name and email
```

## Joins: The Power Feature

One of the most powerful features of `coll-fns` is its ability to define declarative joins between collections, eliminating the need for manual data fetching and aggregation.

Joins must be **pre-registered globally** for a collection using the `join()` function. Once defined, they're available for all fetch operations on that collection.

### Defining and Using Joins

Register joins once (typically during initialization) and reference them in fetch calls:

```js
import { join, fetchList } from "coll-fns";

// Define joins globally for a collection (usually in initialization code)
join(PostsCollection, {
  author: {
    Coll: UsersCollection,
    on: ["authorId", "_id"],
    single: true,
  },
  comments: {
    Coll: CommentsCollection,
    on: ["_id", "postId"],
  },
});

// Now use fetch without re-specifying the join definitions
const posts = await fetchList(
  PostsCollection,
  { status: "published" },
  {
    fields: {
      title: 1,
      content: 1,
      "+": { author: 1, comments: 1 }, // Reference pre-defined joins
    },
  }
);

// Result: Each post includes author and comments as defined
```

**Note on `fields` in join definitions:** The optional `fields` property within a join definition specifies which fields of the _joined_ collection to include. It's particularly useful when using function-based joins (where `on` is a function) because the parent document may not have all required linking keys fetched by default. For simple array-based joins, `fields` is optional — omit it to fetch all fields from the joined collection.

### Basic Join Example

```js
const posts = await fetchList(
  PostsCollection,
  {},
  {
    fields: {
      title: 1,
      content: 1,
      "+": { author: 1 }, // Use '+' prefix to include join fields
    },
  }
);

// Result: Each post includes an 'author' object with name, avatar, and email
// (assuming 'author' was pre-registered via join(PostsCollection, { author: { ... } }))
```

### One-to-Many Joins

```js
import { join, fetchList } from "coll-fns";

// Pre-register the join
join(PostsCollection, {
  comments: {
    Coll: CommentsCollection,
    on: ["_id", "postId"],
    // Note: 'single' defaults to false, so joined docs are returned as an array
    fields: { text: 1, createdAt: 1 },
  },
});

// Use in fetch
const posts = await fetchList(
  PostsCollection,
  {},
  {
    fields: {
      title: 1,
      "+": { comments: 1 },
    },
  }
);

// Result: Each post includes a 'comments' array
```

### Nested Joins

Joins can be nested to fetch deeply related data. Register all joins upfront:

```js
import { join, fetchList } from "coll-fns";

// Pre-register joins for PostsCollection
join(PostsCollection, {
  author: {
    Coll: UsersCollection,
    on: ["authorId", "_id"],
    single: true,
    fields: { name: 1, avatar: 1 },
  },
  comments: {
    Coll: CommentsCollection,
    on: ["_id", "postId"],
    fields: { text: 1, "+": { user: 1 } },
  },
});

// Pre-register joins for CommentsCollection
join(CommentsCollection, {
  user: {
    Coll: UsersCollection,
    on: ["userId", "_id"],
    single: true,
    fields: { name: 1, avatar: 1 },
  },
});

// Use in fetch - nested joins are resolved automatically
const posts = await fetchList(
  PostsCollection,
  {},
  {
    fields: {
      title: 1,
      content: 1,
      "+": { author: 1, comments: 1 },
    },
  }
);

// Result: Posts with author details and comments, each comment with user details
```

### Recursive Join Depth Control

Control the depth of recursive joins to prevent infinite loops:

```js
import { join, fetchList } from "coll-fns";

// Pre-register recursive join
join(UsersCollection, {
  friends: {
    Coll: UsersCollection,
    on: ["friendIds", "_id"],
  },
});

// Use in fetch - specify depth in fields with '+' prefix
const users = await fetchList(
  UsersCollection,
  {},
  {
    fields: {
      name: 1,
      "+": { friends: 2 }, // Limit to 2 levels deep
    },
  }
);
```

### Function-Based Joins with `fields`

When using function-based joins (where `on` is a function), the `fields` property declares which fields the parent document needs for the join to work:

```js
import { join, fetchList } from "coll-fns";

// Join comments where the parent doc's userId field is used to compute the selector
join(PostsCollection, {
  userComments: {
    Coll: CommentsCollection,
    // Function form: receives parent doc, returns selector for joined collection
    on: (post) => ({ userId: post.userId, postId: post._id }),
    // Declare which parent fields are required for the join function
    fields: { userId: 1 },
  },
});

// Use in fetch
const posts = await fetchList(
  PostsCollection,
  {},
  {
    fields: {
      title: 1,
      "+": { userComments: 1 },
    },
  }
);
```

## Hooks: Extensibility Made Easy

Hooks allow you to react to CRUD operations, enabling validation, transformation, logging, and side effects without modifying your core business logic.

### Setting Up Hooks

```js
import { hook } from "coll-fns";

// Before insert hook - validation and transformation
hook(UsersCollection, "insert", "before", (doc) => {
  if (!doc.email) {
    throw new Error("Email is required");
  }
  // Transform data
  doc.email = doc.email.toLowerCase();
  doc.createdAt = new Date();
  return doc;
});

// After insert hook - side effects
hook(UsersCollection, "insert", "after", (doc) => {
  console.log(`New user created: ${doc.name}`);
  // Send welcome email, update analytics, etc.
  sendWelcomeEmail(doc.email);
});
```

### Available Hook Types

Hooks can be attached to any CRUD operation:

- **`insert`**: Before/after document insertion
- **`update`**: Before/after document updates
- **`remove`**: Before/after document removal
- **`fetch`**: Before/after fetching documents (useful for filtering)

### Hook Examples

#### Validation and Authorization

```js
// Prevent unauthorized updates
hook(PostsCollection, "update", "before", (selector, modifier, options) => {
  const currentUserId = getCurrentUserId();
  const post = fetchList(PostsCollection, selector)[0];

  if (post.authorId !== currentUserId) {
    throw new Error("Unauthorized");
  }

  return [selector, modifier, options];
});
```

#### Automatic Timestamps

```js
// Add timestamps automatically
hook(PostsCollection, "insert", "before", (doc) => {
  doc.createdAt = new Date();
  doc.updatedAt = new Date();
  return doc;
});

hook(PostsCollection, "update", "before", (selector, modifier, options) => {
  if (!modifier.$set) modifier.$set = {};
  modifier.$set.updatedAt = new Date();
  return [selector, modifier, options];
});
```

#### Audit Logging

```js
// Log all changes
hook(PostsCollection, "update", "after", (result, selector, modifier) => {
  logToAuditTrail({
    collection: "posts",
    action: "update",
    selector,
    modifier,
    timestamp: new Date(),
    userId: getCurrentUserId(),
  });
});
```

#### Data Denormalization

```js
// Update denormalized data
hook(UsersCollection, "update", "after", (result, selector, modifier) => {
  const userId = selector._id;
  const userName = modifier.$set?.name;

  if (userName) {
    // Update user name in all their posts
    update(
      PostsCollection,
      { authorId: userId },
      { $set: { authorName: userName } },
      { multi: true }
    );
  }
});
```

## Error Handling

`coll-fns` provides multiple mechanisms for handling errors in database operations and validations.

### Throwing Errors in Hooks

Hooks can throw errors to prevent operations from completing. This is useful for validation, authorization checks, and data integrity:

```js
import { hook } from "coll-fns";

// Prevent invalid operations by throwing in before hooks
hook(UsersCollection, "insert", "before", (doc) => {
  if (!doc.email || !doc.email.includes("@")) {
    throw new Error("Invalid email format");
  }
  return doc;
});

// Usage
try {
  await insert(UsersCollection, { name: "John", email: "invalid" });
} catch (error) {
  console.error("Insert failed:", error.message);
  // Output: Insert failed: Invalid email format
}
```

### Async/Await Error Handling

All operations support both sync and async protocols. Use standard try/catch for async operations:

```js
import { fetchList, update, remove } from "coll-fns";

async function safeUpdatePosts() {
  try {
    const posts = await fetchList(PostsCollection, { status: "draft" });
    console.log(`Found ${posts.length} draft posts`);

    for (const post of posts) {
      await update(
        PostsCollection,
        { _id: post._id },
        { $set: { status: "published" } }
      );
    }
  } catch (error) {
    console.error("Update operation failed:", error);
    // Handle database error, network issue, validation error, etc.
  }
}
```

### Join Validation Errors

Joins are validated when registered globally. Invalid join definitions throw errors immediately:

```js
import { join } from "coll-fns";

try {
  // Missing required 'Coll' property
  join(PostsCollection, {
    author: {
      on: ["authorId", "_id"], // Error: Missing Coll
    },
  });
} catch (error) {
  console.error(error.message);
  // Output: Collection 'Coll' for 'author' join is required.
}

try {
  // Missing required 'on' condition
  join(PostsCollection, {
    comments: {
      Coll: CommentsCollection,
      // Error: Missing on
    },
  });
} catch (error) {
  console.error(error.message);
  // Output: Join 'comments' has no 'on' condition specified.
}
```

### Authorization in Hooks

Use hooks to enforce authorization rules and throw errors for unauthorized operations:

```js
hook(PostsCollection, "update", "before", (selector, modifier, options) => {
  const currentUserId = getCurrentUserId();
  const [post] = fetchOne(PostsCollection, selector);

  if (!post) {
    throw new Error("Post not found");
  }

  if (post.authorId !== currentUserId) {
    throw new Error("Unauthorized: You can only edit your own posts");
  }

  return [selector, modifier, options];
});

// Usage
try {
  await update(
    PostsCollection,
    { _id: "123" },
    { $set: { title: "New Title" } }
  );
} catch (error) {
  if (error.message.includes("Unauthorized")) {
    // Handle authorization error
  } else if (error.message === "Post not found") {
    // Handle not found error
  }
}
```

### Handling Join Fetch Errors

When joins fail during fetch operations, errors propagate through the promise chain:

```js
import { join, fetchList } from "coll-fns";

// Pre-register the join
join(PostsCollection, {
  author: {
    Coll: UsersCollection,
    on: ["authorId", "_id"],
    single: true,
  },
});

// Use in fetch
try {
  const posts = await fetchList(
    PostsCollection,
    {},
    {
      fields: { title: 1, "+": { author: 1 } },
    }
  );
} catch (error) {
  console.error("Failed to fetch posts with authors:", error);
  // Errors from nested joins are propagated here
}
```

### Protocol-Level Error Handling

When a protocol method is not implemented, `coll-fns` throws a descriptive error:

```js
import { setProtocol, fetchList } from "coll-fns";

// Using incomplete protocol
setProtocol({
  // Missing required methods
});

try {
  await fetchList(SomeCollection, {});
} catch (error) {
  console.error(error.message);
  // Output: 'findList' method must be defined with 'setProtocol'.
}
```

## Meteor Integration: Isomorphic by Design

`coll-fns` was specifically designed to solve Meteor's challenge of writing code that works both on the client (synchronous) and server (asynchronous) with the same API.

### Server-Side (Async)

```js
// server/main.js
import { setProtocol, protocols } from "coll-fns";

setProtocol(protocols.meteorAsync);

// Methods automatically work with async
Meteor.methods({
  async createPost(title, content) {
    const user = await fetchOne(UsersCollection, { _id: this.userId });
    return await insert(PostsCollection, {
      title,
      content,
      authorId: this.userId,
    });
  },
});
```

### Client-Side (Sync)

```js
// client/main.js
import { setProtocol, protocols, join } from "coll-fns";

setProtocol(protocols.meteorSync);

// Pre-register joins (same as server)
join(PostsCollection, {
  author: {
    Coll: UsersCollection,
    on: ["authorId", "_id"],
    single: true,
  },
});

// Same API, synchronous execution
const posts = fetchList(
  PostsCollection,
  {},
  { fields: { title: 1, "+": { author: 1 } } }
);
```

### Shared Code

```js
// imports/api/posts.js
import { join, fetchList } from "coll-fns";

// Pre-register joins once
join(PostsCollection, {
  author: {
    Coll: UsersCollection,
    on: ["authorId", "_id"],
    single: true,
    fields: { name: 1, avatar: 1 },
  },
});

// This function works on both client and server!
export function getPostsWithAuthors() {
  return fetchList(
    PostsCollection,
    {},
    {
      fields: {
        title: 1,
        content: 1,
        "+": { author: 1 },
      },
    }
  );
}
```

## API Reference

### Core Functions

#### `fetchList(collection, selector, options)`

Fetch an array of documents from a collection.

```js
const users = await fetchList(
  UsersCollection,
  { status: "active" },
  {
    fields: { name: 1, email: 1 },
    sort: { createdAt: -1 },
    limit: 10,
    skip: 0,
  }
);
```

**Options:**

- `fields`: Field projection object
- `sort`: Sort specification
- `limit`: Maximum number of documents
- `skip`: Number of documents to skip

#### `fetchOne(collection, selector, options)`

Fetch a single document from a collection.

```js
const user = await fetchOne(
  UsersCollection,
  { _id: userId },
  {
    fields: { name: 1, email: 1 },
  }
);
```

#### `fetchIds(collection, selector, options)`

Fetch only the `_id` field of matching documents.

```js
const userIds = await fetchIds(UsersCollection, { status: "active" });
// Returns: ['id1', 'id2', 'id3']
```

#### `exists(collection, selector)`

Check if any documents match the selector.

```js
const hasActiveUsers = await exists(UsersCollection, { status: "active" });
// Returns: true or false
```

#### `insert(collection, doc)`

Insert a document into a collection.

```js
const newUser = await insert(UsersCollection, {
  name: "Bob",
  email: "bob@example.com",
});
```

#### `update(collection, selector, modifier, options)`

Update documents matching the selector.

```js
await update(
  UsersCollection,
  { status: "pending" },
  { $set: { status: "active" } },
  { multi: true }
);
```

#### `remove(collection, selector)`

Remove documents matching the selector.

```js
await remove(UsersCollection, { inactive: true });
```

#### `count(collection, selector)`

Count documents matching the selector.

```js
const activeUsers = await count(UsersCollection, { status: "active" });
```

### Hook Functions

#### `hook(collection, operation, timing, fn)`

Add a hook to a collection operation.

```js
hook(UsersCollection, "insert", "before", (doc) => {
  // Modify or validate doc
  return doc;
});
```

**Parameters:**

- `collection`: The collection to hook into
- `operation`: `'insert'`, `'update'`, `'remove'`, or `'fetch'`
- `timing`: `'before'` or `'after'`
- `fn`: Hook function (return value depends on operation and timing)

### Protocol Management

#### `setProtocol(protocol)`

Set the active database protocol.

```js
import { setProtocol, protocols } from "coll-fns";

setProtocol(protocols.meteorAsync);
```

#### `getProtocol()`

Get the current active protocol.

```js
const currentProtocol = getProtocol();
```

#### `updateProtocol(updates)`

Update specific methods of the current protocol.

```js
import { updateProtocol } from "coll-fns";

updateProtocol({
  fetch: customFetchImplementation,
});
```

### Field Projections

#### Nested Fields

```js
// Nested object notation
const users = await fetchList(
  UsersCollection,
  {},
  {
    fields: {
      name: 1,
      address: {
        street: 1,
        city: 1,
      },
    },
  }
);

// Dot notation (MongoDB-style)
const users = await fetchList(
  UsersCollection,
  {},
  {
    fields: {
      name: 1,
      "address.street": 1,
      "address.city": 1,
    },
  }
);
```

#### Flattening Fields

```js
import { flattenFields } from "coll-fns";

const flattened = flattenFields({
  name: 1,
  address: {
    street: 1,
    city: 1,
  },
});
// Result: { name: 1, 'address.street': 1, 'address.city': 1 }
```

## Available Protocols

All protocols are available through the `protocols` namespace:

```js
import { protocols } from "coll-fns";
```

### Node.js (MongoDB)

```js
import { setProtocol, protocols } from "coll-fns";
import { MongoClient } from "mongodb";

const client = new MongoClient(url);
await client.connect();
setProtocol(protocols.node(client));
```

### Meteor (Synchronous)

```js
import { setProtocol, protocols } from "coll-fns";

setProtocol(protocols.meteorSync);
```

### Meteor (Asynchronous)

```js
import { setProtocol, protocols } from "coll-fns";

setProtocol(protocols.meteorAsync);
```

## Advanced Usage

### Custom Protocols

Create your own protocol by implementing the required methods:

```js
const customProtocol = {
  fetch: (coll, selector, options) => {
    /* ... */
  },
  insert: (coll, doc) => {
    /* ... */
  },
  update: (coll, selector, modifier, options) => {
    /* ... */
  },
  remove: (coll, selector) => {
    /* ... */
  },
  count: (coll, selector) => {
    /* ... */
  },
};

setProtocol(customProtocol);
```

### Join Management

#### Setting Custom Join Prefix

By default, join fields are prefixed with `+`. You can customize this:

```js
import { setJoinPrefix } from "coll-fns";

setJoinPrefix("joins"); // Now use { joins: { author: 1 } } instead of { '+': { author: 1 } }
```

If join prefix is set to a falsy value, join fields can be declared at the document root like any native field.

```js
import { setJoinPrefix } from "coll-fns";

setJoinPrefix(null); // Now use { author: 1 } instead of { '+': { author: 1 } }
```

#### Getting Join Configuration

```js
import { getJoins, getJoinPrefix } from "coll-fns";

const joins = getJoins(fields); // Extract join definitions from fields
const prefix = getJoinPrefix(); // Get current join prefix (default: '+')
```

## Project Structure

```
src/
├── count.js          - Count operation
├── fetch.js          - Fetch operations (fetchList, fetchOne, fetchIds, exists)
├── fields.js         - Field projection utilities
├── hook.js           - Hook system for extending operations
├── index.js          - Main exports
├── insert.js         - Insert operation
├── join.js           - Join functionality
├── protocol.js       - Protocol management
├── remove.js         - Remove operation
├── update.js         - Update operation
├── util.js           - Utility functions
└── protocols/        - Database protocol implementations
    ├── index.js
    ├── meteorAsync.js
    ├── meteorSync.js
    └── node.js
```

## License

MIT
