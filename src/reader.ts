import {
  saveTranslationAnnotation,
  snapshotTranslationSelection,
  type TranslationSelectionSnapshot,
} from "./annotation";
import type { LocalDictionaryService } from "./dictionary/service";
import { TranslationCard } from "./ui/card";

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

  constructor(
    private readonly dictionaries: LocalDictionaryService,
    private readonly openSettings: () => void,
    private readonly pluginID: string,
  ) {
    this.handler = (event) => {
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
      this.integrateWithSelectionPopup(event.doc);
      event.append(card.root);
      card.start();
    };
  }

  private integrateWithSelectionPopup(doc: Document): void {
    const popup = doc.querySelector<HTMLElement>(".selection-popup");
    if (!popup) return;
    popup.classList.add("lft-selection-popup");
    popup.style.maxWidth = "none";

    const colors = popup.querySelector<HTMLElement>(".colors");
    if (colors) {
      colors.style.width = "100%";
      colors.style.justifyContent = "space-evenly";
    }
  }

  register(): void {
    Zotero.Reader.registerEventListener(
      "renderTextSelectionPopup",
      this.handler,
      this.pluginID,
    );
  }

  unregister(): void {
    Zotero.Reader.unregisterEventListener(
      "renderTextSelectionPopup",
      this.handler,
    );
  }
}
