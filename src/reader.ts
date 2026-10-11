import {
  saveTranslationAnnotation,
  snapshotTranslationSelection,
  type TranslationSelectionSnapshot,
} from "./annotation";
import type { LocalDictionaryService } from "./dictionary/service";
import { TranslationCard } from "./ui/card";
import { watchSelectionPopupLayout } from "./ui/popup-layout";

export function isSingleWord(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/\u00ad/gu, "")
    .replace(/^[\p{P}\p{Z}]+|[\p{P}\p{Z}]+$/gu, "");
  return (
    normalized.length > 0 &&
    normalized.length <= 80 &&
    /^[\p{L}\p{M}][\p{L}\p{M}\p{N}'’.-]*$/u.test(normalized)
  );
}

export class ReaderIntegration {
  private readonly handler: _ZoteroTypes.Reader.EventHandler<"renderTextSelectionPopup">;
  private registered = false;
  private active = false;
  private readonly popupLayouts = new Set<() => void>();

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
        // Capture reader-owned values before the asynchronous dictionary/LLM
        // request. Retaining event.params.annotation directly is unsafe once
        // the native selection popup changes or closes.
        selection = snapshotTranslationSelection(event.params.annotation);
      } catch (error) {
        Zotero.logError(error as Error);
      }
      const card = new TranslationCard(
        event.doc,
        text,
        isSingleWord(text),
        this.dictionaries,
        this.openSettings,
        attachmentItemID && selection
          ? (translation) =>
              saveTranslationAnnotation(
                {
                  reader: event.reader,
                  attachmentItemID,
                  selection,
                },
                translation,
              ).then(() => undefined)
          : undefined,
      );
      event.append(card.root);
      try {
        const disposeLayout = watchSelectionPopupLayout(
          event.doc,
          card.root,
          (dispose) => this.popupLayouts.delete(dispose),
        );
        this.popupLayouts.add(disposeLayout);
      } catch (error) {
        // Optional layout integration must never prevent lookup/translation.
        Zotero.logError(error as Error);
      }
      card.start();
    };
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
    for (const dispose of this.popupLayouts) dispose();
    this.popupLayouts.clear();
    // Zotero removes listeners by pluginID when the plugin shuts down.
    // Its Zotero 9 unregisterEventListener() can remove other plugins' listeners,
    // so deactivate immediately and leave removal to the host's lifecycle.
  }
}
