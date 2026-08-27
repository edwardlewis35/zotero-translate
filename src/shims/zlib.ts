import { inflate } from "pako";

export function inflateSync(input: Uint8Array): Uint8Array {
  return inflate(input);
}

export default { inflateSync };
