A functional interface to **join MongoDB collections** and add **hooks before and after** insertions, updates and removals.

# Overview

Skip the repetitive glue code for joining collections and wiring related data. Define joins between collections once, then **fetch documents in the exact shape you need in a nested tree**. The data fetching is optimized to minimize database queries.

Stop repeating business logic all over your code base. Define hooks on collections that will be triggered conditionally **before or after insertions, updates or removals**: data validation, change propagation, logging, etc.

# Table of contents

- [Overview](#overview)
- [Table of contents](#table-of-contents)
- [Rationale](#rationale)
- [Installation and configuration](#installation-and-configuration)
  - [`setProtocol(protocol)`](#setprotocolprotocol)
  - [Bypassing `coll-fns`](#bypassing-coll-fns)
- [Joins and fetch](#joins-and-fetch)
  - [Quick start examples](#quick-start-examples)
  - [`join(Coll, joinDefinitions)`](#joincoll-joindefinitions)
    - [Simple array join](#simple-array-join)
    - [Sub-array joins](#sub-array-joins)
    - [Filtered array-joins](#filtered-array-joins)
    - [Object joins](#object-joins)
    - [Function joins](#function-joins)
    - [Recursive joins](#recursive-joins)
    - [Join additional options](#join-additional-options)
    - [`postFetch`](#postfetch)
    - [`getJoins`](#getjoins)
  - [`fetchList(Coll, selector, options)`](#fetchlistcoll-selector-options)
    - [`fields` option and joins](#fields-option-and-joins)
      - [Examples](#examples)
    - [`setJoinPrefix(prefix)`](#setjoinprefixprefix)
    - [Nested Joins](#nested-joins)
    - [Recursion levels](#recursion-levels)
    - [Documents transformation](#documents-transformation)
  - [`fetchOne(Coll, selector, options)`](#fetchonecoll-selector-options)
  - [`fetchIds(Coll, selector, options)`](#fetchidscoll-selector-options)
  - [`exists(Coll, selector)`](#existscoll-selector)
  - [`count(Coll, selector)`](#countcoll-selector)
  - [`flattenFields(fields)`](#flattenfieldsfields)
- [Hooks and write operations](#hooks-and-write-operations)
  - [`hook(Coll, hooksObj)`](#hookcoll-hooksobj)
    - [Before hooks](#before-hooks)
    - [After hooks](#after-hooks)
    - [Hook definition properties](#hook-definition-properties)
    - [Examples](#examples-1)
  - [`insert(Coll, doc)`](#insertcoll-doc)
  - [`update(Coll, selector, modifier, options)`](#updatecoll-selector-modifier-options)
  - [`remove(Coll, selector)`](#removecoll-selector)
  - [`setHooksBuffer(buffer)`](#sethooksbufferbuffer)
  - [Hook best practices](#hook-best-practices)
- [License](#license)

# Rationale

Click on any element to unfold it and better understand the rationale behind this library!

<details>
<summary><strong>Data normalization</strong></summary>

While document databases with eventual consistency such as MongoDB are quite powerful, they often encourage denormalization patterns where information from one document must be copied on related documents. If everything goes well, one should be able to limit data fetching to self-contained documents only... (yeah, right).

This pattern adds much unwelcome complexity:

- the fields to denormalize must be determined in advance
- adding functionalities that would require new related fields means more denormalization and migration scripts
- the denormalized data must be kept in sync (somehow)
- denormalization can fail halfway through, leading to an incoherent state

I designed this library as a Meteor developer. I was hence _forced_ to use MongoDB documents database instead of a normalized database. Yet, I wanted to join collections so I could

- **keep data in only one place** (where it made most sense)
- **retrieve documents easily in an intuitive shape**.

Joins allow to do so. They are declared in advance between collections, defining how different types of documents relate to each other in a single place, instead of repeating this logic each time when querying the data. Data fetching knows about them and allows **arbitrary depth relationships** where documents are returned as **simple nested tree-shaped documents** without the need for helpers, methods or other complex structures... It's just data!

And joins can be defined in code shared by both server and client (I _hate_ redundant code 😒).

</details>

<details>
<summary><strong>DRY business logic</strong></summary>

Although joins between collections reduce the need for denormalization, it is often essential to update related documents based on what happens to another one (cascading removals, for example).

Reacting to data changes to propagate the information on the wire through API calls is also quite frequent. As is the need for final validation before commiting a change.

So how should we go about it? Should this code be incorporated in each mutation path? Should we create custom functions to update a specific type of document so all these side-effects are executed? If so, how do we not forget to use these functions instead of the normal collection methods? And how do we reduce the amount of boilerplate code that will simply handle the mechanics of data manipulation?

**Hooks** were introduced to solve these issues. The are defined in advance on each collection to **intercept or react to insertions, updates and removals**.

Even better, they can be defined so they fire only if certain conditions are met! And they can be **defined in many places**, making it much easier to group hooks by area of concern, instead of spreading their logic all over the place.

Focussing on the business logic, describing it only once, wasting no time on boilerplate code, that's a time (and sanity) saver for sure! 🤪

</details>

<details>
<summary><strong>Protocol implementations</strong></summary>

I also faced a challenge when **migrating from Meteor 2.0 to 3.0**, which rendered isomorphic code cumbersome (same code running on the server and the client).

On the server, the new Meteor architecture now required the use of promises and async/await constructs.

On the client, data fetching with Minimongo must be synchronous in most frameworks to avoid complicated front-end code to handle promises.

I wanted a tool that would help me **keep the isomorphic query capabilities** while eliminating redundant glue code.

By designing the library with a protocol architecture, the same code can be run with a different database implementation.

On the client, I use a synchronous Minimongo implementation.

On the server, while still on Meteor 2.0, I also used a synchronous implementation that worked fine with Fibers. When I got ready to move to async/await and Meteor 3.0, I simply switched to an async protocol implementation without so much refactoring!

(Of course, the code had to be refactored to actually use `coll-fns`, but it comes with so much powerful features that it would have been a go-to anyway!)

And since it uses a protocol, it can be used with the **native MongoDB driver** too (built-in) and could even be adapted to almost any type of database... 🤯

</details>

<details style="margin-bottom: 1rem">
<summary><strong>Functional API</strong></summary>

A lot of libraries that add functionalities to the database layer mutate the collection instances themselves or, when more respectful, offer ways to extend the collection constructor somehow.

In either case, it can lead to potential issues where different enhancement libraries conflict with each other. Method names might change, data might be saved in added fields on the collection instances (is `_joins` _really_ safe to use?)...

`coll-fns`, as the name implies, offers a **functional API**. Instead of doing `Collection.insert(doc)`, you would `insert(Collection, doc)`. I know... Moving the left parenthesis and replacing the dot with a comma is a lot to ask 😉, but it comes with benefits!

Instead of mutating the collections themselves, **joins and hooks definitions are saved in a global registry**. No collection instance is harmed (mutated) in the process. You could have a fancy custom collection wrapped and distorted by many different libraries; `coll-fns` won't add a thing to it.

Doing so makes it easy to offer a protocol interface: **the type of collection involved doesn't matter at all**. Heck, the collections could even be table names as strings and it would still work (if you implement a custom protocol)!

For Meteor developers, it also means being able to enhance the `Meteor.users` collection itself... event without access to instantiation code! 🤓

</details>

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

  /* Insert a document in a collection
   * and return the inserted _id. */
  insert(/* Coll, doc, options */) {},

  /* Remove documents in a collection
   * and return the number of removed documents. */
  remove(/* Coll, selector, options */) {},

  /* Update documents in a collection
   * and return the number of modified documents. */
  update(/* Coll, selector, modifier, options */) {},
};

setProtocol(customProtocol);
```

</details>

## Bypassing `coll-fns`

`coll-fns` intentionally keeps collection instances untouched. It doesn't add any methods nor change exsting ones' behaviour. To bypass any `coll-fns` functionality, simply **use the normal collection methods** (ex: `Coll.insert`, `Coll.find().fetchAsync()`, `Coll.removeOne()`). Joins and hooks will only get fired when using the library's functions... and if joins and hooks have been pre-defined, of course! 😉

# Joins and fetch

## Quick start examples

```js
import { fetchList, join } from "coll-fns";
import { Comments, Posts, Users } from "/collections";

/* Define joins on Posts collection */
join(Posts, {
  /* One-to-one join */
  author: {
    Coll: Users,
    on: ["authorId", "_id"],
    single: true,
  },

  /* One-to-many join */
  comments: {
    Coll: Comments,
    on: ["_id", "postId"],
    /* `single` defaults to false,
     * so joined docs are returned as an array */
  },
});

/* Fetch data with nested joined documents in the requested shape. */
fetchList(
  Posts,
  {},
  {
    fields: {
      title: 1, // <= Own
      author: { birthdate: 0 }, // <= Falsy = anything but these fields
      comments: { text: 1 },
    },
  }
);
```

```jsonc
[
  {
    "title": "Blabla",
    "authorId": "foo", // <= Included by join definition
    "author": {
      "name": "Foo Bar",
      "genre": "non-fiction",
    },
    /* Comments is a one-to-many join, so is returned as a list */
    "comments": [{ "text": "Nice!" }, { "text": "Great!" }],
  },
]
```

## `join(Coll, joinDefinitions)`

Collections can be joined together with **globally pre-registered joins** to greatly simplify optimized data fetching.

Joins are **not symmetrical by default**. Each collection should define its own relationships.

```js
import { join } from "coll-fns";

join(
  /* Parent collection */
  Coll,

  /* Map of joins on children collections.
   * Each key is the name of the field
   * where joined docs will be placed. */
  {
    joinProp1: {
      /* joinDefinition */
    },

    joinProp2: {
      /* joinDefinition */
    },
  }
);
```

Collections can define **as many joins as needed** without impacting performance. They will be used only when explicitly fetched. They can be **declared in different places** (as long as join names don't collide).

In the context of Meteor, joins could (should?) be **defined in shared client and server code**, but some might only ever be used in one environement or the other. They could also define a set of common joins, but add others in environment specific code.

By default, joins link one document from the parent collection to multiple ones from the child collection. In the case of a **one-to-one relationship**, the `single` property should be set to true.

There are three main types of join definitions based on the argument to the `on` property: **array**, **object** and **function** joins.

### Simple array join

`on` can be defined as an array of `[parentProp, childProp]` equality.

```js
import { join } from "coll-fns";
import { Comments, Posts, Users } from "/collections";

join(Posts, {
  author: {
    Coll: Users,
    /* `post.authorId === user._id` */
    on: ["authorId", "_id"],
    /* Single doc instead of a list */
    single: true,
  },

  comments: {
    Coll: Comments,
    /* `post._id === comment.postId` */
    on: ["_id", "postId"],
  },
});

/* Reversed join from user to posts */
join(Users, {
  posts: {
    Coll: Posts,
    on: ["_id", "authorId"],
  },
});
```

### Sub-array joins

Sometimes, the property referencing linked documents is an array (of ids, usually). In that case, the name of the array property should be nested in an array.

```js
import { join } from "coll-fns";
import { Actions, Resources } from "/collections";

/* Each action can be associated with many resources and vice-versa.
 * Resource's `actionIds` array is the link between them. */
join(Actions, {
  resources: {
    Coll: Resources,
    on: ["_id", ["actionIds"]],
  },
});

/* The reverse join will flip the property names. */
join(Resources, {
  actions: {
    Coll: Actions,
    on: [["actionIds"], "_id"],
  },
});
```

### Filtered array-joins

Some joins should target only specific documents in the foreign collection. A complementary selector can be passed to the third `on` array argument.

```js
import { join } from "coll-fns";
import { Actions, Resources } from "/collections";

join(Resources, {
  /* Only active tasks (third array element is a selector) */
  activeTasks: {
    Coll: Tasks,
    on: ["_id", "resourceId", { active: true }],
  },

  /* All tasks associated with a resource */
  tasks: {
    Coll: Tasks,
    on: ["_id", "resourceId"],
  },
});
```

### Object joins

The `on` join definition property can be an object representing a selector. It will always retrieve the same linked documents.

```js
import { join } from "coll-fns";
import { Factory, Workers } from "../collections";

join(Workers, {
  /* All workers will have the same `factory` props. */
  factory: {
    Coll: Factory,
    on: { name: "FACTORY ABC" },
    single: true,
  },
});
```

### Function joins

When joins are too complex to be defined with an array or object (although rare), a function can be used as the `on` property. Each parent document will be passed to this function, which should return a selector to use on the child collection.

When using function-based joins, **a `fields` property should be added** to the join definition to declare which fields the parent document needs for the join to work:

```js
import { join } from "coll-fns";
import { Comments, Posts } from "/collections";
import { twoMonthsPrior } from "/lib/dates";

join(Posts, {
  recentComments: {
    Coll: Comments,
    on: (post) => {
      const { _id: postId, postedAt } = post;

      /* This argument must be defined at runtime. */
      const minDate = twoMonthsPrior(postedAt);

      /* Return a selector for the Comments collection */
      return {
        createdAt: { $gte: minDate },
        postId,
      };
    },
    /* Parent fields needed in the join function */
    fields: {
      _id: 1, // Optional. _id is implicit in any fetch.
      postedAt: 1,
    },
  },
});
```

### Recursive joins

A collection can define joins on itself.

```js
import { join } from "coll-fns";
import { Users } from "/collections";

join(Users, {
  friends: {
    /* Use the same collection in the join definition */
    Coll: Users,
    on: [["friendIds"], "_id"],
  },
});
```

### Join additional options

Any additional properties defined on the join (other than `Coll`, `on`, `single`, `postFetch`) will be treated as options to pass to the nested documents `fetchList`. It usually includes:

- `limit`: Maximum joined documents count
- `skip`: Documents to skip in the fetch
- `sort`: Sort order of joined documents

### `postFetch`

Children documents might need to be modified (transformed, ordered, filtered...) after being fetched. The `postFetch: (childrenDocs, parentDoc) => childrenDocs` join definition property can be used to do so.

The second argument of the function is the parent document. If some of its properties are needed, they should be declared in the `fields` property to ensure they are not missing from the requested fetched fields.

```js
import { join } from "coll-fns";
import { Actions, Resources } from "/collections";
import { sortTasks } from "/lib/tasks";

join(Resources, {
  tasks: {
    Coll: Tasks,
    on: ["_id", "resourceId"],

    /* Ensure `tasksOrder` will be fetched */
    fields: { tasksOrder: 1 },

    /* Transform the joined tasks documents based on parent resource. */
    postFetch(tasks, resource) {
      const { tasksOrder = [] } = resource;
      return sortTasks(tasks, tasksOrder);
    },
  },
});
```

### `getJoins`

Use `getJoins(Coll)` to retrieve the complete dictionary of the collection's joins.

## `fetchList(Coll, selector, options)`

Fetch documents with the ability to **use collection joins**.

**Options:**

- `fields`: Field projection object
- `limit`: Maximum number of documents
- `skip`: Number of documents to skip
- `sort`: Sort specification

In its simplest form, `fetchList` can be used in much the same way as Meteor's `Coll.find(...args).fetch()`.

```js
const users = await fetchList(
  Users,
  { status: "active" },
  {
    fields: { name: 1, email: 1 },
    sort: { createdAt: -1 },
    limit: 10,
    skip: 0,
  }
);
```

### `fields` option and joins

Contrary to regular projection objects, they can use nested properties `{ car: { make: 1 } }` instead of dot-string ones `{ car: 1, "car.make": 1 }`.

The joins defined on the collections must be **explicitly specified in the `fields`** object for the children documents to be fetched. The combined presence of join or own fields determines the shape of the fetched documents.

#### Examples

<details>
<summary>Join definitions for examples</summary>

```js
import { fetchList, join } from "coll-fns";
import { Comments, Posts, Users } from "/collections";

/* Define joins on Posts collection */
join(Posts, {
  /* One-to-one join */
  author: {
    Coll: Users,
    on: ["authorId", "_id"],
    single: true,
  },

  /* One-to-many join */
  comments: {
    Coll: Comments,
    on: ["_id", "postId"],
    /* `single` defaults to false,
     * so joined docs are returned as an array */
  },
});
```

</details>

<details>
<summary>Undefined (all) own fields</summary>

```js
fetchList(Posts, {});
```

```json
[{ "title": "Blabla", "authorId": "foo", "likes": 7 }]
```

</details>

<details>
<summary>Some own fields</summary>

```js
fetchList(
  Posts,
  {},
  {
    fields: {
      title: true, // <= Own. Any truthy value works
    },
  }
);
```

```json
[{ "title": "Blabla" }]
```

</details>

<details>
<summary>Undefined (all) own fields, truthy (all) join fields</summary>

```js
fetchList(
  Posts,
  {},
  {
    fields: {
      author: 1, // <= Join
    },
  }
);
```

```jsonc
[
  {
    "title": "Blabla",
    "authorId": "foo",
    "likes": 7,
    "author": {
      "name": "Foo Bar",
      "birthdate": "Some Date",
      "genre": "non-fiction",
    },
  },
]
```

</details>

<details>
<summary>Some own fields, truthy (all) join fields</summary>

```js
fetchList(
  Posts,
  {},
  {
    fields: {
      title: 1, // <= Own
      author: 1, // <= Join
    },
  }
);
```

```jsonc
[
  {
    "title": "Blabla",
    "authorId": "foo", // <= Included by join definition
    "author": {
      "name": "Foo Bar",
      "birthdate": "Some Date",
      "genre": "non-fiction",
    },
  },
]
```

</details>

<details>
<summary>Some own fields, some join fields</summary>

```js
fetchList(
  Posts,
  {},
  {
    fields: {
      title: 1, // <= Own
      author: { birthdate: 0 }, // <= Falsy = anything but these fields
      comments: { text: 1 },
    },
  }
);
```

```jsonc
[
  {
    "title": "Blabla",
    "authorId": "foo", // <= Included by join definition
    "author": {
      "name": "Foo Bar",
      "genre": "non-fiction",
    },
    /* Comments is a one-to-many join, so is returned as a list */
    "comments": [{ "text": "Nice!" }, { "text": "Great!" }],
  },
]
```

</details>

### `setJoinPrefix(prefix)`

If this combination approach seems confusing, it is possible to define a prefix that must be explicitly used when joined documents should be used. **The prefix will be removed** from the returned documents.

Setting the prefix to null or undefined allows using join fields at the document root like any normal field.

```js
import { setJoinPrefix } from "coll-fns";

/* All join fields will have to be prefixed with "+" */
setJoinPrefix("+");

/* Some own fields, some join fields */
fetchList(
  Posts,
  {},
  {
    fields: {
      title: 1, // <= Own

      /* Join fields must be nested under the prefix key */
      "+": {
        author: { name: 1, birthdate: 1 }, // <= Join sub fields
      },
    },
  }
);
```

This option could also be useful if a document can have some denormalized data with the same property name as the join. The denormalized values or the joined document would then be returned based on the use of the prefix.

If, for some reason, you need to retrieve the prefix, you can do so with `getJoinPrefix(Coll)`.

### Nested Joins

Joins can be nested to fetch deeply related data. See [Hooks best practices](#hook-best-practices) for how hooks can be used with nested joins.

```js
import { fetchList } from "coll-fns";

const posts = fetchList(
  Posts,
  {},
  {
    fields: {
      title: 1,

      /* Level 1 : One-to-many join */
      comments: {
        text: 1,

        /* Level 2 : One-to-one join */
        user: {
          username: 1,
        },
      },
    },
  }
);
```

```json
{
    "title": "Blabla",
    "comments": [
      { "text": "Nice!", "user": { "username": "foo"} },
      { "text": "Great!", "user": { "username": "bar" } }
    ]
  },
```

### Recursion levels

When a field is declared using a positive number, its value is treated as a recursion limit. This could help preventing infinite loops. The value `Infinity` can even be used to go as deep as possible (to exhaustion), although it involves a greater risk of infinite loops.

```js
import { join } from "coll-fns";
import { Users } from "/collections";

/* Pre-register recursive join */
join(Users, {
  friends: {
    Coll: Users,
    on: [["friendIds"], "_id"],
  },
});

fetchList(
  Users,
  {},
  {
    fields: {
      name: 1,
      /* Join field. Limit to 2 levels deep, reusing parent fields */
      friends: 2,
    },
  }
);
```

### Documents transformation

Documents can be transformed after fetching. Collection-level transforms are automatically applied if the protocol allows it:

**Meteor:**

```js
import { Mongo } from "meteor/mongo";

const Users = new Mongo.Collection("users", {
  transform: (doc) => ({
    ...doc,
    fullName: `${doc.firstName} ${doc.lastName}`,
  }),
});
```

**For a specific fetch**, pass a `transform` option:

```js
const users = await fetchList(
  Users,
  { status: "active" },
  {
    transform: (doc) => ({
      ...doc,
      fullName: `${doc.firstName} ${doc.lastName}`,
    }),
  }
);
```

To skip a collection's transform, pass `transform: null`. Transforms are applied **after joins resolve**, so they have access to joined data. See [Nested Joins](#nested-joins) for examples of using transforms with complex data structures.

## `fetchOne(Coll, selector, options)`

Fetch a single document from a collection. Same behaviour as `fetchList`.

```js
import { fetchOne } from "coll-fns";
import { Users } from "/collections";

const user = fetchOne(
  Users,
  { _id: userId },
  {
    fields: {
      name: 1,
      friends: 1, // <= Join
    },
  }
);
```

## `fetchIds(Coll, selector, options)`

Fetch only the `_id` field of matching documents. `fields` option will be ignored.

```js
import { fetchOne } from "coll-fns";
import { Users } from "/collections";

const userIds = fetchIds(Users, { status: "active" });
```

## `exists(Coll, selector)`

Check if any document matches the selector.

```js
import { fetchOne } from "coll-fns";
import { Users } from "/collections";

const hasActiveUsers = exists(Users, { status: "active" });
// Returns: true or false
```

## `count(Coll, selector)`

Count documents matching the selector.

```js
import { fetchOne } from "coll-fns";
import { Users } from "/collections";

const activeUsersCount = count(UsersCollection, { status: "active" });
// Returns an integer
```

## `flattenFields(fields)`

Flatten a general field specifiers object (which could include nested objects) into a MongoDB-compatible one that uses dot-notation.

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

  /* Optional. Synchronous predicate that prevents the hook from running if it
   * returns a truthy value. Receives the same arguments as fn. */
  unless(doc) { return doc.isBot; },

  /* Optional. Synchronous predicate that allows the hook to run only if it
   * returns a truthy value. Receives the same arguments as fn. */
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

## `setHooksBuffer(buffer)`

After hooks, altough useful, can generate heavy background work, especially since they could spawn cascading hooks themselves.

An `async-rivers` river is used internally to process the fire-and-forget side-effects of after hooks. By default, it uses a fixed buffer of size 10 (number of hook calls that can be processed simultaneously) and capped to 250 pending ones. If this cap is reached, the `onOverflow` policy is triggered, which throws an error in the default configuration.

This conservative setting is meant to **prevent unbounded growth of after hooks** while indicating potential memory leaks in `coll-fns` usage. When that happens, you can consider:

1. **Refactoring** to reduce the processing involved in these hooks
2. **Configuring a buffer** for the hooks river to fit your needs

`async-rivers` buffers (dropping, fixed or sliding) are exposed on the main export. See the library's documentation.

`setHooksBuffer` must be called at startup **before any insert/update/remove operation triggers an after hook**.

```js
import { fixedBuffer, setHooksBuffer } from "coll-fns";

/* Must be called BEFORE any after hook is processed. */
const customBuffer = fixedBuffer(15, { maxPending: 1000, onOverflow: "slide" });
setHooksBuffer(customBuffer);
```

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

# License

MIT
