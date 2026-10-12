export interface FloatingCard {
  root: HTMLElement;
  dispose(): void;
}

export interface FloatingPosition {
  left: number;
  top: number;
}

/** A Reader-owned overlay that never participates in selection-popup layout. */
export class FloatingTranslationWindow {
  readonly root: HTMLDivElement;
  private readonly win: Window;
  private card?: FloatingCard;
  private disposed = false;
  private point: FloatingPosition;
  private drag?: {
    pointerID: number;
    x: number;
    y: number;
    left: number;
    top: number;
  };

  constructor(
    private readonly doc: Document,
    position?: FloatingPosition,
  ) {
    const win = doc.defaultView;
    if (!win) throw new Error("阅读器窗口尚未就绪");
    this.win = win;
    this.root = doc.createElement("div");
    this.root.className = "lft-floating-window";
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "词典与翻译浮窗");
    this.point = position || {
      left: Math.max(12, win.innerWidth - 684),
      top: 60,
    };
    (doc.body || doc.documentElement).append(this.root);
    // Capture on the stable outer node: the card stops pointer propagation and
    // replaces its header as streaming text arrives.
    this.root.addEventListener("pointerdown", this.pointerDown, true);
    doc.addEventListener("pointermove", this.pointerMove, true);
    doc.addEventListener("pointerup", this.pointerUp, true);
    doc.addEventListener("pointercancel", this.pointerUp, true);
    this.root.addEventListener("lostpointercapture", this.pointerUp);
    win.addEventListener("resize", this.fit);
    this.fit();
  }

  get position(): FloatingPosition {
    return { ...this.point };
  }

  show(card: FloatingCard): void {
    if (this.disposed) {
      card.dispose();
      return;
    }
    this.card?.dispose();
    this.card = card;
    this.root.replaceChildren(card.root);
    this.fit();
  }

  private fit = (): void => {
    if (this.disposed) return;
    const width = Math.min(660, Math.max(0, this.win.innerWidth - 24));
    this.root.style.width = `${width}px`;
    this.root.style.maxHeight = `${Math.max(0, this.win.innerHeight - 24)}px`;
    this.point.left = Math.max(
      12,
      Math.min(this.point.left, this.win.innerWidth - width - 12),
    );
    // Reserve enough room for the toolbar and content instead of snapping the
    // panel upwards whenever dictionary/streaming content grows.
    this.point.top = Math.max(
      12,
      Math.min(this.point.top, Math.max(12, this.win.innerHeight - 172)),
    );
    this.root.style.left = `${this.point.left}px`;
    this.root.style.top = `${this.point.top}px`;
    this.root.style.maxHeight = `${Math.max(0, this.win.innerHeight - this.point.top - 12)}px`;
  };

  private pointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.button !== 0 || event.isPrimary === false)
      return;
    const target = event.target as Element | null;
    if (
      !target?.closest?.(".lft-card-header") ||
      target.closest(
        "button, select, input, textarea, a, label, [contenteditable], [role=button]",
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    this.drag = {
      pointerID: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ...this.point,
    };
    this.root.classList.add("lft-floating-dragging");
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      // Programmatic events lack an active pointer; document listeners still
      // cover this case and hosts with unavailable pointer capture.
    }
  };

  private pointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerID || this.disposed) return;
    event.preventDefault();
    event.stopPropagation();
    this.point = {
      left: drag.left + event.clientX - drag.x,
      top: drag.top + event.clientY - drag.y,
    };
    this.fit();
  };

  private pointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerID) return;
    this.drag = undefined;
    this.root.classList.remove("lft-floating-dragging");
    try {
      if (this.root.hasPointerCapture(event.pointerId))
        this.root.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already have been released by the host.
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.drag = undefined;
    this.card?.dispose();
    this.card = undefined;
    this.root.removeEventListener("pointerdown", this.pointerDown, true);
    this.doc.removeEventListener("pointermove", this.pointerMove, true);
    this.doc.removeEventListener("pointerup", this.pointerUp, true);
    this.doc.removeEventListener("pointercancel", this.pointerUp, true);
    this.root.removeEventListener("lostpointercapture", this.pointerUp);
    this.win.removeEventListener("resize", this.fit);
    this.root.remove();
  }
}
