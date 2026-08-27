export interface TranslationAnnotationContext {
  reader: _ZoteroTypes.ReaderInstance;
  selection: _ZoteroTypes.Annotations.AnnotationJson;
}

function clonePosition(
  position: _ZoteroTypes.Annotations.AnnotationJson["position"],
): _ZoteroTypes.Annotations.AnnotationJson["position"] {
  return JSON.parse(JSON.stringify(position)) as typeof position;
}

/** Create a real Zotero highlight whose annotation comment is the translation. */
export async function saveTranslationAnnotation(
  context: TranslationAnnotationContext,
  translation: string,
): Promise<Zotero.Item> {
  const itemID = context.reader.itemID;
  if (!itemID) throw new Error("无法确定当前 PDF 附件");
  const attachment = Zotero.Items.get(itemID);
  if (!attachment) throw new Error("当前 PDF 附件不存在");
  if (!context.selection.position) throw new Error("当前选择缺少页面坐标");

  const key = Zotero.DataObjectUtilities.generateKey();
  const annotation: _ZoteroTypes.Annotations.AnnotationJson = {
    id: key,
    key,
    libraryID: attachment.libraryID,
    type: "highlight",
    text: context.selection.text || "",
    comment: translation.trim(),
    color: context.selection.color || Zotero.Annotations.DEFAULT_COLOR,
    pageLabel: context.selection.pageLabel || "",
    sortIndex: context.selection.sortIndex || "",
    position: clonePosition(context.selection.position),
    readOnly: false,
    dateModified: new Date().toISOString(),
  };

  const item = await Zotero.Annotations.saveFromJSON(attachment, annotation);
  await Promise.resolve(context.reader.setAnnotations([item]));
  return item;
}
