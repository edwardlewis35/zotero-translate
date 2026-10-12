import assert from "node:assert/strict";
import { FloatingTranslationWindow } from "../src/ui/floating-window";
import { ReaderIntegration } from "../src/reader";
import { TestDocument, TestElement } from "./helpers/dom";

function fixture() {
  const doc = new TestDocument();
  Object.assign(doc.defaultView, { innerWidth: 1000, innerHeight: 800 });
  const body = doc.createElement("body");
  doc.documentElement.append(body);
  Object.assign(doc, { body });
  const pdf = doc.createElement("div");
  pdf.scrollTop = 180;
  body.append(pdf);
  return { doc, body, pdf };
}
function pointer(target: TestElement, x: number, y: number, id = 1) {
  const event = new Event("pointerdown", { cancelable: true });
  Object.defineProperties(event, {
    target: { value: target },
    pointerId: { value: id },
    button: { value: 0 },
    isPrimary: { value: true },
    clientX: { value: x },
    clientY: { value: y },
  });
  return event;
}
function move(doc: TestDocument, type: string, x: number, y: number, id = 1) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: y });
  doc.dispatchEvent(event);
}
function fakeCard(doc: TestDocument) {
  const root = doc.createElement("div");
  root.className = "lft-card";
  const header = doc.createElement("div");
  header.className = "lft-card-header";
  const select = doc.createElement("select");
  const button = doc.createElement("button");
  header.append(select, button);
  root.append(header);
  let disposed = 0;
  return {
    root: root as never,
    header,
    select,
    button,
    dispose: () => disposed++,
    get disposed() {
      return disposed;
    },
  };
}

const f = fixture();
const panel = new FloatingTranslationWindow(f.doc as never);
const outer = panel.root as unknown as TestElement;
const first = fakeCard(f.doc);
panel.show(first);
assert.equal(
  outer.parentElement,
  f.body,
  "overlay belongs to body, not React/native popup",
);
assert.equal(outer.style.left, "316px");
assert.equal(outer.style.top, "60px");
outer.dispatchEvent(pointer(first.header, 400, 80));
move(f.doc, "pointermove", 200, 180, 2);
assert.equal(outer.style.left, "316px", "another pointer cannot move panel");
move(f.doc, "pointermove", 200, 180);
assert.equal(outer.style.left, "116px");
assert.equal(outer.style.top, "160px");
assert.equal(f.pdf.scrollTop, 180);
move(f.doc, "pointerup", 200, 180);
assert.ok(!outer.classList.contains("lft-floating-dragging"));
for (const control of [first.select, first.button]) {
  outer.dispatchEvent(pointer(control, 200, 180));
  move(f.doc, "pointermove", 600, 500);
  move(f.doc, "pointerup", 600, 500);
  assert.deepEqual(panel.position, { left: 116, top: 160 });
}
const second = fakeCard(f.doc);
panel.show(second);
assert.equal(first.disposed, 1);
assert.deepEqual(panel.position, { left: 116, top: 160 });
Object.assign(f.doc.defaultView, { innerWidth: 500, innerHeight: 300 });
f.doc.defaultView.dispatchEvent(new Event("resize"));
assert.deepEqual(panel.position, { left: 12, top: 128 });
assert.equal(outer.style.width, "476px");
assert.equal(outer.style.maxHeight, "160px");
panel.dispose();
panel.dispose();
assert.equal(second.disposed, 1);
assert.ok(!outer.isConnected);
move(f.doc, "pointermove", 700, 700);
assert.deepEqual(panel.position, { left: 12, top: 128 });
const afterDispose = fakeCard(f.doc);
panel.show(afterDispose);
assert.equal(afterDispose.disposed, 1);

let handler!: (event: unknown) => void;
const prefs = new Map<string, unknown>([
  ["autoTranslateWord", false],
  ["autoTranslateParagraph", false],
]);
Object.assign(globalThis, {
  Zotero: {
    Prefs: {
      get: (key: string) => prefs.get(key.split(".").at(-1)!),
      set: () => {},
    },
    logError: () => {},
    Reader: {
      registerEventListener: (_type: string, callback: typeof handler) => {
        handler = callback;
      },
    },
  },
});
function trackSelectionListeners(doc: TestDocument) {
  const listeners = new Map<string, Set<unknown>>();
  const add = doc.addEventListener.bind(doc),
    remove = doc.removeEventListener.bind(doc);
  doc.addEventListener = (type, listener, options) => {
    if (["pointerdown", "keydown"].includes(type)) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    }
    add(type, listener, options);
  };
  doc.removeEventListener = (type, listener, options) => {
    listeners.get(type)?.delete(listener);
    remove(type, listener, options);
  };
  return () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
}
const r = fixture();
const pdfFrame = fixture();
const loadedFrame = fixture();
const topListenerCount = trackSelectionListeners(r.doc);
const frameListenerCount = trackSelectionListeners(pdfFrame.doc);
const loadedListenerCount = trackSelectionListeners(loadedFrame.doc);
const iframe = r.doc.createElement("iframe");
Object.assign(iframe, { contentDocument: pdfFrame.doc });
r.body.append(iframe);
const native = r.doc.createElement("div");
native.className = "selection-popup";
native.style.transform = "translate(50px, 40px)";
r.body.append(native);
const integration = new ReaderIntegration(
  {} as never,
  () => {},
  "test-floating",
);
integration.register();
const event = (text = "sample", x = 1) => ({
  params: {
    annotation: {
      text,
      position: { pageIndex: 0, rects: [[x, 2, 3, 4]] },
      sortIndex: "00000",
    },
  },
  reader: { itemID: 0 },
  doc: r.doc,
  append: () => {
    throw new Error("independent panel must never append to native popup");
  },
});
handler(event());
let readerPanel = r.doc.querySelector(".lft-floating-window")!;
assert.ok(readerPanel);
assert.equal(native.querySelector(".lft-card"), null);
const originalCard = readerPanel.querySelector(".lft-card");
handler(event());
assert.equal(
  readerPanel.querySelector(".lft-card"),
  originalCard,
  "same-selection redraw does not restart",
);
readerPanel.dispatchEvent(
  pointer(readerPanel.querySelector(".lft-card-header")!, 400, 80),
);
move(r.doc, "pointermove", 200, 180);
move(r.doc, "pointerup", 200, 180);
handler(event("another", 10));
assert.equal(r.doc.querySelector(".lft-floating-window"), readerPanel);
assert.notEqual(readerPanel.querySelector(".lft-card"), originalCard);
assert.equal(readerPanel.style.left, "116px");
assert.equal(readerPanel.style.top, "160px");
assert.equal(native.style.transform, "translate(50px, 40px)");
readerPanel.querySelector(".lft-close-button")!.click();
assert.equal(r.doc.querySelector(".lft-floating-window"), null);
handler(event("another", 10));
assert.equal(
  r.doc.querySelector(".lft-floating-window"),
  null,
  "closed same selection stays closed on redraw",
);
pdfFrame.doc.dispatchEvent(pointer(pdfFrame.pdf, 100, 100));
handler(event("another", 10));
readerPanel = r.doc.querySelector(".lft-floating-window")!;
assert.ok(readerPanel);
assert.equal(readerPanel.style.left, "116px");
assert.equal(
  frameListenerCount(),
  2,
  "selection gestures are bound inside PDF iframe",
);
readerPanel.querySelector(".lft-close-button")!.click();
Object.assign(iframe, { contentDocument: loadedFrame.doc });
iframe.dispatchEvent(new Event("load"));
assert.equal(loadedListenerCount(), 2, "iframe reload binds the new document");
const keyboard = new Event("keydown");
Object.defineProperties(keyboard, {
  target: { value: loadedFrame.pdf },
  key: { value: "ArrowRight" },
  shiftKey: { value: true },
});
loadedFrame.doc.dispatchEvent(keyboard);
handler(event("another", 10));
assert.ok(
  r.doc.querySelector(".lft-floating-window"),
  "keyboard reselection reopens a closed same word",
);
r.doc.defaultView.dispatchEvent(new Event("pagehide"));
assert.equal(topListenerCount(), 0);
assert.equal(frameListenerCount(), 0);
assert.equal(loadedListenerCount(), 0);
assert.equal(r.doc.querySelector(".lft-floating-window"), null);
integration.unregister();
handler(
  new Proxy(
    {},
    {
      get() {
        throw new Error("inactive event read");
      },
    },
  ),
);
assert.equal(r.pdf.scrollTop, 180);
console.log(
  "Floating window: drag, control exclusion, viewport clamp, selection reuse, no native append, close/reopen and cleanup passed (mock geometry)",
);
