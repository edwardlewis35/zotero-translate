import { LexiFlowDictTranslatorAddon } from "./addon";
import { config } from "./config";

const instance = new LexiFlowDictTranslatorAddon();
(Zotero as unknown as Record<string, unknown>)[config.addonInstance] = instance;
_globalThis.addonStartupPromise = instance.startup();
