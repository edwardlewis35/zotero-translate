import assert from "node:assert/strict";
import { ReaderIntegration } from "../src/reader";
import { watchSelectionPopupLayout } from "../src/ui/popup-layout";
import { TestDocument, TestElement } from "./helpers/dom";

// Geometry is deliberate test data; actual Gecko flex/scroll layout is checked
// by the isolated Zotero smoke harness rather than this observer double.
class ObserverDouble {
  targets: unknown[] = [];
  observedOptions: unknown[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {}
  observe(target: unknown, options?: unknown): void {
    this.targets.push(target);
    this.observedOptions.push(options);
    this.disconnected = false;
  }
  disconnect(): void {
    this.targets = [];
    this.disconnected = true;
  }
  emit(): void {
    if (!this.disconnected) this.callback();
  }
}

function fixture() {
  const doc = new TestDocument();
  const body = doc.createElement("body");
  doc.documentElement.append(body);
  Object.assign(doc, { body });
  const pane = doc.createElement("div");
  pane.className = "primary-view";
  body.append(pane);
  const popup = doc.createElement("div");
  popup.className = "selection-popup";
  Object.defineProperty(popup, "parentNode", {
    get: () => popup.parentElement,
  });
  const section = doc.createElement("div");
  section.className = "section";
  popup.append(section);
  let paneBottom = 470;
  let popupTop = 300;
  Object.assign(pane, {
    getBoundingClientRect: () => ({ bottom: paneBottom }),
  });
  Object.assign(popup, {
    getBoundingClientRect: () => ({ top: popupTop }),
  });
  const properties = new Map<string, string>();
  let writes = 0;
  popup.style = {
    transform: "translate(100px, 300px)",
    setProperty: (name: string, value: string) => {
      properties.set(name, value);
      writes++;
    },
    removeProperty: (name: string) => properties.delete(name),
  };
  const resizeObservers: ObserverDouble[] = [];
  const mutationObservers: ObserverDouble[] = [];
  let resizeListeners = 0;
  const originalAdd = doc.defaultView.addEventListener.bind(doc.defaultView);
  const originalRemove = doc.defaultView.removeEventListener.bind(
    doc.defaultView,
  );
  Object.assign(doc.defaultView, {
    innerHeight: 510,
    ResizeObserver: class extends ObserverDouble {
      constructor(callback: () => void) {
        super(callback);
        resizeObservers.push(this);
      }
    },
    MutationObserver: class extends ObserverDouble {
      constructor(callback: () => void) {
        super(callback);
        mutationObservers.push(this);
      }
    },
    addEventListener: (...args: Parameters<typeof originalAdd>) => {
      if (args[0] === "resize") resizeListeners++;
      originalAdd(...args);
    },
    removeEventListener: (...args: Parameters<typeof originalRemove>) => {
      if (args[0] === "resize") resizeListeners--;
      originalRemove(...args);
    },
  });
  const card = doc.createElement("div");
  card.className = "lft-card";
  return {
    doc,
    body,
    pane,
    popup,
    section,
    card,
    properties,
    resizeObservers,
    mutationObservers,
    get writes() {
      return writes;
    },
    get resizeListeners() {
      return resizeListeners;
    },
    setGeometry(bottom: number, top = popupTop) {
      paneBottom = bottom;
      popupTop = top;
    },
    mount(root: TestElement = card) {
      section.append(root);
      pane.append(popup);
      mutationObservers.forEach((observer) => observer.emit());
    },
  };
}

const pending = fixture();
let cleanupNotifications = 0;
const dispose = watchSelectionPopupLayout(
  pending.doc as never,
  pending.card as never,
  () => cleanupNotifications++,
);
assert.equal(pending.mutationObservers[0].targets[0], pending.body);
assert.equal(pending.properties.size, 0, "wait for the actual native popup");
pending.mount();
assert.ok(pending.popup.classList.contains("lft-selection-popup"));
assert.ok(pending.section.classList.contains("lft-popup-section"));
assert.equal(pending.properties.get("--lft-popup-max-height"), "158px");
assert.equal(pending.mutationObservers[0].targets[0], pending.pane);
assert.equal(pending.popup.style.transform, "translate(100px, 300px)");

const before = pending.writes;
pending.resizeObservers[0].emit();
pending.mutationObservers[0].emit();
assert.equal(pending.writes, before, "own style mutation must not loop");
pending.popup.classList.remove("lft-selection-popup");
pending.mutationObservers[0].emit();
assert.ok(
  pending.popup.classList.contains("lft-selection-popup"),
  "restore the layout marker when React rewrites the same popup className",
);
pending.mutationObservers[0].emit();
assert.equal(pending.writes, before, "marker recovery must not rewrite height");
pending.setGeometry(900, 200);
pending.doc.defaultView.dispatchEvent(new Event("resize"));
assert.equal(
  pending.properties.get("--lft-popup-max-height"),
  "298px",
  "use the smaller of pane bottom and Reader window height",
);
Object.assign(pending.doc.defaultView, { innerHeight: 350 });
pending.doc.defaultView.dispatchEvent(new Event("resize"));
assert.equal(pending.properties.get("--lft-popup-max-height"), "138px");
pending.setGeometry(180, 200);
pending.resizeObservers[0].emit();
assert.equal(pending.properties.get("--lft-popup-max-height"), "0px");
pending.card.remove();
pending.mutationObservers[0].emit();
assert.ok(pending.resizeObservers[0].disconnected);
assert.ok(pending.mutationObservers[0].disconnected);
assert.equal(pending.resizeListeners, 0);
assert.equal(cleanupNotifications, 1);
dispose();
assert.equal(cleanupNotifications, 1, "cleanup is idempotent");

// Replacing a card must not let the old removal observer strip the new card's
// shared popup class or height. Its own observers still need to stop.
const replacement = fixture();
const oldDispose = watchSelectionPopupLayout(
  replacement.doc as never,
  replacement.card as never,
);
replacement.mount();
const nextCard = replacement.doc.createElement("div");
nextCard.className = "lft-card";
replacement.section.append(nextCard);
replacement.card.remove();
const newDispose = watchSelectionPopupLayout(
  replacement.doc as never,
  nextCard as never,
);
replacement.mutationObservers[0].emit();
assert.ok(replacement.popup.classList.contains("lft-selection-popup"));
assert.ok(replacement.section.classList.contains("lft-popup-section"));
assert.equal(replacement.properties.get("--lft-popup-max-height"), "158px");
oldDispose();
newDispose();
assert.equal(replacement.resizeListeners, 0);

const closing = fixture();
watchSelectionPopupLayout(closing.doc as never, closing.card as never);
closing.mount();
closing.doc.defaultView.dispatchEvent(new Event("pagehide"));
assert.ok(closing.resizeObservers[0].disconnected);
assert.ok(closing.mutationObservers[0].disconnected);
assert.equal(closing.resizeListeners, 0);

// A sandbox-owned options dictionary must be copied into the DOM window realm
// before Gecko WebIDL reads it. This double checks call/identity plumbing only;
// the isolated Zotero harness verifies the actual Xray boundary.
const realm = fixture();
const clonedOptions: Array<{
  source: unknown;
  target: unknown;
  result: unknown;
}> = [];
Object.assign(globalThis, {
  Components: {
    utils: {
      cloneInto: (source: object, target: unknown) => {
        const result = structuredClone(source);
        clonedOptions.push({ source, target, result });
        return result;
      },
    },
  },
});
const realmDispose = watchSelectionPopupLayout(
  realm.doc as never,
  realm.card as never,
);
realm.mount();
assert.equal(clonedOptions.length, 2);
for (const [index, clone] of clonedOptions.entries()) {
  assert.equal(clone.target, realm.doc.defaultView);
  assert.notEqual(clone.result, clone.source);
  assert.deepEqual(clone.result, clone.source);
  assert.equal(realm.mutationObservers[0].observedOptions[index], clone.result);
}
realmDispose();
delete (globalThis as Record<string, unknown>).Components;

const failure = fixture();
const originalMutationObserver = (
  failure.doc.defaultView as unknown as {
    MutationObserver: typeof ObserverDouble;
  }
).MutationObserver;
Object.assign(failure.doc.defaultView, {
  MutationObserver: class extends originalMutationObserver {
    override observe(target: unknown, options?: unknown): void {
      super.observe(target, options);
      throw new Error("invalid observer options");
    }
  },
});
assert.throws(
  () => watchSelectionPopupLayout(failure.doc as never, failure.card as never),
  /invalid observer options/u,
);
assert.ok(failure.resizeObservers[0].disconnected);
assert.ok(failure.mutationObservers[0].disconnected);
assert.equal(failure.resizeListeners, 0);

// If setup fails after listeners have already been installed (during immediate
// mounted-card observation), those listeners also need to be removed.
const mountedFailure = fixture();
mountedFailure.section.append(mountedFailure.card);
mountedFailure.pane.append(mountedFailure.popup);
const originalMountedObserver = (
  mountedFailure.doc.defaultView as unknown as {
    MutationObserver: typeof ObserverDouble;
  }
).MutationObserver;
Object.assign(mountedFailure.doc.defaultView, {
  MutationObserver: class extends originalMountedObserver {
    override observe(target: unknown, options?: unknown): void {
      super.observe(target, options);
      if (target === mountedFailure.pane)
        throw new Error("mounted observation failed");
    }
  },
});
assert.throws(
  () =>
    watchSelectionPopupLayout(
      mountedFailure.doc as never,
      mountedFailure.card as never,
    ),
  /mounted observation failed/u,
);
assert.ok(mountedFailure.resizeObservers[0].disconnected);
assert.ok(mountedFailure.mutationObservers[0].disconnected);
assert.equal(mountedFailure.resizeListeners, 0);

const stopped = fixture();
const prefs = new Map<string, unknown>([["autoTranslateWord", false]]);
let handler!: (event: unknown) => void;
Object.assign(globalThis, {
  Zotero: {
    Prefs: {
      get: (key: string) => prefs.get(key.split(".").at(-1)!),
      set: (key: string, value: unknown) => prefs.set(key, value),
    },
    logError: () => {},
    Reader: {
      registerEventListener: (_type: string, callback: typeof handler) => {
        handler = callback;
      },
    },
  },
});
const integration = new ReaderIntegration({} as never, () => {}, "test-plugin");
integration.register();
let appended!: TestElement;
handler({
  params: { annotation: { text: "sample" } },
  reader: { itemID: 0 },
  doc: stopped.doc,
  append: (root: TestElement) => {
    appended = root;
  },
});
stopped.mount(appended);
assert.equal(stopped.resizeListeners, 1);
integration.unregister();
assert.ok(stopped.resizeObservers[0].disconnected);
assert.ok(stopped.mutationObservers[0].disconnected);
assert.equal(stopped.resizeListeners, 0);
assert.ok(!stopped.popup.classList.contains("lft-selection-popup"));

let layoutErrors = 0;
Object.assign((globalThis as typeof globalThis & { Zotero: object }).Zotero, {
  logError: () => layoutErrors++,
});
const resilient = new ReaderIntegration({} as never, () => {}, "test-plugin");
resilient.register();
let resilientCard!: TestElement;
handler({
  params: {
    annotation: {
      text: "sample",
      position: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
    },
  },
  reader: { itemID: 0 },
  doc: failure.doc,
  append: (root: TestElement) => {
    resilientCard = root;
  },
});
assert.equal(layoutErrors, 1);
assert.ok(
  resilientCard.textContent.includes("自动查词已关闭"),
  "card.start must still render when optional layout setup fails",
);
assert.equal(failure.resizeListeners, 0);
resilient.unregister();

console.log(
  "selection popup: async mounting, available pane height, native positioning, replacement, realm-option cloning, failure resilience and observer cleanup passed (mock geometry)",
);
