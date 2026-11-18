A functional interface to **join MongoDB collections** and add **hooks before and after** insertions, updates and removals.

# Overview

Skip the repetitive glue code for joining collections and wiring related data. Define joins between collections once, then **fetch documents in the exact shape you need in a nested tree**. The data fetching is optimized to minimize database queries.

Stop repeating business logic all over your code base. Define hooks on collections that will be triggered conditionally **before or after insertions, updates or removals**: data validation, change propagation, logging, etc.

`coll-fns` provides:

- declarative one-to-one, one-to-many, nested and recursive joins;
- field selection and document transformation;
- hooks around insertions, updates and removals;
- soft removal and pooled hook processing;
- nested reactive publications for Meteor;
- synchronous and asynchronous Meteor protocols, plus the native MongoDB Node.js driver;
- a functional API that leaves collection instances untouched.

# Installation

```bash
npm install coll-fns
```

Define the database protocol before using the library:

```js
import { setProtocol, protocols } from "coll-fns";

setProtocol(protocols.meteorAsync);
```

In a Meteor application, the client usually uses the synchronous protocol while the server uses the asynchronous one:

```js
import { setProtocol, protocols } from "coll-fns";

const protocol = Meteor.isServer ? protocols.meteorAsync : protocols.meteorSync;
setProtocol(protocol);
```

The native MongoDB driver is supported through `protocols.node`. See [installation and protocol configuration](https://github.com/davidsavoie1/coll-fns/blob/main/docs/getting-started.md) for custom protocols and the full configuration reference.

# Quick start

```js
import { fetchList, join } from "coll-fns";
import { Comments, Posts, Users } from "/collections";

join(Posts, {
  author: {
    Coll: Users,
    on: ["authorId", "_id"],
    single: true,
  },
  comments: {
    Coll: Comments,
    on: ["_id", "postId"],
  },
});

const posts = fetchList(Posts, {}, {
  fields: {
    title: 1,
    author: { birthdate: 0 },
    comments: { text: 1 },
  },
});
```

Joined documents are returned directly in the requested nested shape:

```jsonc
[
  {
    "title": "Blabla",
    "authorId": "foo",
    "author": {
      "name": "Foo Bar",
      "genre": "non-fiction"
    },
    "comments": [{ "text": "Nice!" }, { "text": "Great!" }]
  }
]
```

# Documentation

- [Getting started and protocols](https://github.com/davidsavoie1/coll-fns/blob/main/docs/getting-started.md)
- [Rationale and design](https://github.com/davidsavoie1/coll-fns/blob/main/docs/rationale.md)
- [Joins and fetch operations](https://github.com/davidsavoie1/coll-fns/blob/main/docs/joins-and-fetch.md)
- [Hooks and write operations](https://github.com/davidsavoie1/coll-fns/blob/main/docs/hooks-and-write-operations.md)
- [Nested reactive publications](https://github.com/davidsavoie1/coll-fns/blob/main/docs/reactive-publications.md)
- [Changelog](https://github.com/davidsavoie1/coll-fns/blob/main/CHANGELOG.md)

The examples in the detailed documentation use the synchronous Meteor protocol for concision. Add `async`/`await` when using an asynchronous protocol.

# Bypassing `coll-fns`

`coll-fns` intentionally keeps collection instances untouched. To bypass its joins and hooks, use the collection's normal methods, such as `Coll.insert`, `Coll.find().fetchAsync()` or `Coll.removeOne()`.

# License

[MIT](https://github.com/davidsavoie1/coll-fns/blob/main/LICENSE)
