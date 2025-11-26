import { getProtocol } from "./protocol";
import { then } from "./util";

export function count(Coll, selector) {
  const { count: _count } = getProtocol();

  return then(_count(Coll, selector), (res) => res);
}
