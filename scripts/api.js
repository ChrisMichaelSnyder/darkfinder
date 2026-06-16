const MODULE_ID = "darkfinder";

const launcherState = {
  cache: new Map(),
};

function getModuleBasePath() {
  return `/modules/${MODULE_ID}`;
}

function getMacroUrl(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return `${getModuleBasePath()}/${normalized}`;
}

async function loadMacroSource(relativePath) {
  const cacheKey = String(relativePath || "");
  if (launcherState.cache.has(cacheKey)) return launcherState.cache.get(cacheKey);

  const response = await fetch(getMacroUrl(relativePath), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load Darkfinder script "${relativePath}" (${response.status}).`);
  }

  const source = await response.text();
  launcherState.cache.set(cacheKey, source);
  return source;
}

async function executeMacroFile(relativePath, thisArg = null, scopeData = {}) {
  const source = await loadMacroSource(relativePath);
  const AsyncFunction = async function () {}.constructor;
  const runner = new AsyncFunction("scope", source);
  return runner.call(thisArg, scopeData || {});
}

function getPack(packName) {
  return game.packs.get(`${MODULE_ID}.${packName}`) || null;
}

function registerApi() {
  const module = game.modules.get(MODULE_ID);
  if (!module) {
    console.warn(`${MODULE_ID} | Module package was not found while registering the API.`);
    return null;
  }

  const api = {
    moduleId: MODULE_ID,
    getModuleBasePath,
    getMacroUrl,
    getPack,
    executeMacroFile,
  };

  module.api = api;
  globalThis.Darkfinder = api;
  return api;
}

export {
  MODULE_ID,
  executeMacroFile,
  getMacroUrl,
  getModuleBasePath,
  getPack,
  registerApi,
};
