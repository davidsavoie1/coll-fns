A functionnal interface to **join MongoDB collections** and add **hooks before and after** insertions, updates and removals.

# Overview

Skip the repetitive glue code for joining collections and wiring related data. Define joins between collections once, then **fetch documents in the exact shape you need in a nested tree**. The data fetching is optimized to minimize database queries.

Stop repeating business logic all over your code base. Define hooks on collections that will be triggered conditionally **before or after insertions, updates or removals**: data validation, change propagation, logging, etc.

# Table of contents

- [Overview](#overview)
- [Table of contents](#table-of-contents)
- [Rationale](#rationale)
- [Installation and configuration](#installation-and-configuration)
  - [`setProtocol(protocol)`](#setprotocolprotocol)
- [Joins and fetch](#joins-and-fetch)
  - [Quick start examples](#quick-start-examples)
  - [`join(Coll, joinDefinitions)`](#joincoll-joindefinitions)
    - [Simple array join](#simple-array-join)
    - [Sub-array joins](#sub-array-joins)
    - [Filtered array-joins](#filtered-array-joins)
    - [Object joins](#object-joins)
    - [Function joins](#function-joins)
    - [Recursive joins](#recursive-joins)
    - [`postFetch`](#postfetch)
    - [`getJoins`](#getjoins)
  - [`fetchList(Coll, selector, options)`](#fetchlistcoll-selector-options)
    - [`fields` option and joins](#fields-option-and-joins)
      - [Examples](#examples)
    - [`setJoinPrefix(prefix)`](#setjoinprefixprefix)
    - [Nested Joins](#nested-joins)
    - [Recursion levels](#recursion-levels)
  - [`fetchOne(Coll, selector, options)`](#fetchonecoll-selector-options)
  - [`fetchIds(collection, selector, options)`](#fetchidscollection-selector-options)
  - [`exists(collection, selector)`](#existscollection-selector)
  - [`count(collection, selector)`](#countcollection-selector)
  - [`flattenFields(fields)`](#flattenfieldsfields)
  - [`insert(Coll, doc)`](#insertcoll-doc)
  - [`update(Coll, selector, modifier, options)`](#updatecoll-selector-modifier-options)
  - [`remove(Coll, selector)`](#removecoll-selector)
- [Hooks and write operations](#hooks-and-write-operations)
- [License](#license)

# Rationale

Click on any element to unfold it and better understand the rationale behind this library!

<details>
<summary><strong>Data normalization</strong></summary>

While document databases with eventual consistency such as MongoDB are quite powerful, they often encourage denormalization patterns where information from one document must be copied on related documents. If everything goes well, one should be able to limit data fetching to self-contained documents only... (yeah, right).

This pattern adds much unwelcome complexity:

- the fields to denormalize must be determined in advance
- adding functionnalities that would require new related fields means more denormalization and migration scripts
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

A lot of libraries that add functionnalities to the database layer mutate the collection instances themselves or, when more respectful, offer ways to extend the collection constructor somehow.

In either case, it can lead to potential issues where different enhancement libraries conflict with each other. Method names might change, data might be saved in added fields on the collection instances (is `_joins` _really_ safe to use?)...

`coll-fns`, as the name implies, offers a **functionnal API**. Instead of doing `Collection.insert(doc)`, you would `insert(Collection, doc)`. I know... Moving the left parenthese and replacing the dot with a comma is a lot to ask 😉, but it comes with benefits!

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

You will have to **define which protocol to use** before using any of the library's functionnaly.

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
setProtocol(protocols.meteorAsync);
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

Collections can define **as many joins as needed** without impacting performance. They will be used only when explicitely fetched. They can be **declared in different places** (as long as join names don't collide).

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
import { Actions, Ressources } from "/collections";

/* Each action can be associated with many ressources and vice-versa.
 * Ressource's `actionIds` array is the link between them. */
join(Actions, {
  ressources: {
    Coll: Ressources,
    on: ["_id", ["actionIds"]],
  },
});

/* The reverse join will flip the property names. */
join(Ressources, {
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
import { Actions, Ressources } from "/collections";

join(Ressources, {
  /* Only active tasks (third array element is a selector) */
  activeTasks: {
    Coll: Tasks,
    on: ["_id", "ressourceId", { active: true }],
  },

  /* All tasks associated with a ressource */
  tasks: {
    Coll: Tasks,
    on: ["_id", "ressourceId"],
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

### `postFetch`

Children documents might need to be modified (transformed, ordered, filtered...) after being fetched. The `postFetch: (childrenDocs, parentDoc) => childrenDocs` join definition property can be used to do so.

The second argument of the function is the parent document. If some of its properties are needed, they should be declared in the `fields` property to ensure they are not missing from the requested fetched fields.

```js
import { join } from "coll-fns";
import { Actions, Ressources } from "/collections";
import { sortTasks } from "/lib/tasks";

join(Ressources, {
  tasks: {
    Coll: Tasks,
    on: ["_id", "ressourceId"],

    /* Ensure `tasksOrder` will be fetched */
    fields: { tasksOrder: 1 },

    /* Transform the joined tasks documents based on parent ressource. */
    postFetch(tasks, ressource) {
      const { tasksOrder = [] } = ressource;
      return sortTasks(tasks, tasksOrder);
    },
  },
});
```

### `getJoins`

Use `getJoins(Coll)` to retrieve the complete dictionnary of the collection's joins.

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

The joins defined on the collections must be **explicitely specified in the `fields`** object for the children documents to be fetched. The combined presence of join or own fields determines the shape of the fetched documents.

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

If this combination approach seems confusing, it is possible to define a prefix that must be explicitely used when joined documents should be used. **The prefix will be removed** from the returned documents.

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

Joins can be nested to fetch deeply related data.

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

## `fetchIds(collection, selector, options)`

Fetch only the `_id` field of matching documents.

```js
import { fetchOne } from "coll-fns";
import { Users } from "/collections";

const userIds = fetchIds(Users, { status: "active" });
```

## `exists(collection, selector)`

Check if any document matches the selector.

```js
import { fetchOne } from "coll-fns";
import { Users } from "/collections";

const hasActiveUsers = exists(Users, { status: "active" });
// Returns: true or false
```

## `count(collection, selector)`

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

## `insert(Coll, doc)`

Insert a document into a collection. Returns the document \_id;

```js
const newUser = await insert(Users, {
  name: "Bob",
  email: "bob@example.com",
});
```

## `update(Coll, selector, modifier, options)`

Update documents matching the selector. Returns the number of documents modified. Updates multiples documents by default (contrary to the default Meteor behaviour).

```js
update(
  Users,
  { status: "pending" },
  { $set: { status: "active" } },
  { multi: true }
);
```

## `remove(Coll, selector)`

Remove documents matching the selector.

```js
remove(Users, { inactive: true });
```

# Hooks and write operations

TODO

# License

MIT
