import { droppingBuffer, fixedBuffer, slidingBuffer } from "async-rivers";
import { isFunc } from "./util";

const BUFFER_SIZE = 10;
const MAX_PENDING = 250;

export let hooksBuffer = createDefaultHooksBuffer();
let bufferLocked = false;

/* Reexport buffer definitions from async-rivers */
export { droppingBuffer, fixedBuffer, slidingBuffer };

/* Set a custom hooks buffer to replace the default one.
 * Must be called before any hook is placed on the river. */
export function setHooksBuffer(buffer) {
  if (bufferLocked) {
    throw new Error(
      "'setHooksBuffer' must be called before hooks start processing"
    );
  }

  const bufferToSet = buffer || createDefaultHooksBuffer();
  if (!isValidBuffer(bufferToSet)) {
    throw new TypeError("Invalid hooks buffer");
  }

  hooksBuffer = bufferToSet;
}

/* Wrapper function to set `bufferLocked` to true */
export function _lockHooksBuffer() {
  bufferLocked = true;
}

function isValidBuffer(buffer) {
  if (!buffer) return false;
  return ["push", "next", "count", "close", "clear"].every((method) =>
    isFunc(buffer[method])
  );
}

function createDefaultHooksBuffer() {
  return fixedBuffer(BUFFER_SIZE, {
    maxPending: MAX_PENDING,
    onOverflow() {
      throw new Error(
        `Hooks buffer max pending hooks (${MAX_PENDING}) reached. This could crash the server by exhausting its heap. Review your code to limit concurrent after hooks or replace the default buffer with a custom one to prevent this error with 'setHooksBuffer(buffer)' before first execution.`
      );
    },
  });
}
