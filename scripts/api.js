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

async function executeMacroFile(relativePath, thisArg = null) {
  const source = await loadMacroSource(relativePath);
  const AsyncFunction = async function () {}.constructor;
  const runner = new AsyncFunction(source);
  return runner.call(thisArg);
}

function getPack(packName) {
  return game.packs.get(`${MODULE_ID}.${packName}`) || null;
}

async function openSpellcrafting() {
  return executeMacroFile("macros/module/spell-crafter/spellcrafting-ui-macro.js");
}

async function runSpellAttack() {
  return executeMacroFile("macros/module/spell-crafter/spell-attack.js");
}

async function runCheckEndurance() {
  return executeMacroFile("macros/module/check-endurance/check-endurance.js");
}

async function runCheckResolve() {
  return executeMacroFile("macros/module/check-resolve/check-resolve.js");
}

async function runCheckSanity() {
  return executeMacroFile("macros/module/check-sanity/check-sanity.js");
}

async function runReloadFirearm() {
  return executeMacroFile("macros/module/reload-firearm/reload-firearm.js");
}

async function runShortRest() {
  return executeMacroFile("macros/module/short-rest/short-rest.js");
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
    openSpellcrafting,
    runSpellAttack,
    runCheckEndurance,
    runCheckResolve,
    runCheckSanity,
    runReloadFirearm,
    runShortRest,
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
  openSpellcrafting,
  registerApi,
  runSpellAttack,
  runCheckEndurance,
  runCheckResolve,
  runCheckSanity,
  runReloadFirearm,
  runShortRest,
};
