[← Documentation overview](../README.md#documentation)

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

Calling `join(Coll, null)` disables all joins on a collection. A falsy entry can also disable a single join, which is especially useful in a local join context:

```js
join(Posts, {
  legacyAuthor: null,
});
```

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

### Dot-notation joins

Parent and joined document properties may use dot notation to reference nested fields.

Dot notation describes the field path. Wrapping that path in an array still indicates that the resolved property contains multiple values.

```js
import { join } from "coll-fns";
import { Actions, Posts, Resources, Users } from "/collections";

join(Posts, {
  author: {
    Coll: Users,
    on: ["subDoc.authorId", "_id"],
    single: true,
  },
});

join(Actions, {
  resources: {
    Coll: Resources,
    on: ["_id", ["nestedActions._id"]],
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

When using function-based joins, **a `deps` property should be added** to the join definition to declare which parent fields are required for the join to work:

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
    deps: {
      _id: 1, // Optional. _id is implicit in any fetch.
      postedAt: 1,
    },
  },
});
```

`fields` remains accepted as a backward-compatible alias for `deps`.

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

Any additional properties defined on the join (other than `Coll`, `on`, `single`, `postFetch`, `deps` and legacy `fields`) will be treated as options to pass to the nested documents `fetchList`. It usually includes:

- `limit`: Maximum joined documents count
- `skip`: Documents to skip in the fetch
- `sort`: Sort order of joined documents

### `postFetch`

Children documents might need to be modified (transformed, ordered, filtered...) after being fetched. The `postFetch: (childrenDocs, parentDoc) => childrenDocs` join definition property can be used to do so. `postFetch` must be synchronous; a returned promise is not awaited.

The second argument of the function is the parent document. If some of its properties are needed, they should be declared in the join `deps` property so they are guaranteed to be fetched on the parent.

```js
import { join } from "coll-fns";
import { Actions, Resources } from "/collections";
import { sortTasks } from "/lib/tasks";

join(Resources, {
  tasks: {
    Coll: Tasks,
    on: ["_id", "resourceId"],

    /* Ensure `tasksOrder` will be fetched on parent docs */
    deps: { tasksOrder: 1 },

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

### `createJoinContext(options)`

Joins are normally retrieved from the global dictionary populated by `join()`. A reusable local context can be created to override or disable some of them without modifying their global definitions.

```js
import { createJoinContext, fetchList } from "coll-fns";
import { Permissions, Resources } from "/collections";

const ctx = createJoinContext({ prefix: "+" }).join(Resources, {
  permissions: {
    Coll: Permissions,
    on: [
      "_id",
      "resourceId",
      { userId, tenantId },
    ],
  },
});

const resources = await fetchList(Resources, {}, {
  ctx,
  fields: {
    name: 1,
    "+": {
      permissions: 1,
    },
  },
});
```

Contexts use global joins by default. Local definitions are merged over them by collection and join key. This means a deeply nested join can be overridden without redefining the joins used to reach its collection.

```js
/* Keep all global joins, but override `Users.permissions`
 * anywhere Users is reached in this fetch/publication tree. */
const ctx = createJoinContext().join(Users, {
  permissions: {
    Coll: Permissions,
    on: ["_id", "userId", { tenantId }],
  },
});
```

Pass a falsy definition to disable one global join, or falsy joins to disable all joins of a collection:

```js
const ctx = createJoinContext()
  /* Disable one join */
  .join(Users, { privateNotes: null })
  /* Disable every join on AuditLogs */
  .join(AuditLogs, null);
```

To create a context that does not fall back to any global join:

```js
const ctx = createJoinContext({ defaultToGlobal: false });
```

The join prefix can also be configured locally. It applies to the complete fetch or publication tree and does not modify the global prefix:

```js
const ctx = createJoinContext({ prefix: "+" });

/* Equivalent after creation, and chainable */
ctx.setJoinPrefix("+");
```

A join context can be composed once through chainable calls and reused by multiple fetches and publications.

`fetchList()` and `publish()` only require a context to expose a synchronous `getJoins(Coll)` method. `getJoinPrefix()` is optional, so custom contexts can use arbitrary join lookup logic:

```js
const ctx = {
  getJoins(Coll) {
    return joinDirectoriesByTenant[tenantId]?.get(Coll);
  },
};
```

The context passed at the root is used for every nested join. Children and join definitions cannot replace it for only one branch.

## `fetchList(Coll, selector, options)`

Fetch documents with the ability to **use collection joins**.

**Options:**

- `ctx`: Reusable local join context for the complete fetch tree
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

If, for some reason, you need to retrieve the prefix, you can do so with `getJoinPrefix()`.

### Nested Joins

Joins can be nested to fetch deeply related data. See [Hooks best practices](hooks-and-write-operations.md#hook-best-practices) for how hooks can be used with nested joins.

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

Fetch only the `_id` field of matching documents. The `fields` and `transform`
options are ignored, and the collection transform is disabled so identifiers
are returned unchanged.

```js
import { fetchIds } from "coll-fns";
import { Users } from "/collections";

const userIds = fetchIds(Users, { status: "active" });
```

## `exists(Coll, selector)`

Check if any document matches the selector. Collection transforms are disabled
so they cannot alter the existence result.

```js
import { exists } from "coll-fns";
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
