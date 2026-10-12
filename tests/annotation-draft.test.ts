import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import {
  AnnotationDraft,
  getSelectedTranslationText,
} from "../src/ui/annotation-draft";

const draft = new AnnotationDraft();
assert.equal(draft.hasDraft, false);
assert.equal(draft.text, "");
assert.equal(draft.addSelection(" \r\n\t "), false);
assert.equal(draft.hasDraft, false);
assert.equal(
  draft.addSelection("  First meaning\r\n  indented example.  "),
  true,
);
assert.equal(draft.text, "First meaning\n  indented example.");
assert.equal(draft.hasDraft, true);
assert.equal(draft.addSelection("First meaning\n  indented example."), false);
assert.equal(draft.addSelection("第二项释义"), true);
assert.equal(draft.text, "First meaning\n  indented example.\n\n第二项释义");
assert.equal(draft.addSelection("First meaning\n  indented example."), false);
assert.equal(draft.addSelection("first meaning\n  indented example."), true);

draft.setText("  My own definition\r\nand example.  ");
assert.equal(draft.text, "  My own definition\nand example.  ");
assert.equal(draft.addSelection("Third meaning"), true);
assert.equal(
  draft.text,
  "  My own definition\nand example.  \n\nThird meaning",
);
draft.setText("");
assert.equal(draft.hasDraft, true);
assert.equal(draft.text, "");
assert.equal(draft.addSelection(""), false);
assert.equal(draft.hasDraft, true);
assert.equal(draft.addSelection("Third meaning"), true);
assert.equal(draft.text, "Third meaning");
draft.reset();
assert.equal(draft.hasDraft, false);
assert.equal(draft.text, "");
assert.equal(draft.addSelection("Third meaning"), true);
assert.equal(draft.text, "Third meaning");

const edited = new AnnotationDraft();
edited.addSelection("Retained meaning");
edited.addSelection("Removed meaning");
edited.setText("Retained meaning\r\n\r\nMy manual example");
assert.equal(edited.addSelection("Retained meaning"), false);
assert.equal(edited.addSelection("Removed meaning"), true);
assert.equal(
  edited.text,
  "Retained meaning\n\nMy manual example\n\nRemoved meaning",
);
edited.setText("A corrected meaning");
assert.equal(edited.addSelection("Retained meaning"), true);
assert.equal(edited.text, "A corrected meaning\n\nRetained meaning");

const manual = new AnnotationDraft();
manual.setText("<img src=x onerror=alert(1)> & plain text");
assert.equal(manual.hasDraft, true);
assert.equal(manual.text, "<img src=x onerror=alert(1)> & plain text");
assert.equal(manual.addSelection("A new example"), true);
assert.equal(
  manual.text,
  "<img src=x onerror=alert(1)> & plain text\n\nA new example",
);

const doc = new DOMParser().parseFromString(
  '<html><body><div id="card"><button id="toolbar">Save</button><textarea id="query">bank</textarea><div id="translation"><section><p id="first">The <mark>bank</mark> is open.</p></section><section><p id="second">第二项释义 <strong id="bold">bold</strong> <code id="code">bank()</code></p></section><div id="controls"><button><span>Play</span></button><select><option>Model</option></select><input value="bank"><textarea>draft</textarea><a href="#"><strong>source</strong></a><summary>Fold</summary><span role="button">Play</span><div contenteditable="true">edit</div></div></div><textarea id="editor">draft</textarea></div><div id="pdf">PDF text</div></body></html>',
  "text/html",
);
const root = doc.getElementById("translation")!;
const first = doc.getElementById("first")!;
const mark = first.querySelector("mark")!;
const second = doc.getElementById("second")!;
const toolbar = doc.getElementById("toolbar")!;
const query = doc.getElementById("query")!;
const editor = doc.getElementById("editor")!;
const pdf = doc.getElementById("pdf")!;
const bold = doc.getElementById("bold")!;
const code = doc.getElementById("code")!;
type RangeEnds = { startContainer: unknown; endContainer: unknown };
let ranges: RangeEnds[] = [];
let selectedText = "";
let collapsed = false;
Object.assign(doc, {
  getSelection: () => ({
    isCollapsed: collapsed,
    rangeCount: ranges.length,
    getRangeAt: (index: number) => ranges[index],
    toString: () => selectedText,
  }),
});
const selected = () => getSelectedTranslationText(doc as never, root as never);
assert.equal(selected(), "");
ranges = [{ startContainer: first.firstChild, endContainer: mark.firstChild }];
selectedText = "The bank";
assert.equal(selected(), "The bank");
ranges = [
  { startContainer: first.firstChild, endContainer: second.firstChild },
];
selectedText = "The bank is open.\n\n第二项释义";
assert.equal(selected(), selectedText);
ranges = [{ startContainer: mark.firstChild, endContainer: bold.firstChild }];
selectedText = "bank is open.\n第二项释义 bold";
assert.equal(selected(), selectedText);
ranges = [{ startContainer: code.firstChild, endContainer: code.firstChild }];
selectedText = "bank()";
assert.equal(selected(), selectedText);
// Range text serialization must not replace the browser's visible selection.
ranges = [
  {
    startContainer: first.firstChild,
    endContainer: second.firstChild,
    toString: () => "The bank is open.第二项释义",
  } as RangeEnds,
];
selectedText = "The bank is open.\n\n第二项释义";
assert.equal(selected(), selectedText);
ranges = [
  { startContainer: first.firstChild, endContainer: mark.firstChild },
  { startContainer: second.firstChild, endContainer: second.firstChild },
];
selectedText = "The bank\n第二项释义";
assert.equal(selected(), selectedText);
ranges = [{ startContainer: root, endContainer: second }];
selectedText = "  Original \n whitespace and <script>literal text</script>  ";
assert.equal(selected(), selectedText);
collapsed = true;
assert.equal(selected(), "");
collapsed = false;
for (const outside of [toolbar, query, editor, pdf]) {
  ranges = [{ startContainer: first.firstChild, endContainer: outside }];
  assert.equal(selected(), "");
  ranges = [{ startContainer: outside, endContainer: second.firstChild }];
  assert.equal(selected(), "");
  ranges = [{ startContainer: outside, endContainer: outside }];
  assert.equal(selected(), "");
  ranges = [
    { startContainer: first.firstChild, endContainer: mark.firstChild },
    { startContainer: outside, endContainer: outside },
  ];
  assert.equal(selected(), "");
}
const interactive = root.querySelectorAll(
  'button,select,input,textarea,a,summary,[role="button"],[contenteditable="true"]',
);
for (const control of interactive) {
  const endpoints = [control, control.lastChild].filter(Boolean);
  if (control.querySelector("span,strong,option")) {
    endpoints.push(control.querySelector("span,strong,option")!.firstChild);
  }
  for (const endpoint of endpoints) {
    ranges = [{ startContainer: endpoint, endContainer: second.firstChild }];
    assert.equal(selected(), "");
    ranges = [{ startContainer: first.firstChild, endContainer: endpoint }];
    assert.equal(selected(), "");
  }
}
const otherDoc = new DOMParser().parseFromString(
  "<html><body>Another reader</body></html>",
  "text/html",
);
assert.equal(getSelectedTranslationText(otherDoc as never, root as never), "");
Object.assign(doc, { getSelection: () => null });
assert.equal(selected(), "");
Object.assign(doc, {
  getSelection: () => {
    throw new Error("Reader closed");
  },
});
assert.equal(selected(), "");
Object.assign(doc, {
  getSelection: () => ({
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => {
      throw new Error("Selection changed");
    },
  }),
});
assert.equal(selected(), "");

console.log(
  "Annotation draft: repeated selections, editable fragments, explicit empty drafts, visible line breaks and translation-only noninteractive ranges passed",
);
