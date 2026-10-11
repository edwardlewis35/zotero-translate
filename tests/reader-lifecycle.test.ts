import assert from "node:assert/strict";
import { ReaderIntegration } from "../src/reader";

type Listener = {
  type: string;
  handler: (event: unknown) => void;
  pluginID: string;
};
let listeners: Listener[] = [];
let unsafeUnregisterCalls = 0;
let otherPluginEvents = 0;
const otherHandler = () => otherPluginEvents++;
const pluginID = "lexiflow-dict-translator@example.com";

Object.assign(globalThis, {
  Zotero: {
    Reader: {
      registerEventListener: (
        type: string,
        handler: Listener["handler"],
        pluginID: string,
      ) => listeners.push({ type, handler, pluginID }),
      // Reproduce the filtering bug in Zotero 9.0.6's Reader API.
      unregisterEventListener: (type: string, handler: Listener["handler"]) => {
        unsafeUnregisterCalls++;
        listeners = listeners.filter(
          (listener) => listener.type === type && listener.handler === handler,
        );
      },
    },
  },
});

listeners.push({
  type: "renderTextSelectionPopup",
  handler: otherHandler,
  pluginID: "another-plugin@example.com",
});
const createIntegration = () =>
  new ReaderIntegration({} as never, () => {}, pluginID);
const integration = createIntegration();
integration.register();
integration.register();
assert.equal(listeners.length, 2, "repeated startup must not duplicate cards");

integration.unregister();
assert.equal(unsafeUnregisterCalls, 0);
assert.ok(listeners.some((listener) => listener.handler === otherHandler));
const disposedEvent = new Proxy(
  {},
  {
    get() {
      throw new Error("a stopped plugin must not access the reader event");
    },
  },
);
for (const listener of listeners) listener.handler(disposedEvent);
assert.equal(otherPluginEvents, 1);

// The host's plugin shutdown observer removes only this plugin's listeners.
listeners = listeners.filter((listener) => listener.pluginID !== pluginID);
assert.deepEqual(
  listeners.map((listener) => listener.handler),
  [otherHandler],
);
const restarted = createIntegration();
restarted.register();
for (const listener of listeners) {
  listener.handler({ params: { annotation: { text: "" } } });
}
assert.equal(listeners.length, 2);
assert.equal(otherPluginEvents, 2);
restarted.unregister();
console.log(
  "Zotero 9 reader shutdown: other plugins preserved, inactive callbacks and reload passed",
);
