/**
 * `@bp/core` is host-agnostic: it declares `types: []` so no ambient @types package (Node's included) can leak a
 * host API into the engine. The one platform global the engine relies on is `structuredClone`, available in every
 * supported runtime (Node 17+, all modern browsers) but not part of the ES2022 lib.
 */
declare function structuredClone<T>(value: T): T
