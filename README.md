# coll-fns

A universal collection manipulation library that provides a unified API for working with different database backends through a protocol-based architecture.

## Overview

`coll-fns` abstracts common database operations (CRUD, joins, field projections) behind a consistent interface, allowing you to write database-agnostic code that works across MongoDB, Meteor, and other data sources.

**Originally designed for Meteor**, `coll-fns` solves the challenge of writing isomorphic database code that works seamlessly on both client (synchronous) and server (asynchronous) with the exact same API.

## Key Features

- 🔗 **Powerful Join System**: Define relationships between collections with automatic field resolution and nested joins
- 🪝 **Extensible Hooks**: React to CRUD operations with before/after hooks for validation, transformation, and side effects
- 🌐 **Isomorphic by Design**: Write once, run anywhere - same API for client-side (sync) and server-side (async) code
- 🔌 **Protocol-based Architecture**: Switch between different database backends seamlessly
- 📊 **Advanced Field Projections**: Support for nested fields, dot notation, and MongoDB-style projections
- 🔄 **Promise/async Support**: Works with both synchronous and asynchronous protocols
- 📝 **TypeScript-ready**: Includes JSDoc types for better IDE support

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
```

## Joins: The Power Feature

One of the most powerful features of `coll-fns` is its ability to define declarative joins between collections, eliminating the need for manual data fetching and aggregation.

### Basic Join Example

```js
const posts = await fetchList(
  PostsCollection,
  {},
  {
    joins: {
      author: {
        coll: UsersCollection,
        on: ["authorId", "_id"], // [local field, foreign field]
        fields: { name: 1, avatar: 1, email: 1 },
      },
    },
    fields: {
      title: 1,
      content: 1,
      "+": { author: 1 }, // Use '+' prefix to include join fields
    },
  }
);

// Result: Each post includes an 'author' object with name, avatar, and email
```

### One-to-Many Joins

```js
const posts = await fetchList(
  PostsCollection,
  {},
  {
    joins: {
      comments: {
        coll: CommentsCollection,
        on: ["_id", "postId"],
        many: true, // Returns an array of related documents
        fields: { text: 1, createdAt: 1 },
      },
    },
    fields: {
      title: 1,
      "+": { comments: 1 },
    },
  }
);

// Result: Each post includes a 'comments' array
```

### Nested Joins

Joins can be nested to fetch deeply related data:

```js
const posts = await fetchList(
  PostsCollection,
  {},
  {
    joins: {
      author: {
        coll: UsersCollection,
        on: ["authorId", "_id"],
        fields: { name: 1, avatar: 1 },
      },
      comments: {
        coll: CommentsCollection,
        on: ["_id", "postId"],
        many: true,
        fields: { text: 1, "+": { user: 1 } },
        joins: {
          user: {
            coll: UsersCollection,
            on: ["userId", "_id"],
            fields: { name: 1, avatar: 1 },
          },
        },
      },
    },
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
const users = await fetchList(
  UsersCollection,
  {},
  {
    joins: {
      friends: {
        coll: UsersCollection,
        on: ["friendIds", "_id"],
        many: true,
        fields: { name: 1, "+": { friends: 1 } },
        joins: {
          friends: {
            coll: UsersCollection,
            on: ["friendIds", "_id"],
            many: true,
          },
        },
      },
    },
    fields: {
      name: 1,
      "+": { friends: 2 }, // Limit to 2 levels deep
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
import { setProtocol, protocols } from "coll-fns";

setProtocol(protocols.meteorSync);

// Same API, synchronous execution
const posts = fetchList(
  PostsCollection,
  {},
  {
    joins: {
      author: {
        coll: UsersCollection,
        on: ["authorId", "_id"],
      },
    },
    fields: { title: 1, "+": { author: 1 } },
  }
);
```

### Shared Code

```js
// imports/api/posts.js
import { fetchList } from "coll-fns";

// This function works on both client and server!
export function getPostsWithAuthors() {
  return fetchList(
    PostsCollection,
    {},
    {
      joins: {
        author: {
          coll: UsersCollection,
          on: ["authorId", "_id"],
          fields: { name: 1, avatar: 1 },
        },
      },
      fields: { title: 1, content: 1, "+": { author: 1 } },
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
- `joins`: Join definitions for related collections

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
