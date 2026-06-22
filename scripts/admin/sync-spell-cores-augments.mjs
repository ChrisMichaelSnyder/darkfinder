import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ClassicLevel } from "classic-level";
import {
  ROOT,
  normalizeText,
  normalizeCompare,
  buildSpellEntryRecords,
} from "./spell-source-utils.mjs";

const PACK_PATH = path.resolve(ROOT, "packs/spell-cores-augments");
const ITEM_KEY_PREFIX = "!items!";
const FOLDER_KEY_PREFIX = "!folders!";

const STABLE_DOCUMENT_STATS = {
  coreVersion: "13.346",
  systemId: "pf1",
  systemVersion: "11.11",
  createdTime: 0,
  modifiedTime: 0,
  lastModifiedBy: null,
  compendiumSource: null,
  duplicateSource: null,
  exportSource: null,
};

const COMPENDIUM_FOLDER_DEFINITIONS = [
  {
    key: "core",
    name: "Spell Cores",
    typeLabel: "Core",
  },
  {
    key: "augment",
    name: "Spell Augments",
    typeLabel: "Augment",
  },
];

const SCHOOL_MAP = {
  abjuration: "abj",
  conjuration: "con",
  divination: "div",
  enchantment: "enc",
  evocation: "evo",
  illusion: "ill",
  necromancy: "nec",
  transmutation: "trs",
  universal: "uni",
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDescriptionHtml(entry) {
  return entry.text
    .split("\n")
    .map((line) => `<p>${escapeHtml(line || "")}</p>`)
    .join("");
}

function deriveDocumentName(entry) {
  return normalizeCompare(entry.type) === "augment"
    ? `(Augment) ${entry.name}`
    : entry.name;
}

function deriveSchoolCode(entry) {
  const normalized = normalizeCompare(entry.school);
  return SCHOOL_MAP[normalized] || normalized.slice(0, 3) || "";
}

function deriveSlotCost(entry) {
  const numeric = Number.parseInt(String(entry.spCost || "").trim(), 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function createStableId(entry) {
  return crypto
    .createHash("sha1")
    .update(`${normalizeCompare(entry.type)}::${normalizeCompare(entry.name)}`)
    .digest("hex")
    .slice(0, 16);
}

function createStableFolderId(folderDefinition) {
  return crypto
    .createHash("sha1")
    .update(`folder::${normalizeCompare(folderDefinition.name)}`)
    .digest("hex")
    .slice(0, 16);
}

function createFolderDocument(folderDefinition, index) {
  const sort = (index + 1) * 100000;
  return {
    _id: createStableFolderId(folderDefinition),
    name: folderDefinition.name,
    sorting: "a",
    sort,
    folder: null,
    color: null,
    description: "",
    type: "Item",
    flags: {},
    _stats: STABLE_DOCUMENT_STATS,
  };
}

function getCompendiumFolderKey(entry) {
  const normalizedType = normalizeCompare(entry.type);
  if (normalizedType === "core") return "core";
  if (normalizedType === "augment") return "augment";
  throw new Error(`Entry "${entry.name}" has unsupported Type "${entry.type}".`);
}

function createDocument(entry, index, folderId) {
  const sort = (index + 1) * 100000;
  return {
    _id: createStableId(entry),
    type: "spell",
    name: deriveDocumentName(entry),
    system: {
      description: {
        value: buildDescriptionHtml(entry),
        instructions: "",
      },
      tags: [],
      actions: [],
      attackNotes: [],
      effectNotes: [],
      links: {
        children: [],
      },
      flags: {
        boolean: {},
        dictionary: {},
      },
      scriptCalls: [],
      learnedAt: {
        class: {},
        domain: {},
        subDomain: {},
        elementalSchool: {},
        bloodline: {},
      },
      level: 1,
      clOffset: 0,
      slOffset: 0,
      school: deriveSchoolCode(entry),
      subschool: [],
      descriptors: [],
      components: {
        value: "",
        verbal: false,
        somatic: false,
        thought: false,
        emotion: false,
        material: false,
        focus: false,
        divineFocus: 0,
      },
      materials: {
        value: "",
        focus: "",
        gpValue: 0,
      },
      spellbook: "",
      preparation: {
        value: 0,
        max: 0,
      },
      uses: {
        autoDeductChargesCost: "",
      },
      atWill: false,
      sr: true,
      showInQuickbar: false,
      domain: false,
      slotCost: deriveSlotCost(entry),
      showInCombat: false,
      clCheck: false,
    },
    img: entry.icon || "icons/svg/dice-target.svg",
    effects: [],
    folder: folderId,
    flags: {},
    sort,
    ownership: {
      default: 0,
    },
    _stats: STABLE_DOCUMENT_STATS,
  };
}

async function rebuildPack(folder, folderDocuments, itemDocuments) {
  fs.rmSync(folder, { recursive: true, force: true });

  const db = new ClassicLevel(folder, { valueEncoding: "utf8" });
  await db.open();
  try {
    for (const folderDoc of folderDocuments) {
      await db.put(`${FOLDER_KEY_PREFIX}${folderDoc._id}`, JSON.stringify(folderDoc));
    }
    for (const doc of itemDocuments) {
      await db.put(`${ITEM_KEY_PREFIX}${doc._id}`, JSON.stringify(doc));
    }
  } finally {
    await db.close();
  }

  for (const transientFile of ["LOG", "LOG.old"]) {
    fs.rmSync(path.join(folder, transientFile), { force: true });
  }
}

async function main() {
  const sourceEntries = buildSpellEntryRecords().allEntries;
  const folderDocuments = COMPENDIUM_FOLDER_DEFINITIONS.map((folderDefinition, index) =>
    createFolderDocument(folderDefinition, index)
  );
  const folderIdByKey = new Map(folderDocuments.map((folderDoc, index) => [
    COMPENDIUM_FOLDER_DEFINITIONS[index].key,
    folderDoc._id,
  ]));
  const seenIds = new Set();
  const documents = sourceEntries.map((entry, index) => {
    const folderKey = getCompendiumFolderKey(entry);
    const folderId = folderIdByKey.get(folderKey);
    const doc = createDocument(entry, index, folderId);
    if (seenIds.has(doc._id)) {
      throw new Error(`Stable ID collision detected for "${entry.name}".`);
    }
    seenIds.add(doc._id);
    return doc;
  });

  await rebuildPack(PACK_PATH, folderDocuments, documents);

  console.log(JSON.stringify({
    sourceEntries: sourceEntries.length,
    folders: folderDocuments.length,
    rebuilt: documents.length,
    packPath: path.relative(ROOT, PACK_PATH).replace(/\\/g, "/"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
