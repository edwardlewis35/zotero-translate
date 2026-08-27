import { config, PREFERENCE_PANE_ID } from "./config";
import { LocalDictionaryService } from "./dictionary/service";
import { PreferencesController } from "./preferences";
import { ReaderIntegration } from "./reader";

const MENU_ID = "lexiflowdicttranslator-tools-menu";

export class LexiFlowDictTranslatorAddon {
  readonly dictionaries = new LocalDictionaryService();
  readonly preferences = new PreferencesController(this.dictionaries);
  readonly reader = new ReaderIntegration(
    this.dictionaries,
    () => this.preferences.open(),
    config.addonID,
  );
  private started = false;
  private preferencePaneRegistered = false;

  async startup(): Promise<void> {
    if (this.started) return;
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);

    await Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      id: PREFERENCE_PANE_ID,
      src: rootURI + "chrome/content/preferences.xhtml",
      label: "LexiFlow 词典翻译",
      image: rootURI + "chrome/content/icons/icon.svg",
      stylesheets: [rootURI + "chrome/content/preferences.css"],
    });
    this.preferencePaneRegistered = true;
    this.reader.register();
    this.started = true;
    await Promise.all(
      Zotero.getMainWindows().map((window) => this.onMainWindowLoad(window)),
    );
  }

  async onMainWindowLoad(window: Window): Promise<void> {
    await Zotero.uiReadyPromise;
    const doc = window.document;
    if (doc.getElementById(MENU_ID)) return;
    const toolsPopup = doc.getElementById("menu_ToolsPopup");
    if (!toolsPopup) return;
    const menuItem = (
      doc as Document & {
        createXULElement(tagName: string): Element;
      }
    ).createXULElement("menuitem");
    menuItem.id = MENU_ID;
    menuItem.setAttribute("label", "LexiFlow 词典翻译设置…");
    menuItem.addEventListener("command", () => this.preferences.open());
    toolsPopup.append(menuItem);
  }

  async onMainWindowUnload(window: Window): Promise<void> {
    window.document.getElementById(MENU_ID)?.remove();
  }

  shutdown(): void {
    if (this.started) {
      this.reader.unregister();
    }
    this.dictionaries.reset();
    for (const window of Zotero.getMainWindows()) {
      void this.onMainWindowUnload(window);
    }
    if (this.preferencePaneRegistered) {
      Zotero.PreferencePanes.unregister(PREFERENCE_PANE_ID);
    }
    this.preferencePaneRegistered = false;
    this.started = false;
  }
}
