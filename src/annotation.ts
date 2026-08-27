export interface TranslationSelectionSnapshot {
  text: string;
  color: string;
  pageLabel: string;
  sortIndex: string;
  position: _ZoteroTypes.Annotations.AnnotationJson["position"];
}

export interface TranslationAnnotationContext {
  reader: _ZoteroTypes.ReaderInstance;
  attachmentItemID: number;
  selection: TranslationSelectionSnapshot;
}

interface NotifierQueueConstructor {
  new (): _ZoteroTypes.Notifier.Queue;
}

interface NotifierWithQueue extends _ZoteroTypes.Notifier {
  Queue: NotifierQueueConstructor;
}

type SaveOptionsWithQueue = Zotero.DataObject.SaveOptions & {
  notifierQueue: _ZoteroTypes.Notifier.Queue;
};

function clonePosition(
  position: _ZoteroTypes.Annotations.AnnotationJson["position"],
): _ZoteroTypes.Annotations.AnnotationJson["position"] {
  if (!position || typeof position !== "object") {
    throw new Error("当前选择缺少有效的页面坐标");
  }
  return JSON.parse(JSON.stringify(position)) as typeof position;
}

/**
 * Reader event values originate in another window compartment. Copy everything
 * synchronously while the selection popup is alive instead of retaining the
 * event-owned object until an asynchronous LLM request completes.
 */
export function snapshotTranslationSelection(
  selection: _ZoteroTypes.Annotations.AnnotationJson,
): TranslationSelectionSnapshot {
  return {
    text: String(selection.text || ""),
    color: String(selection.color || ""),
    pageLabel: String(selection.pageLabel || ""),
    sortIndex: String(selection.sortIndex || ""),
    position: clonePosition(selection.position),
  };
}

function annotationJSON(
  attachment: Zotero.Item,
  selection: TranslationSelectionSnapshot,
  translation: string,
): _ZoteroTypes.Annotations.AnnotationJson {
  const key = Zotero.DataObjectUtilities.generateKey();
  return {
    id: key,
    key,
    libraryID: attachment.libraryID,
    type: "highlight",
    text: selection.text,
    comment: translation,
    color: selection.color || Zotero.Annotations.DEFAULT_COLOR,
    pageLabel: selection.pageLabel,
    sortIndex: selection.sortIndex,
    position: clonePosition(selection.position),
    readOnly: false,
    dateModified: new Date().toISOString(),
  };
}

function splitIfRequired(
  annotation: _ZoteroTypes.Annotations.AnnotationJson,
): _ZoteroTypes.Annotations.AnnotationJson[] {
  const maxSize = Zotero.Annotations.ANNOTATION_POSITION_MAX_SIZE;
  if (JSON.stringify(annotation.position).length <= maxSize) {
    return [annotation];
  }
  const split = Zotero.Annotations.splitAnnotationJSON(annotation);
  if (split.length === 0) {
    throw new Error("选区跨度过大，无法转换为 Zotero 高亮批注");
  }
  // splitAnnotationJSON() assigns every chunk a new key. Keep the reader-side
  // id in sync as well so an immediate refresh cannot temporarily identify
  // several chunks as the original unsplit annotation.
  return split.map((part) => ({ ...part, id: part.key }));
}

/** Create Zotero highlights whose annotation comment contains the translation. */
export async function saveTranslationAnnotation(
  context: TranslationAnnotationContext,
  translation: string,
): Promise<Zotero.Item[]> {
  const comment = translation.trim();
  if (!comment) throw new Error("没有可写入的翻译内容");

  const attachment = Zotero.Items.get(context.attachmentItemID);
  if (!attachment) throw new Error("当前 PDF 附件不存在");
  if (typeof attachment.isEditable === "function" && !attachment.isEditable()) {
    throw new Error("当前附件所在资料库为只读，无法创建批注");
  }

  const annotations = splitIfRequired(
    annotationJSON(attachment, context.selection, comment),
  );
  const Queue = (Zotero.Notifier as NotifierWithQueue).Queue;
  const notifierQueue = new Queue();
  const savedItems: Zotero.Item[] = [];

  try {
    for (const annotation of annotations) {
      const saveOptions: SaveOptionsWithQueue = {
        notifierQueue,
        notifierData: {
          // Prevent Zotero.Reader's global notifier from adding the same
          // annotation while this reader is explicitly refreshed below.
          instanceID: context.reader._instanceID,
        },
      };
      savedItems.push(
        await Zotero.Annotations.saveFromJSON(
          attachment,
          annotation,
          saveOptions,
        ),
      );
    }
  } finally {
    // Zotero requires every explicit notifier queue to be committed, including
    // when a save fails part-way through.
    await Zotero.Notifier.commit(notifierQueue);
  }

  // Persistence already succeeded at this point. A reader refresh failure must
  // not turn the operation into a false "write failed" result or create
  // duplicates when the user retries.
  try {
    await Promise.resolve(context.reader.setAnnotations(savedItems));
  } catch (error) {
    Zotero.logError(error as Error);
  }

  return savedItems;
}
