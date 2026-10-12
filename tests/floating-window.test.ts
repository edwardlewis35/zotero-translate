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
  pdf.id = "viewerContainer";
  pdf.scrollTop = 180;
  body.append(pdf);
  return { doc, body, pdf };
}
function pointer(
  target: TestElement,
  x: number,
  y: number,
  id = 1,
  options: { button?: number; isPrimary?: boolean; pointerType?: string } = {},
) {
  const event = new Event("pointerdown", { cancelable: true });
  Object.defineProperties(event, {
    target: { value: target },
    pointerId: { value: id },
    button: { value: options.button ?? 0 },
    isPrimary: { value: options.isPrimary ?? true },
    pointerType: { value: options.pointerType ?? "mouse" },
    clientX: { value: x },
    clientY: { value: y },
  });
  return event;
}
function move(
  doc: TestDocument,
  type: string,
  x: number,
  y: number,
  id = 1,
  buttons = type === "pointermove" ? 1 : 0,
) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: y, buttons });
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
    if (
      [
        "pointerdown",
        "pointermove",
        "mousedown",
        "keydown",
        "selectionchange",
      ].includes(type)
    ) {
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
assert.equal(
  r.doc.querySelector(".lft-floating-window"),
  readerPanel,
  "completing a drag outside its initial header does not close the panel",
);
for (const target of [
  readerPanel.querySelector(".lft-model-select")!,
  readerPanel.querySelector(".lft-button-annotation")!,
  readerPanel.querySelector(".lft-card-body")!,
]) {
  r.doc.dispatchEvent(pointer(target, 200, 200));
  handler(event());
  assert.equal(r.doc.querySelector(".lft-floating-window"), readerPanel);
  assert.equal(readerPanel.querySelector(".lft-card"), originalCard);
}
for (const options of [{ button: 2 }, { isPrimary: false }]) {
  pdfFrame.doc.dispatchEvent(pointer(pdfFrame.pdf, 50, 50, 1, options));
  assert.equal(r.doc.querySelector(".lft-floating-window"), readerPanel);
}
handler(event("another", 10));
assert.equal(r.doc.querySelector(".lft-floating-window"), readerPanel);
assert.notEqual(readerPanel.querySelector(".lft-card"), originalCard);
assert.equal(readerPanel.style.left, "116px");
assert.equal(readerPanel.style.top, "160px");
assert.equal(native.style.transform, "translate(50px, 40px)");
pdfFrame.doc.dispatchEvent(
  pointer(pdfFrame.pdf, 100, 100, 1, { pointerType: "touch" }),
);
assert.equal(
  r.doc.querySelector(".lft-floating-window"),
  null,
  "a primary touch outside the floating window closes it inside the PDF iframe",
);
handler(event("another", 10));
assert.equal(
  r.doc.querySelector(".lft-floating-window"),
  null,
  "the closing outside gesture cannot reopen the old native selection redraw",
);
pdfFrame.doc.dispatchEvent(pointer(pdfFrame.pdf, 100, 100));
move(pdfFrame.doc, "pointerup", 100, 100);
move(pdfFrame.doc, "pointermove", 400, 300, 1, 0);
handler(event("another", 10));
assert.equal(
  r.doc.querySelector(".lft-floating-window"),
  null,
  "a plain blank click followed by released-pointer hover keeps the dismissed selection closed",
);
// Desktop PDF selections are custom ranges, so this does not depend on a DOM
// getSelection() or selectionchange event. A real double-click allows reselection.
const doubleClick = new Event("mousedown", { cancelable: true });
Object.defineProperties(doubleClick, {
  target: { value: pdfFrame.pdf },
  button: { value: 0 },
  detail: { value: 2 },
});
pdfFrame.doc.dispatchEvent(pointer(pdfFrame.pdf, 100, 100));
pdfFrame.doc.dispatchEvent(doubleClick);
handler(event("another", 10));
readerPanel = r.doc.querySelector(".lft-floating-window")!;
assert.ok(readerPanel);
assert.equal(readerPanel.style.left, "116px");
assert.equal(readerPanel.style.top, "160px");
readerPanel.querySelector(".lft-close-button")!.click();
assert.equal(r.doc.querySelector(".lft-floating-window"), null);
handler(event("another", 10));
assert.equal(
  r.doc.querySelector(".lft-floating-window"),
  null,
  "closed same selection stays closed on redraw",
);
pdfFrame.doc.dispatchEvent(pointer(pdfFrame.pdf, 100, 100));
move(pdfFrame.doc, "pointermove", 120, 100);
handler(event("another", 10));
readerPanel = r.doc.querySelector(".lft-floating-window")!;
assert.ok(readerPanel);
assert.equal(readerPanel.style.left, "116px");
assert.equal(
  frameListenerCount(),
  5,
  "selection gestures are bound inside PDF iframe",
);
readerPanel.querySelector(".lft-close-button")!.click();
Object.assign(iframe, { contentDocument: loadedFrame.doc });
iframe.dispatchEvent(new Event("load"));
assert.equal(loadedListenerCount(), 5, "iframe reload binds the new document");
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
// The native-selection path used by text documents/mobile PDF handles also
// recognizes collapse-and-reselect without unlocking a merely dismissed key.
const anchor = loadedFrame.doc.createElement("span");
let nativeSelection = {
  anchorNode: anchor,
  anchorOffset: 0,
  focusNode: anchor,
  focusOffset: 7,
  isCollapsed: false,
  toString: () => "another",
};
Object.assign(loadedFrame.doc, { getSelection: () => nativeSelection });
loadedFrame.doc.dispatchEvent(
  pointer(loadedFrame.pdf, 100, 100, 1, { pointerType: "touch" }),
);
handler(event("another", 10));
assert.equal(r.doc.querySelector(".lft-floating-window"), null);
nativeSelection = {
  ...nativeSelection,
  focusOffset: 0,
  isCollapsed: true,
  toString: () => "",
};
loadedFrame.doc.dispatchEvent(new Event("selectionchange"));
handler(event("another", 10));
assert.equal(
  r.doc.querySelector(".lft-floating-window"),
  null,
  "clearing the text selection cannot reopen the previous native popup",
);
nativeSelection = {
  ...nativeSelection,
  focusOffset: 7,
  isCollapsed: false,
  toString: () => "another",
};
loadedFrame.doc.dispatchEvent(new Event("selectionchange"));
handler(event("another", 10));
assert.ok(r.doc.querySelector(".lft-floating-window"));
// Any top-level outside target, including the independent native annotation
// toolbar, closes the panel. The first gesture may still select a new word.
r.doc.dispatchEvent(pointer(native, 100, 100));
assert.equal(r.doc.querySelector(".lft-floating-window"), null);
handler(event("another", 10));
assert.equal(r.doc.querySelector(".lft-floating-window"), null);
handler(event("newword", 20));
readerPanel = r.doc.querySelector(".lft-floating-window")!;
assert.ok(readerPanel, "a different selection from the closing gesture opens");
assert.equal(readerPanel.style.left, "116px");
assert.equal(readerPanel.style.top, "160px");
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

// Outside dismissal reaches TranslationCard.dispose(), so pending local
// lookups see cancellation and late results never recreate the removed panel.
let completeLookup!: (result: unknown) => void;
const dictionaryPending = new Promise((resolve) => {
  completeLookup = resolve;
});
let cancelledLookup!: () => boolean;
const localFixture = fixture();
const localListenerCount = trackSelectionListeners(localFixture.doc);
prefs.set("autoTranslateWord", true);
const localIntegration = new ReaderIntegration(
  {
    lookup: (_word: string, options: { isCancelled: () => boolean }) => {
      cancelledLookup = options.isCancelled;
      return dictionaryPending;
    },
  } as never,
  () => {},
  "test-dismiss-local",
);
localIntegration.register();
const localEvent = { ...event(), doc: localFixture.doc };
handler(localEvent);
assert.equal(cancelledLookup(), false);
localFixture.doc.dispatchEvent(pointer(localFixture.pdf, 10, 10));
assert.equal(cancelledLookup(), true);
assert.equal(localFixture.doc.querySelector(".lft-floating-window"), null);
completeLookup({
  word: "sample",
  entries: [],
  errors: [],
  configuredDictionaries: 1,
});
await new Promise((resolve) => setTimeout(resolve, 0));
handler(localEvent);
assert.equal(localFixture.doc.querySelector(".lft-floating-window"), null);
localIntegration.unregister();
assert.equal(localListenerCount(), 0);

// The same dismissal aborts an in-flight model request and releases selection
// listeners on unregister, even when the API reports failure after cancellation.
prefs.set("autoTranslateWord", false);
prefs.set("autoTranslateParagraph", true);
prefs.set("selectedApiProfileId", "dismiss-model");
prefs.set(
  "apiProfiles",
  JSON.stringify([
    {
      id: "dismiss-model",
      name: "Dismiss model",
      model: "mock-model",
      endpoint: "https://example.invalid/v1",
      protocol: "responses",
      apiKey: "",
      targetLanguage: "简体中文",
      temperature: "0.2",
      prompt: "Translate ${sourceText}",
    },
  ]),
);
let aborts = 0;
let failModel!: (reason: unknown) => void;
Object.assign(Zotero, {
  HTTP: {
    request: (
      _method: string,
      _endpoint: string,
      options: { cancellerReceiver: (cancel: () => void) => void },
    ) => {
      const pending = new Promise((_resolve, reject) => {
        failModel = reject;
      });
      options.cancellerReceiver(() => {
        aborts++;
        failModel(new Error("cancelled"));
      });
      return pending;
    },
  },
});
const onlineFixture = fixture();
const onlineListenerCount = trackSelectionListeners(onlineFixture.doc);
const onlineIntegration = new ReaderIntegration(
  {} as never,
  () => {},
  "test-dismiss-online",
);
onlineIntegration.register();
const onlineEvent = {
  ...event("pending sentence", 30),
  doc: onlineFixture.doc,
};
handler(onlineEvent);
assert.ok(onlineFixture.doc.querySelector(".lft-floating-window"));
onlineFixture.doc.dispatchEvent(pointer(onlineFixture.pdf, 10, 10));
assert.equal(aborts, 1);
assert.equal(onlineFixture.doc.querySelector(".lft-floating-window"), null);
await new Promise((resolve) => setTimeout(resolve, 0));
handler(onlineEvent);
assert.equal(onlineFixture.doc.querySelector(".lft-floating-window"), null);
onlineIntegration.unregister();
assert.equal(onlineListenerCount(), 0);
console.log(
  "Floating window: drag, internal controls, outside click/touch dismissal, fresh reselection, redraw guards, pending cancellation and cleanup passed (mock geometry)",
);
