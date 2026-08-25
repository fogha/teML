// interactive/bindings.ts — id-keyed binding object for the in-process Node host.
//
// A binding is a push-only, host-owned variable keyed by widget id (ADR 006).
// Assigning a string to a key emits `update{id, {value: s}}` through the sink
// the host attaches at startup, so a host mutates variables rather than
// writing protocol commands. Reads return the last assigned value (or
// undefined), never engine state; user-edited widgets stay on ctx.values().
//
// This module owns no terminal I/O and no session state. It is a plain
// assignment→command bridge; the engine keeps validating targets and values
// through the existing `update` path (see interactive/session.ts handleUpdate).

/** Called by the host when a value is assigned; may be null before/after a run. */
export type BindingSink = (id: string, value: string) => void;

/** @internal Attach hook used only by the in-process host to wire its sink. */
export const ATTACH_BINDING_SINK: unique symbol = Symbol("teml.bindings.attach");

/** A map from widget id → value. Assignment is the notification. */
export type Bindings = Record<string, string> & {
  /** @internal */
  [ATTACH_BINDING_SINK](sink: BindingSink | null): void;
};

/** Create an id-keyed binding set for `runInteractiveApp`'s `state` option. */
export function bindings(): Bindings {
  const store = new Map<string, string>();
  let sink: BindingSink | null = null;

  const proxy = new Proxy(Object.create(null) as Record<string, string>, {
    set(_target, prop, value: unknown) {
      const id = String(prop);
      const stringValue = String(value);
      store.set(id, stringValue);
      if (sink) sink(id, stringValue);
      return true;
    },
    get(_target, prop) {
      if (prop === ATTACH_BINDING_SINK) {
        return (next: BindingSink | null): void => {
          sink = next;
        };
      }
      return store.get(String(prop));
    },
    has(_target, prop) {
      return store.has(String(prop));
    },
  });

  return proxy as Bindings;
}
