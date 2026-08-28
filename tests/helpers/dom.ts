// A small deterministic DOM double for lifecycle tests, not a layout engine.
// Browser/Zotero visual checks must be reported separately from these tests.
export class TestElement extends EventTarget {
  children: TestElement[] = [];
  parentElement: TestElement | null = null;
  className = "";
  id = "";
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  value = "";
  hidden = false;
  disabled = false;
  checked = false;
  open = false;
  type = "";
  title = "";
  dir = "";
  scrollTop = 0;
  scrollHeight = 400;
  clientHeight = 400;
  style: Record<string, unknown> = { setProperty() {}, removeProperty() {} };
  private ownText = "";
  constructor(
    readonly ownerDocument: TestDocument,
    readonly tagName: string,
    readonly namespaceURI: string,
  ) {
    super();
  }
  classList = {
    contains: (name: string) => this.className.split(/\s+/u).includes(name),
    add: (...names: string[]) => {
      this.className = [
        ...new Set([...this.className.split(/\s+/u).filter(Boolean), ...names]),
      ].join(" ");
    },
    remove: (...names: string[]) => {
      this.className = this.className
        .split(/\s+/u)
        .filter((name) => !names.includes(name))
        .join(" ");
    },
    toggle: (name: string, force = !this.classList.contains(name)) => {
      if (force) this.classList.add(name);
      else this.classList.remove(name);
      return force;
    },
  };
  get isConnected(): boolean {
    return (
      this === this.ownerDocument.documentElement ||
      !!this.parentElement?.isConnected
    );
  }
  get textContent(): string {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }
  set textContent(text: string) {
    this.replaceChildren();
    this.ownText = text;
  }
  append(...nodes: (TestElement | string)[]): void {
    for (const node of nodes) {
      const child =
        typeof node === "string"
          ? this.ownerDocument.createElement("#text")
          : node;
      if (typeof node === "string") child.textContent = node;
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  appendChild(node: TestElement): TestElement {
    this.append(node);
    return node;
  }
  prepend(node: TestElement): void {
    node.remove();
    node.parentElement = this;
    this.children.unshift(node);
  }
  replaceChildren(...nodes: TestElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.ownText = "";
    this.append(...nodes);
  }
  remove(): void {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter(
        (child) => child !== this,
      );
    this.parentElement = null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") this.id = value;
    if (name === "class") this.className = value;
    if (name.startsWith("data-"))
      this.dataset[
        name
          .slice(5)
          .replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase())
      ] = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  matches(selector: string): boolean {
    if (selector.includes(","))
      return selector.split(",").some((part) => this.matches(part.trim()));
    if (selector.startsWith("."))
      return selector
        .slice(1)
        .split(".")
        .every((part) => this.classList.contains(part));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    const match = selector.match(/^([^\[]*)\[([^=]+)="([^"]*)"\]$/u);
    if (match)
      return (
        (!match[1] || this.tagName === match[1]) &&
        this.getAttribute(match[2]) === match[3]
      );
    return this.tagName === selector;
  }
  querySelectorAll(selector: string): TestElement[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): TestElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }
  closest(selector: string): TestElement | null {
    return this.matches(selector)
      ? this
      : this.parentElement?.closest(selector) || null;
  }
  click(): void {
    if (!this.disabled)
      this.dispatchEvent(new Event("click", { cancelable: true }));
  }
  focus(): void {}
}

export class TestDocument extends EventTarget {
  readonly documentElement = new TestElement(
    this,
    "html",
    "http://www.w3.org/1999/xhtml",
  );
  readonly head = new TestElement(this, "head", "http://www.w3.org/1999/xhtml");
  readonly defaultView = Object.assign(new EventTarget(), {
    document: this,
    closed: false,
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    alert: (_message: string) => {},
  });
  constructor() {
    super();
    this.documentElement.append(this.head);
  }
  createElement(tag: string): TestElement {
    return new TestElement(this, tag, this.documentElement.namespaceURI);
  }
  createElementNS(namespace: string, tag: string): TestElement {
    return new TestElement(this, tag, namespace);
  }
  querySelectorAll(selector: string): TestElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
  querySelector(selector: string): TestElement | null {
    return this.documentElement.querySelector(selector);
  }
  getElementById(id: string): TestElement | null {
    return this.querySelector(`#${id}`);
  }
}
