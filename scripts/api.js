const MODULE_ID = "darkfinder";

const launcherState = {
  cache: new Map(),
};

const MODULE_FLAG_SCOPE = MODULE_ID;
const MODULE_MACRO_FOLDER_NAME = "Darkfinder";
const MODULE_MACRO_SPECS = [
  {
    name: "Spellcrafting",
    img: "icons/sundries/books/book-backed-silver-gold.webp",
    command: 'game.modules.get("darkfinder")?.api?.openSpellcrafting();',
    legacyNames: ["Darkfinder: Spellcrafting"],
  },
  {
    name: "Spell Attack",
    img: "icons/svg/dice-target.svg",
    command: 'game.modules.get("darkfinder")?.api?.runSpellAttack();',
    legacyNames: ["Darkfinder: Spell Attack"],
  },
  {
    name: "Endurance Check",
    img: "icons/magic/control/buff-strength-muscle-damage-orange.webp",
    command: 'game.modules.get("darkfinder")?.api?.runCheckEndurance();',
    legacyNames: ["Darkfinder: Check Endurance"],
  },
  {
    name: "Resolve Check",
    img: "systems/pf1/icons/skills/blood_04.jpg",
    command: 'game.modules.get("darkfinder")?.api?.runCheckResolve();',
    legacyNames: ["Darkfinder: Check Resolve"],
  },
  {
    name: "Sanity Check",
    img: "icons/commodities/biological/organ-brain-pink-purple.webp",
    command: 'game.modules.get("darkfinder")?.api?.runCheckSanity();',
    legacyNames: ["Darkfinder: Check Sanity"],
  },
  {
    name: "Reload Firearm",
    img: "icons/weapons/guns/gun-pistol-flintlock-white.webp",
    command: 'game.modules.get("darkfinder")?.api?.runReloadFirearm();',
    legacyNames: ["Darkfinder: Reload Firearm"],
  },
  {
    name: "Short Rest",
    img: "systems/pf1/icons/skills/green_19.jpg",
    command: 'game.modules.get("darkfinder")?.api?.runShortRest();',
    legacyNames: ["Darkfinder: Short Rest"],
  },
];

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

function getManagedMacroFlagData(spec) {
  return {
    managed: true,
    launcher: true,
    macroName: spec.name,
  };
}

function getExistingManagedMacros() {
  return (game.macros || []).filter((macro) => (
    macro?.type === "script"
    && macro?.getFlag?.(MODULE_FLAG_SCOPE, "managed") === true
  ));
}

async function ensureMacroFolder() {
  const existingFolder = (game.folders || []).find((folder) => (
    folder?.type === "Macro" && folder?.name === MODULE_MACRO_FOLDER_NAME
  ));
  if (existingFolder) return existingFolder;

  return Folder.create({
    name: MODULE_MACRO_FOLDER_NAME,
    type: "Macro",
    color: "#7a6f54",
  });
}

async function installWorldMacros({ notify = false } = {}) {
  if (!game.user?.isGM) {
    throw new Error("Only a GM can install Darkfinder world macros.");
  }

  const folder = await ensureMacroFolder();
  const existingMacros = new Map((game.macros || []).map((macro) => [macro.name, macro]));
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const spec of MODULE_MACRO_SPECS) {
    const legacyMatches = (spec.legacyNames || [])
      .map((legacyName) => existingMacros.get(legacyName))
      .filter(Boolean);
    const existing = existingMacros.get(spec.name) || legacyMatches[0] || null;
    const baseData = {
      name: spec.name,
      type: "script",
      img: spec.img,
      command: spec.command,
      folder: folder?.id || null,
      ownership: {
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
      },
      flags: {
        [MODULE_FLAG_SCOPE]: getManagedMacroFlagData(spec),
      },
    };

    if (!existing) {
      await Macro.create(baseData);
      createdCount += 1;
      continue;
    }

    const isManagedMacro = existing.getFlag?.(MODULE_FLAG_SCOPE, "managed") === true;
    if (!isManagedMacro) {
      skippedCount += 1;
      continue;
    }

    await existing.update(baseData);
    for (const legacyMacro of legacyMatches) {
      if (legacyMacro.id === existing.id) continue;
      await legacyMacro.delete();
    }
    updatedCount += 1;
  }

  if (notify) {
    const summary = [
      createdCount ? `${createdCount} created` : "",
      updatedCount ? `${updatedCount} updated` : "",
      skippedCount ? `${skippedCount} skipped` : "",
    ].filter(Boolean).join(", ");
    ui.notifications.info(summary
      ? `Darkfinder macros synced: ${summary}.`
      : "Darkfinder macros were already up to date.");
  }

  return {
    createdCount,
    updatedCount,
    skippedCount,
    totalManagedMacros: getExistingManagedMacros().length,
  };
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
    installWorldMacros,
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
  installWorldMacros,
  openSpellcrafting,
  registerApi,
  runSpellAttack,
  runCheckEndurance,
  runCheckResolve,
  runCheckSanity,
  runReloadFirearm,
  runShortRest,
};
