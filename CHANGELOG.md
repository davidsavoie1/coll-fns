# 1.7.1 - 2026-11-18

- Fix | Error when using object mappings in `publish`
- Split documentation in multiple files

---

# 1.7.0 - 2026-08-18

- Allow dot-notation keys in `publish` `deps`
- Allow dot notation key joins
- Allow passing a local join context to override global joins in `fetch` and `publish`
- Allow stateless 1:1, 1:n and 1:0 field mappings in `publish`
- Fix boolean values returned by function-based publication `deps`
- Keep complete non-awaited publication branches detached from initial readiness
- Disable document transforms in `fetchIds` and `exists`
- Normalize string selectors in `softRemove` before protocol calls

---

# 1.6.2 - 2026-05-15

- Fix | Reuse by query key in publish is inconsistent
- Always normalize child arguments to create query key
- Add additional race condition guards in publish

---

# 1.6.1 - 2026-04-20

- Ensure explicit array join `on` fields are used by parent query
- Prevent `changed` publish callback race condition by enforcing sequential processing

---

# 1.6.0 - 2026-03-05

- Fix | Children observers not awaited before publication ready
- Allow passing debug locations as an array
- Allow each child to define its publication readiness contribution

---

# 1.5.0 - 2026-02-24

- Add `publish` nested publication helper;
- Add `observe` and `stringify` to protocol and Meteor implementations;
- Prefer `deps` over `fields` in join definitions;

---

# 1.4.3 - 2026-02-20

- Fix | Preserve Meteor Fiber context in hooks with `protocol.bindEnvironment` support;
- Fix | `protocols.meteorSync` now binds hook callbacks with `Meteor.bindEnvironment` when available;
- Allow sync or async hook predicate functions;

---

# 1.4.2 - 2026-02-18

- Add types to project

---

# 1.4.1 - 2026-02-18

- Republished the built project. 1.4.0 source code included `softRemove` but was not built before publishing.

---

# 1.4.0 - 2026-02-17

- Fix | Remove doesn't await removed count before proceeding;
- Added `softRemove` functionality;
- Add JSDocs for `softRemove` file;

# 1.3.0 - 2026-02-16

A pool is now used to handle after hooks in order to limit in-flight promises (queuing extra ones).

- Use a configurable pool to handle concurrent after hooks;
- Improve after hooks error handling documentation;

---

# 1.2.0 - 2026-01-30

- BREAK | Remove `getProtocol` exported method (assumed it probably wasn't used much);
- Greatly improve documentation;
- Remove `cursor` from protocol;

---

# 1.1.0 - 2026-01-13

- Improve error handling in hooks;
- Improve README and JSDocs;
