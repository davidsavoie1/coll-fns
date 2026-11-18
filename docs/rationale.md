[← Documentation overview](../README.md#documentation)

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

<details>
<summary><strong>Functional API</strong></summary>

A lot of libraries that add functionalities to the database layer mutate the collection instances themselves or, when more respectful, offer ways to extend the collection constructor somehow.

In either case, it can lead to potential issues where different enhancement libraries conflict with each other. Method names might change, data might be saved in added fields on the collection instances (is `_joins` _really_ safe to use?)...

`coll-fns`, as the name implies, offers a **functional API**. Instead of doing `Collection.insert(doc)`, you would `insert(Collection, doc)`. I know... Moving the left parenthesis and replacing the dot with a comma is a lot to ask 😉, but it comes with benefits!

Instead of mutating the collections themselves, **joins and hooks definitions are saved in a global registry**. No collection instance is harmed (mutated) in the process. You could have a fancy custom collection wrapped and distorted by many different libraries; `coll-fns` won't add a thing to it.

Doing so makes it easy to offer a protocol interface: **the type of collection involved doesn't matter at all**. Heck, the collections could even be table names as strings and it would still work (if you implement a custom protocol)!

For Meteor developers, it also means being able to enhance the `Meteor.users` collection itself... event without access to instantiation code! 🤓

</details>

<details style="margin-bottom: 1rem">
<summary><strong>Nested reactive publications</strong></summary>

In Meteor in particular, publication of data over DDP that gets synced on the client in Minimongo is very convenient. It makes for really reactive applications where data doesn't get stale. Optimistic UI optimizations is built-in and doesn't require additional complex logic.

However, it can get **difficult to publish exactly the right documents**, especially when using a very useful library that allows joining collections together and keeping data much more normalized!

Although returning Meteor cursors from a publish function is still the most optimized path, it sometimes makes sense to **publish children documents based on their relationship with their parent**. But doing so is usually very difficult to implement.

Some existing community libraries that promise to do so either:

- don't actually work (might understand `added` and `removed` callbacks, but won't react to updates)
- are too simplistic (cause a lot of duplicated observers)
- come with a much more complex data layer
- add somewhat unpredictable reactivity on the server.

Since `coll-fns` is already very good at understanding relationships, a `publish` helper was introduced to allow such fine-tuned reactivity out of the box. 💪

</details>
