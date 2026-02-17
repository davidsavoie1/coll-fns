# NEXT

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
