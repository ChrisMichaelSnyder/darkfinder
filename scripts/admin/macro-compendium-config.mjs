import path from "node:path";

const ROOT = process.cwd();

function resolveMacroPath(relativePath) {
  return path.join(ROOT, relativePath.replace(/\//g, path.sep));
}

function createEntry({ id, name, relativePath, img, ownershipDefault }) {
  return {
    id,
    name,
    relativePath,
    img,
    ownershipDefault,
    absolutePath: resolveMacroPath(relativePath),
  };
}

// Default macro icon convention:
// use icons/svg/dice-target.svg for new macros unless a task explicitly picks another icon.

const playerMacros = [
  createEntry({
    id: "dfCarried001",
    name: "Carried Light",
    relativePath: "macros/player-macros/carried-light/carried-light.js",
    img: "icons/sundries/lights/lantern-iron-yellow.webp",
    ownershipDefault: 2,
  }),
  createEntry({
    id: "dfEndurance01",
    name: "Endurance Check",
    relativePath: "macros/player-macros/check-endurance/check-endurance.js",
    img: "icons/magic/control/buff-strength-muscle-damage-orange.webp",
    ownershipDefault: 2,
  }),
  createEntry({
    id: "dfResolve001",
    name: "Resolve Check",
    relativePath: "macros/player-macros/check-resolve/check-resolve.js",
    img: "systems/pf1/icons/skills/blood_04.jpg",
    ownershipDefault: 2,
  }),
  createEntry({
    id: "dfSanity0001",
    name: "Sanity Check",
    relativePath: "macros/player-macros/check-sanity/check-sanity.js",
    img: "icons/commodities/biological/organ-brain-pink-purple.webp",
    ownershipDefault: 2,
  }),
  createEntry({
    id: "dfReload0001",
    name: "Reload Firearm",
    relativePath: "macros/player-macros/reload-firearm/reload-firearm.js",
    img: "icons/weapons/guns/gun-pistol-flintlock-white.webp",
    ownershipDefault: 2,
  }),
  createEntry({
    id: "dfShortRest01",
    name: "Short Rest",
    relativePath: "macros/player-macros/short-rest/short-rest.js",
    img: "systems/pf1/icons/skills/green_19.jpg",
    ownershipDefault: 2,
  }),
  createEntry({
    id: "dfSpellAtk001",
    name: "Spell Attack",
    relativePath: "macros/player-macros/spell-crafter/spell-attack.js",
    img: "icons/skills/targeting/crosshair-bars-yellow.webp",
    ownershipDefault: 2,
  }),
  createEntry({
    id: "dfSpellcraft01",
    name: "Spellcrafting",
    relativePath: "macros/player-macros/spell-crafter/spellcrafting-ui-macro.js",
    img: "icons/sundries/books/book-backed-silver-gold.webp",
    ownershipDefault: 2,
  }),
];

const gmMacros = [
  createEntry({
    id: "dfInitFix001",
    name: "Initiative Fix",
    relativePath: "macros/gm-macros/initiative-fix/initiative-fix.js",
    img: "icons/svg/d20-highlight.svg",
    ownershipDefault: 0,
  }),
  createEntry({
    id: "dfSpellAtkGM1",
    name: "Repair Spell Attack Buttons (World)",
    relativePath: "macros/gm-macros/repair-spell-attack-buttons-world/repair-spell-attack-buttons-world.js",
    img: "icons/svg/dice-target.svg",
    ownershipDefault: 0,
  }),
  createEntry({
    id: "dfLootGen001",
    name: "Random Loot Generator",
    relativePath: "macros/gm-macros/random-loot-generator/random-loot-generator.js",
    img: "icons/containers/chest/chest-reinforced-steel-walnut-brown.webp",
    ownershipDefault: 0,
  }),
  createEntry({
    id: "dfTimeSwap01",
    name: "Switch Representative Characters",
    relativePath: "macros/gm-macros/switch-time-period/switch-time-period.js",
    img: "icons/svg/clockwork.svg",
    ownershipDefault: 0,
  }),
];

const macroPackConfig = [
  {
    key: "player",
    folder: "packs/darkfinder-player-macros",
    entries: playerMacros,
  },
  {
    key: "gm",
    folder: "packs/darkfinder-gm-macros",
    entries: gmMacros,
  },
];

const macroRoots = {
  player: resolveMacroPath("macros/player-macros"),
  gm: resolveMacroPath("macros/gm-macros"),
  nonModule: resolveMacroPath("macros/non-module"),
};

export {
  macroPackConfig,
  macroRoots,
  playerMacros,
  gmMacros,
};
