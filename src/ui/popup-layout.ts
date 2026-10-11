type PopupWindow = Window & {
  ResizeObserver: typeof ResizeObserver;
  MutationObserver: typeof MutationObserver;
};

/** Constrain asynchronous plugin content without changing Reader positioning. */
export function watchSelectionPopupLayout(
  doc: Document,
  card: HTMLElement,
  onDispose?: (dispose: () => void) => void,
): () => void {
  const candidateWindow = doc.defaultView as PopupWindow | null;
  if (!candidateWindow) return () => {};
  const win = candidateWindow;
  let disposed = false;
  let attached = false;
  let popup: HTMLElement | null = null;
  let section: HTMLElement | null = null;
  let mutationTarget: Node | null = null;
  let lastHeight = "";
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;
  let listeningForResize = false;
  let listeningForPageHide = false;

  const observerOptions = (options: MutationObserverInit) =>
    typeof Components !== "undefined"
      ? Components.utils.cloneInto(options, win)
      : options;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    if (listeningForResize) win.removeEventListener("resize", update);
    if (listeningForPageHide) win.removeEventListener("pagehide", dispose);
    const hasReplacement = (element: HTMLElement) =>
      Array.from(element.querySelectorAll(".lft-card")).some(
        (node) => node && node !== card,
      );
    if (section && !hasReplacement(section))
      section.classList.remove("lft-popup-section");
    // A React redraw can replace this card before its removal observer runs.
    // Leave the shared popup styling to a replacement card in that case.
    if (popup && !hasReplacement(popup)) {
      popup.classList.remove("lft-selection-popup");
      popup.style.removeProperty("--lft-popup-max-height");
    }
    onDispose?.(dispose);
  };

  function update(): void {
    if (disposed) return;
    if (!card.isConnected) {
      if (attached) dispose();
      return;
    }
    attached = true;
    const currentPopup = card.closest<HTMLElement>(".selection-popup");
    if (!currentPopup) return;
    // Reader's React render owns className and can replace it on this same
    // element. Restore our marker only when missing, without mutation loops.
    if (!currentPopup.classList.contains("lft-selection-popup"))
      currentPopup.classList.add("lft-selection-popup");
    if (popup !== currentPopup) {
      resizeObserver?.disconnect();
      popup = currentPopup;
      section = card.closest<HTMLElement>(".section");
      section?.classList.add("lft-popup-section");
      lastHeight = "";
      resizeObserver?.observe(popup);
      const pane = popup.closest<HTMLElement>(".primary-view");
      const parent = popup.parentElement;
      if (pane) resizeObserver?.observe(pane);
      if (parent && parent !== pane) resizeObserver?.observe(parent);
      // Continue watching the connected parent so closing/replacing the native
      // popup disposes observers instead of keeping the Reader document alive.
      const target = popup.parentNode || doc.body || doc.documentElement;
      if (mutationTarget !== target) {
        mutationObserver?.disconnect();
        mutationObserver?.observe(
          target,
          observerOptions({
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["style", "class"],
          }),
        );
        mutationTarget = target;
      }
    }
    const pane = popup.closest<HTMLElement>(".primary-view");
    const bottom = Math.min(
      pane?.getBoundingClientRect().bottom ?? win.innerHeight,
      win.innerHeight,
    );
    const available = Math.max(
      0,
      Math.floor(bottom - popup.getBoundingClientRect().top - 12),
    );
    const height = `${available}px`;
    if (height !== lastHeight) {
      lastHeight = height;
      popup.style.setProperty("--lft-popup-max-height", height);
    }
  }

  try {
    resizeObserver = new win.ResizeObserver(update);
    mutationObserver = new win.MutationObserver(update);
    mutationTarget = doc.body || doc.documentElement;
    mutationObserver.observe(
      mutationTarget,
      observerOptions({ childList: true, subtree: true }),
    );
    win.addEventListener("resize", update);
    listeningForResize = true;
    win.addEventListener("pagehide", dispose);
    listeningForPageHide = true;
    update();
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
