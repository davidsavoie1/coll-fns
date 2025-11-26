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
import { setProtocol, fetch, insert, update, remove, count } from "coll-fns";
import nodeProtocol from "coll-fns/protocols/node";

// Set up your protocol
setProtocol(nodeProtocol(mongoClient));

// Use the API
const users = await fetch(UsersCollection, { age: { $gte: 18 } });
await insert(UsersCollection, { name: "Alice", age: 25 });
await update(UsersCollection, { name: "Alice" }, { $set: { age: 26 } });
const total = await count(UsersCollection, {});
await remove(UsersCollection, { name: "Alice" });
```

## Joins: The Power Feature

One of the most powerful features of `coll-fns` is its ability to define declarative joins between collections, eliminating the need for manual data fetching and aggregation.

### Basic Join Example

```js
const posts = await fetch(
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
  },
);

// Result: Each post includes an 'author' object with name, avatar, and email
```

### One-to-Many Joins

```js
const posts = await fetch(
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
  },
);

// Result: Each post includes a 'comments' array
```

### Nested Joins

Joins can be nested to fetch deeply related data:

```js
const posts = await fetch(
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
  },
);

// Result: Posts with author details and comments, each comment with user details
```

### Recursive Join Depth Control

Control the depth of recursive joins to prevent infinite loops:

```js
const users = await fetch(
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
  },
);
```

## Hooks: Extensibility Made Easy

Hooks allow you to react to CRUD operations, enabling validation, transformation, logging, and side effects without modifying your core business logic.

### Setting Up Hooks

```js
import { addHook } from "coll-fns";

// Before insert hook - validation and transformation
addHook(UsersCollection, "insert", "before", (doc) => {
  if (!doc.email) {
    throw new Error("Email is required");
  }
  // Transform data
  doc.email = doc.email.toLowerCase();
  doc.createdAt = new Date();
  return doc;
});

// After insert hook - side effects
addHook(UsersCollection, "insert", "after", (doc) => {
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
addHook(PostsCollection, "update", "before", (selector, modifier, options) => {
  const currentUserId = getCurrentUserId();
  const post = fetch(PostsCollection, selector)[0];

  if (post.authorId !== currentUserId) {
    throw new Error("Unauthorized");
  }

  return [selector, modifier, options];
});
```

#### Automatic Timestamps

```js
// Add timestamps automatically
addHook(PostsCollection, "insert", "before", (doc) => {
  doc.createdAt = new Date();
  doc.updatedAt = new Date();
  return doc;
});

addHook(PostsCollection, "update", "before", (selector, modifier, options) => {
  if (!modifier.$set) modifier.$set = {};
  modifier.$set.updatedAt = new Date();
  return [selector, modifier, options];
});
```

#### Audit Logging

```js
// Log all changes
addHook(PostsCollection, "update", "after", (result, selector, modifier) => {
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
addHook(UsersCollection, "update", "after", (result, selector, modifier) => {
  const userId = selector._id;
  const userName = modifier.$set?.name;

  if (userName) {
    // Update user name in all their posts
    update(
      PostsCollection,
      { authorId: userId },
      { $set: { authorName: userName } },
      { multi: true },
    );
  }
});
```

## Meteor Integration: Isomorphic by Design

`coll-fns` was specifically designed to solve Meteor's challenge of writing code that works both on the client (synchronous MiniMongo) and server (asynchronous MongoDB) with the same API.

### Server-Side (Async)

```js
// server/main.js
import { setProtocol } from "coll-fns";
import meteorAsync from "coll-fns/protocols/meteorAsync";

setProtocol(meteorAsync);

// Methods automatically work with async
Meteor.methods({
  async createPost(title, content) {
    const user = await fetch(UsersCollection, { _id: this.userId });
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
import { setProtocol } from "coll-fns";
import meteorSync from "coll-fns/protocols/meteorSync";

setProtocol(meteorSync);

// Same API, synchronous execution
const posts = fetch(
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
  },
);
```

### Shared Code

```js
// imports/api/posts.js
import { fetch } from "coll-fns";

// This function works on both client and server!
export function getPostsWithAuthors() {
  return fetch(
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
    },
  );
}
```

## API Reference

### Core Functions

#### `fetch(collection, selector, options)`

Fetch documents from a collection.

```js
const users = await fetch(
  UsersCollection,
  { status: "active" },
  {
    fields: { name: 1, email: 1 },
    sort: { createdAt: -1 },
    limit: 10,
    skip: 0,
  },
);
```

**Options:**

- `fields`: Field projection object
- `sort`: Sort specification
- `limit`: Maximum number of documents
- `skip`: Number of documents to skip
- `joins`: Join definitions for related collections

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
  { multi: true },
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

#### `addHook(collection, operation, timing, fn)`

Add a hook to a collection operation.

```js
addHook(UsersCollection, "insert", "before", (doc) => {
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
import { setProtocol } from "coll-fns";
import meteorAsync from "coll-fns/protocols/meteorAsync";

setProtocol(meteorAsync);
```

#### `getProtocol()`

Get the current active protocol.

```js
const currentProtocol = getProtocol();
```

### Field Projections

#### Nested Fields

```js
// Nested object notation
const users = await fetch(
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
  },
);

// Dot notation (MongoDB-style)
const users = await fetch(
  UsersCollection,
  {},
  {
    fields: {
      name: 1,
      "address.street": 1,
      "address.city": 1,
    },
  },
);
```

#### Combining Fields

```js
import { combineFields } from "coll-fns";

const combined = combineFields({ name: 1, email: 1 }, { email: 1, phone: 1 });
// Result: { name: 1, email: 1, phone: 1 }
```

## Available Protocols

### Node.js (MongoDB)

```js
import nodeProtocol from "coll-fns/protocols/node";
import { MongoClient } from "mongodb";

const client = new MongoClient(url);
setProtocol(nodeProtocol(client));
```

### Meteor (Synchronous)

```js
import meteorSync from "coll-fns/protocols/meteorSync";
setProtocol(meteorSync);
```

### Meteor (Asynchronous)

```js
import meteorAsync from "coll-fns/protocols/meteorAsync";
setProtocol(meteorAsync);
```

## Utility Functions

The library provides several utility functions:

- `then(value, fn)`: Handle both sync and async values
- `isObj(value)`: Check if value is a plain object
- `filter(predicate, obj)`: Filter object entries
- `mapValues(fn, obj)`: Map over object values

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

### Recursive Field Management

```js
import { decrementRecursiveField } from "coll-fns";

// Useful for limiting nested join depth
const fields = { "+": { author: 2, comments: 1 } };
const decremented = decrementRecursiveField("author", fields);
// Result: { '+': { author: 1, comments: 1 } }
```

## Project Structure

```
src/
├── count.js          - Count operation
├── fetch.js          - Fetch operation with joins support
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
    ├── meteorAsync.js
    ├── meteorSync.js
    └── node.js
```

## License

MIT
