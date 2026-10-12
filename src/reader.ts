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
  refreshDocuments: () => void;
  cleanup: (() => void)[];
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
      if (state.selectionKey === key) return;
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
            state.position = panel.position;
            panel.dispose();
            state.panel = undefined;
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
    const allowReselection = (event: Event) => {
      const target = event.target as Element | null;
      if (
        target?.closest?.(".lft-floating-window, .selection-popup") ||
        (event as PointerEvent).button > 0
      )
        return;
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
      }
      // PDF iframe pointer events do not bubble into the Reader document.
      // A fresh gesture permits reopening the same word after closing it.
      state.selectionKey = undefined;
    };
    const bindDocument = (current: Document) => {
      if (!seen.has(current)) {
        seen.add(current);
        for (const type of ["pointerdown", "keydown"]) {
          current.addEventListener(type, allowReselection, true);
          state.cleanup.push(() =>
            current.removeEventListener(type, allowReselection, true),
          );
        }
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

  private disposeWindow(state: ReaderWindowState): void {
    state.panel?.dispose();
    state.panel = undefined;
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
