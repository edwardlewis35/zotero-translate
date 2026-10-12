import {
  saveTranslationAnnotation,
  snapshotTranslationSelection,
  type TranslationSelectionSnapshot,
} from "./annotation";
import type { LocalDictionaryService } from "./dictionary/service";
import { isSingleWord } from "./selection";
import { TranslationCard } from "./ui/card";
import {
  FloatingTranslationWindow,
  type FloatingPosition,
} from "./ui/floating-window";

export { isSingleWord } from "./selection";

interface ReaderWindowState {
  doc: Document;
  panel?: FloatingTranslationWindow;
  position?: FloatingPosition;
  selectionKey?: string;
  gesture?: {
    doc: Document;
    initial?: ReaderSelectionState;
    changed: boolean;
    selecting: boolean;
    pointer?: { id: number; x: number; y: number };
  };
  refreshDocuments: () => void;
  cleanup: (() => void)[];
}

interface ReaderSelectionState {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
  text: string;
  collapsed: boolean;
}

function selectionText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function readSelection(doc: Document): ReaderSelectionState | undefined {
  try {
    const selection = doc.getSelection?.();
    if (!selection) return undefined;
    return {
      anchorNode: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode,
      focusOffset: selection.focusOffset,
      text: selectionText(selection.toString()),
      collapsed: selection.isCollapsed,
    };
  } catch {
    return undefined;
  }
}

function sameSelection(
  first: ReaderSelectionState | undefined,
  second: ReaderSelectionState | undefined,
): boolean {
  if (!first || !second) return first === second;
  return (
    first.anchorNode === second.anchorNode &&
    first.anchorOffset === second.anchorOffset &&
    first.focusNode === second.focusNode &&
    first.focusOffset === second.focusOffset &&
    first.text === second.text &&
    first.collapsed === second.collapsed
  );
}

export class ReaderIntegration {
  private readonly handler: _ZoteroTypes.Reader.EventHandler<"renderTextSelectionPopup">;
  private registered = false;
  private active = false;
  private readonly windows = new Map<Document, ReaderWindowState>();

  constructor(
    private readonly dictionaries: LocalDictionaryService,
    private readonly openSettings: () => void,
    private readonly pluginID: string,
  ) {
    this.handler = (event) => {
      if (!this.active) return;
      const text = String(event.params.annotation.text || "").trim();
      if (!text) return;
      const attachmentItemID = event.reader.itemID;
      let selection: TranslationSelectionSnapshot | undefined;
      try {
        // Preserve PDF coordinates after the native popup closes or scrolls.
        selection = snapshotTranslationSelection(event.params.annotation);
      } catch (error) {
        Zotero.logError(error as Error);
      }
      const state = this.windowState(event.doc);
      const key = JSON.stringify([
        attachmentItemID,
        text,
        selection?.position,
        selection?.sortIndex,
      ]);
      // Native redraws must neither restart a request nor reopen a closed panel.
      if (state.selectionKey === key) {
        const gesture = state.gesture;
        const current = gesture && readSelection(gesture.doc);
        if (
          !gesture ||
          (!gesture.selecting &&
            (!gesture.changed ||
              !current ||
              current.collapsed ||
              !current.text ||
              current.text !== selectionText(text)))
        )
          return;
      }
      state.gesture = undefined;
      state.selectionKey = key;
      try {
        const panel =
          state.panel ||
          new FloatingTranslationWindow(event.doc, state.position);
        state.panel = panel;
        const card = new TranslationCard(
          event.doc,
          text,
          isSingleWord(text),
          this.dictionaries,
          this.openSettings,
          attachmentItemID && selection
            ? (translation) =>
                saveTranslationAnnotation(
                  { reader: event.reader, attachmentItemID, selection },
                  translation,
                ).then(() => undefined)
            : undefined,
          () => {
            state.gesture = undefined;
            this.closePanel(state);
          },
        );
        panel.show(card);
        // Do not event.append(): translation height must not enter native
        // selection-popup geometry or cause the PDF view to move.
        card.start();
      } catch (error) {
        state.panel?.dispose();
        state.panel = undefined;
        state.selectionKey = undefined;
        Zotero.logError(error as Error);
      }
    };
  }

  private windowState(doc: Document): ReaderWindowState {
    const existing = this.windows.get(doc);
    if (existing) {
      existing.refreshDocuments();
      return existing;
    }
    const state: ReaderWindowState = {
      doc,
      cleanup: [],
      refreshDocuments: () => {},
    };
    this.windows.set(doc, state);
    const seen = new WeakSet<Document>();
    const seenFrames = new WeakSet<HTMLIFrameElement>();
    const selectionGesture = (current: Document, event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.(".lft-floating-window")) return;
      if (event.type === "keydown") {
        const key = event as KeyboardEvent;
        if (
          !(
            key.shiftKey &&
            /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/u.test(key.key)
          ) &&
          !((key.ctrlKey || key.metaKey) && key.key.toLowerCase() === "a")
        )
          return;
      } else {
        const pointer = event as PointerEvent;
        if (pointer.button !== 0 || pointer.isPrimary === false) return;
        // Closing preserves the key so an old native popup redraw cannot
        // immediately reopen the dismissed card. Touch uses this same path.
        this.closePanel(state);
      }
      // PDF iframe pointer events do not bubble into the Reader document.
      // Reopening the identical selection additionally requires evidence that
      // this gesture changed the native text selection, not just a click.
      state.gesture = {
        doc: current,
        initial: readSelection(current),
        changed: false,
        selecting: event.type === "keydown",
        pointer:
          event.type === "pointerdown" &&
          target?.closest?.(".page, .textLayer, #viewerContainer")
            ? {
                id: (event as PointerEvent).pointerId,
                x: (event as PointerEvent).clientX,
                y: (event as PointerEvent).clientY,
              }
            : undefined,
      };
    };
    const bindDocument = (current: Document) => {
      if (!seen.has(current)) {
        seen.add(current);
        const startGesture = (event: Event) => selectionGesture(current, event);
        const selectionPointer = (event: Event) => {
          const gesture = state.gesture;
          if (gesture?.doc !== current || !gesture.pointer) return;
          if (event.type === "mousedown") {
            const mouse = event as MouseEvent;
            if (mouse.button === 0 && mouse.detail >= 2)
              gesture.selecting = true;
          } else {
            const pointer = event as PointerEvent;
            if (
              pointer.pointerId === gesture.pointer.id &&
              (pointer.buttons & 1) !== 0 &&
              Math.hypot(
                pointer.clientX - gesture.pointer.x,
                pointer.clientY - gesture.pointer.y,
              ) >= 3
            )
              gesture.selecting = true;
          }
        };
        const selectionChanged = () => {
          const gesture = state.gesture;
          if (
            gesture?.doc === current &&
            !sameSelection(gesture.initial, readSelection(current))
          )
            gesture.changed = true;
        };
        for (const type of ["pointerdown", "keydown"]) {
          current.addEventListener(type, startGesture, true);
          state.cleanup.push(() =>
            current.removeEventListener(type, startGesture, true),
          );
        }
        // Desktop PDF selections use Zotero's own ranges instead of a DOM
        // Selection. Recognize actual drag/double-click selection gestures;
        // a plain outside click never unlocks a previously dismissed key.
        for (const type of ["pointermove", "mousedown"]) {
          current.addEventListener(type, selectionPointer, true);
          state.cleanup.push(() =>
            current.removeEventListener(type, selectionPointer, true),
          );
        }
        current.addEventListener("selectionchange", selectionChanged);
        state.cleanup.push(() =>
          current.removeEventListener("selectionchange", selectionChanged),
        );
      }
      for (const frame of Array.from(
        current.querySelectorAll("iframe"),
      ) as HTMLIFrameElement[]) {
        const bindFrame = () => {
          try {
            if (frame.contentDocument) bindDocument(frame.contentDocument);
          } catch {
            // Inaccessible embeds are outside Reader's selection UI.
          }
        };
        if (!seenFrames.has(frame)) {
          seenFrames.add(frame);
          frame.addEventListener("load", bindFrame);
          state.cleanup.push(() =>
            frame.removeEventListener("load", bindFrame),
          );
        }
        bindFrame();
      }
    };
    state.refreshDocuments = () => bindDocument(doc);
    state.refreshDocuments();
    const dispose = () => this.disposeWindow(state);
    doc.defaultView?.addEventListener("pagehide", dispose);
    state.cleanup.push(() =>
      doc.defaultView?.removeEventListener("pagehide", dispose),
    );
    return state;
  }

  private closePanel(state: ReaderWindowState): void {
    const panel = state.panel;
    if (!panel) return;
    state.position = panel.position;
    panel.dispose();
    state.panel = undefined;
  }

  private disposeWindow(state: ReaderWindowState): void {
    this.closePanel(state);
    state.gesture = undefined;
    for (const cleanup of state.cleanup.splice(0)) cleanup();
    this.windows.delete(state.doc);
  }

  register(): void {
    if (!this.registered) {
      Zotero.Reader.registerEventListener(
        "renderTextSelectionPopup",
        this.handler,
        this.pluginID,
      );
      this.registered = true;
    }
    this.active = true;
  }

  unregister(): void {
    this.active = false;
    for (const state of this.windows.values()) this.disposeWindow(state);
    // The host removes listeners by pluginID. Zotero 9's unregister API may
    // remove other plugins' listeners, so leave removal to the host lifecycle.
  }
}
