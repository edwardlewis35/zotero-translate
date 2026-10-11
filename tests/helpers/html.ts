import { DOMParser as TestDOMParser } from "linkedom";

// A lightweight inert DOM for semantic extraction tests. Real Gecko parsing
// and layout are verified separately with the built XPI in Zotero.
export function installHTMLDOM(): void {
  class HTMLDOMParser {
    parseFromString(source: string, type: string) {
      return new TestDOMParser().parseFromString(
        `<html><head></head><body>${source}</body></html>`,
        type as "text/html",
      );
    }
  }
  Object.assign(globalThis, { DOMParser: HTMLDOMParser });
}
