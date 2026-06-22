const BUFF_TARGET_LABELS = {
  acpA: "ACP (Armor)",
  acpS: "ACP (Shield)",
  mDexA: "Max Dexterity Bonus (Armor)",
  mDexS: "Max Dexterity Bonus (Shield)",
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
  strMod: "Strength Modifier",
  dexMod: "Dexterity Modifier",
  conMod: "Constitution Modifier",
  intMod: "Intelligence Modifier",
  wisMod: "Wisdom Modifier",
  chaMod: "Charisma Modifier",
  strPen: "Strength Penalty",
  dexPen: "Dexterity Penalty",
  conPen: "Constitution Penalty",
  intPen: "Intelligence Penalty",
  wisPen: "Wisdom Penalty",
  chaPen: "Charisma Penalty",
  carryStr: "Carry Strength",
  carryMult: "Carry Multiplier",
  size: "Size",
  reach: "Natural Reach",
  ageCategory: "Age Category",
  ageCategoryPhysical: "Physical Age Category",
  ageCategoryMental: "Mental Age Category",
  skills: "All Skills",
  unskills: "Untrained Skills",
  strSkills: "Strength Skills",
  dexSkills: "Dexterity Skills",
  conSkills: "Constitution Skills",
  intSkills: "Intelligence Skills",
  wisSkills: "Wisdom Skills",
  chaSkills: "Charisma Skills",
  "skill.knowledge": "Knowledge",
  allChecks: "All Ability Checks",
  strChecks: "Strength Checks",
  dexChecks: "Dexterity Checks",
  conChecks: "Constitution Checks",
  intChecks: "Intelligence Checks",
  wisChecks: "Wisdom Checks",
  chaChecks: "Charisma Checks",
  landSpeed: "Land",
  climbSpeed: "Climb",
  swimSpeed: "Swim",
  burrowSpeed: "Burrow",
  flySpeed: "Fly",
  allSpeeds: "All Speeds",
  ac: "Generic AC",
  aac: "Armor AC",
  sac: "Shield AC",
  nac: "Natural Armor AC",
  tac: "Touch AC",
  ffac: "Flat-footed AC",
  bab: "Base Attack Bonus",
  "~attackCore": "",
  attack: "All Attack Rolls",
  wattack: "Weapon Attack Rolls",
  sattack: "Spell Attack Rolls",
  mattack: "Melee Attack Rolls",
  nattack: "Natural Attack Rolls",
  rattack: "Ranged Attack Rolls",
  tattack: "Thrown Attack Rolls",
  damage: "All Damage Rolls",
  wdamage: "Weapon Damage",
  mwdamage: "Melee Weapon Damage",
  rwdamage: "Ranged Weapon Damage",
  twdamage: "Thrown Weapon Damage",
  rdamage: "All Ranged Damage",
  mdamage: "All Melee Damage",
  ndamage: "Natural Attack Damage",
  sdamage: "Spell Damage",
  critConfirm: "Critical Confirmation",
  allSavingThrows: "All Saving Throws",
  fort: "Fortitude",
  ref: "Reflex",
  will: "Will",
  cmb: "Combat Maneuver Bonus",
  cmd: "Combat Maneuver Defense",
  ffcmd: "Flat-footed CMD",
  init: "Initiative",
  mhp: "Hit Points",
  wounds: "Wounds",
  vigor: "Vigor",
  spellResist: "Spell Resistance",
  bonusFeats: "Bonus Feats",
  bonusSkillRanks: "Bonus Skill Ranks",
  concentration: "Concentration",
  cl: "Caster Level",
  dc: "Spell DC",
  sensedv: "Darkvision",
  sensets: "Tremorsense",
  sensebse: "Blindsense",
  sensebs: "Blindsight",
  sensels: "Lifesense",
  sensesc: "Scent",
  sensetr: "True seeing",
};

const CHANGE_TYPE_LABELS = {
  untyped: "Untyped",
  untypedPerm: "Untyped (Permanent)",
  base: "Base",
  enh: "Enhancement",
  dodge: "Dodge",
  haste: "Haste",
  inherent: "Inherent",
  deflection: "Deflection",
  morale: "Morale",
  luck: "Luck",
  sacred: "Sacred",
  insight: "Insight",
  resist: "Resistance",
  profane: "Profane",
  trait: "Trait",
  racial: "Racial",
  size: "Size",
  competence: "Competence",
  circumstance: "Circumstance",
  alchemical: "Alchemical",
};

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9.+~]+/g, " ");
}

function buildAliasMap(definitions, extraAliases = {}) {
  const aliases = {};

  for (const [key, label] of Object.entries(definitions)) {
    aliases[normalizeKey(key)] = key;
    if (label) aliases[normalizeKey(label)] = key;
  }

  for (const [alias, key] of Object.entries(extraAliases)) {
    aliases[normalizeKey(alias)] = key;
  }

  return aliases;
}

const BUFF_TARGET_ALIASES = buildAliasMap(BUFF_TARGET_LABELS, {
  "attack core": "~attackCore",
  "strength mod": "strMod",
  "dexterity mod": "dexMod",
  "constitution mod": "conMod",
  "intelligence mod": "intMod",
  "wisdom mod": "wisMod",
  "charisma mod": "chaMod",
  hp: "mhp",
  knowledge: "skill.knowledge",
});

const CHANGE_TYPE_ALIASES = buildAliasMap(CHANGE_TYPE_LABELS, {
  enhancement: "enh",
  enh: "enh",
  resistance: "resist",
  resist: "resist",
  "untyped permanent": "untypedPerm",
});

export function resolveBuffTargetKey(value) {
  return BUFF_TARGET_ALIASES[normalizeKey(value)] || "";
}

export function resolveChangeTypeKey(value) {
  return CHANGE_TYPE_ALIASES[normalizeKey(value)] || "";
}

export { BUFF_TARGET_LABELS, CHANGE_TYPE_LABELS };
