/** A deliberately empty edit is still a draft; only reset restores full text. */
export class AnnotationDraft {
  private value = "";
  private explicit = false;
  private readonly fragments = new Set<string>();

  get text(): string {
    return this.value;
  }

  get hasDraft(): boolean {
    return this.explicit;
  }

  addSelection(text: string): boolean {
    const fragment = normalizeLineEndings(text).trim();
    if (!fragment || this.fragments.has(fragment)) return false;
    this.fragments.add(fragment);
    this.value = this.value ? `${this.value}\n\n${fragment}` : fragment;
    this.explicit = true;
    return true;
  }

  setText(text: string): void {
    this.value = normalizeLineEndings(text);
    this.explicit = true;
    for (const fragment of this.fragments) {
      if (!this.value.includes(fragment)) this.fragments.delete(fragment);
    }
  }

  reset(): void {
    this.value = "";
    this.explicit = false;
    this.fragments.clear();
  }
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

function isInteractiveEndpoint(node: Node): boolean {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!element?.closest(
    'button,select,input,textarea,a,summary,audio,video,[contenteditable=""],[contenteditable="true"],[role="button"],[role="link"],[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="switch"]',
  );
}

/** Reject selections crossing the translation boundary, including other ranges. */
export function getSelectedTranslationText(
  doc: Document,
  contentRoot: Node,
): string {
  if (contentRoot.ownerDocument !== doc) return "";
  try {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
    for (let index = 0; index < selection.rangeCount; index++) {
      const range = selection.getRangeAt(index);
      if (
        !contentRoot.contains(range.startContainer) ||
        !contentRoot.contains(range.endContainer) ||
        isInteractiveEndpoint(range.startContainer) ||
        isInteractiveEndpoint(range.endContainer)
      )
        return "";
    }
    return selection.toString();
  } catch {
    // A closing reader or a selection changed during dispatch is not a draft.
    return "";
  }
}
