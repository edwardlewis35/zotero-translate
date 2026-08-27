var chromeHandle;

function install(data, reason) {}

async function startup({ resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise;
  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  const startupService = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  chromeHandle = startupService.registerChrome(
    Services.io.newURI(rootURI + "manifest.json"),
    [["content", "__addonRef__", rootURI + "chrome/content/"]],
  );

  const context = {
    rootURI,
    Zotero,
    Services,
    Components,
    Cc,
    Ci,
    IOUtils,
    PathUtils,
    ChromeUtils,
  };
  context._globalThis = context;

  Services.scriptloader.loadSubScript(
    rootURI + "chrome/content/scripts/__addonRef__.js",
    context,
  );
  await context.addonStartupPromise;
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.onMainWindowUnload(window);
}

function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  Zotero.__addonInstance__?.shutdown();
  delete Zotero.__addonInstance__;

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}
