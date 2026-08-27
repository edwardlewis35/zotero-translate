declare const rootURI: string;

declare const _globalThis: {
  addonStartupPromise?: Promise<void>;
  [key: string]: unknown;
};

declare namespace Zotero {
  const DataObjectUtilities: {
    generateKey(): string;
  };
}
