import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ClassicLevel } from "classic-level";

const ROOT = process.cwd();
const SOURCE_PATH = path.resolve(ROOT, "data/character-buffs/character-buffs.yaml");
const PACK_PATH = path.resolve(ROOT, "packs/character-buffs");
const ITEM_KEY_PREFIX = "!items!";
const FOLDER_KEY_PREFIX = "!folders!";
const COMPENDIUM_FOLDER_NAME = "Character Buffs";

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

const LIMITED_USE_PERIOD_MAP = {
  unlimited: "unlimited",
  "per day": "day",
  day: "day",
  daily: "day",
  charges: "charges",
  "per week": "week",
  week: "week",
  weekly: "week",
  single: "single",
  "single use": "single",
};

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeCompare(value) {
  return normalizeText(value)
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function unquoteYamlScalar(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCharacterBuffEntries(filePath) {
  const source = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const entries = [];
  let current = null;
  let currentChange = null;
  let collectingDescription = false;
  let inChanges = false;

  const pushCurrentChange = () => {
    if (!current || !currentChange) return;
    current.changes.push(currentChange);
    currentChange = null;
  };

  const pushCurrentEntry = () => {
    if (!current) return;
    pushCurrentChange();
    entries.push({
      name: normalizeText(current.name),
      icon: normalizeText(current.icon),
      description: current.description.join("\n").trim(),
      limitedUses: normalizeText(current.limitedUses),
      maxUsesFormula: normalizeText(current.maxUsesFormula),
      changes: current.changes.map((change) => ({
        target: normalizeText(change.target),
        formula: normalizeText(change.formula),
        type: normalizeText(change.type),
      })),
    });
    current = null;
    collectingDescription = false;
    inChanges = false;
  };

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line.trim() === "entries:" || line.trim() === "entries: []") continue;

    const entryStart = line.match(/^  - ([A-Za-z]+):\s*(.*)$/);
    if (entryStart) {
      pushCurrentEntry();
      current = {
        name: "",
        icon: "",
        description: [],
        limitedUses: "Unlimited",
        maxUsesFormula: "",
        changes: [],
      };
      current[entryStart[1]] = unquoteYamlScalar(entryStart[2]);
      collectingDescription = false;
      inChanges = false;
      continue;
    }

    if (!current) continue;

    if (/^    description:\s*\|\s*$/.test(line)) {
      collectingDescription = true;
      inChanges = false;
      continue;
    }

    const simpleField = line.match(/^    ([A-Za-z]+):\s*(.*)$/);
    if (simpleField && !collectingDescription) {
      const [, key, rawValue] = simpleField;
      if (key === "changes") {
        pushCurrentChange();
        inChanges = true;
        collectingDescription = false;
        continue;
      }
      current[key] = unquoteYamlScalar(rawValue);
      inChanges = false;
      continue;
    }

    if (collectingDescription) {
      if (line.startsWith("      ")) {
        current.description.push(line.slice(6));
        continue;
      }
      collectingDescription = false;
    }

    const changeStart = line.match(/^      - ([A-Za-z]+):\s*(.*)$/);
    if (inChanges && changeStart) {
      pushCurrentChange();
      currentChange = { target: "", formula: "", type: "" };
      currentChange[changeStart[1]] = unquoteYamlScalar(changeStart[2]);
      continue;
    }

    const changeField = line.match(/^        ([A-Za-z]+):\s*(.*)$/);
    if (inChanges && currentChange && changeField) {
      currentChange[changeField[1]] = unquoteYamlScalar(changeField[2]);
    }
  }

  pushCurrentEntry();
  return entries;
}

function buildDescriptionHtml(description) {
  const trimmed = String(description || "").trim();
  if (!trimmed) return "";
  return trimmed
    .split("\n")
    .map((line) => `<p>${escapeHtml(line || "")}</p>`)
    .join("");
}

function resolveLimitedUsePeriod(label) {
  const normalized = normalizeCompare(label);
  const mapped = LIMITED_USE_PERIOD_MAP[normalized];
  if (!mapped) {
    throw new Error(`Unsupported limitedUses value "${label}". Expected Per Day, Unlimited, Charges, Week, or Single.`);
  }
  return mapped;
}

function deriveInitialUsesValue(maxUsesFormula) {
  const numeric = Number.parseFloat(String(maxUsesFormula || "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

function createStableId(entry) {
  return crypto
    .createHash("sha1")
    .update(`character-buff::${normalizeCompare(entry.name)}`)
    .digest("hex")
    .slice(0, 16);
}

function createStableFolderId() {
  return crypto
    .createHash("sha1")
    .update(`folder::${normalizeCompare(COMPENDIUM_FOLDER_NAME)}`)
    .digest("hex")
    .slice(0, 16);
}

function createFolderDocument() {
  return {
    _id: createStableFolderId(),
    name: COMPENDIUM_FOLDER_NAME,
    sorting: "a",
    sort: 100000,
    folder: null,
    color: null,
    description: "",
    type: "Item",
    flags: {},
    _stats: STABLE_DOCUMENT_STATS,
  };
}

function createStableChangeId(entry, index) {
  return crypto
    .createHash("sha1")
    .update(`character-buff-change::${normalizeCompare(entry.name)}::${index}`)
    .digest("hex")
    .slice(0, 8);
}

function createChangeData(entry, index) {
  return {
    _id: createStableChangeId(entry, index),
    formula: entry.formula,
    operator: "add",
    target: entry.target,
    subTarget: entry.target,
    modifier: entry.type,
    priority: 0,
    value: 0,
  };
}

function createDocument(entry, index, folderId) {
  const usesPer = resolveLimitedUsePeriod(entry.limitedUses || "Unlimited");
  const maxUsesFormula = normalizeText(entry.maxUsesFormula);
  const initialUsesValue = deriveInitialUsesValue(maxUsesFormula);

  return {
    _id: createStableId(entry),
    type: "buff",
    name: entry.name,
    system: {
      description: {
        value: buildDescriptionHtml(entry.description),
        instructions: "",
      },
      active: false,
      subType: "misc",
      hideFromToken: false,
      level: 0,
      duration: {
        value: "",
        units: "",
      },
      changes: (entry.changes || []).map((change, changeIndex) => createChangeData(change, changeIndex)),
      contextNotes: [],
      links: {
        children: [],
      },
      flags: {
        boolean: {},
        dictionary: {},
      },
      scriptCalls: [],
      actions: [],
      uses: {
        per: usesPer,
        value: initialUsesValue,
        max: initialUsesValue,
        maxFormula: maxUsesFormula,
        autoDeductChargesCost: "1",
      },
      tag: "",
      useCustomTag: false,
    },
    img: entry.icon || "icons/svg/dice-target.svg",
    effects: [],
    folder: folderId,
    flags: {},
    sort: (index + 1) * 100000,
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
  const sourceEntries = parseCharacterBuffEntries(SOURCE_PATH);
  const folderDocuments = [createFolderDocument()];
  const folderId = folderDocuments[0]._id;
  const seenIds = new Set();
  const documents = sourceEntries.map((entry, index) => {
    if (!entry.name) throw new Error("Character Buff entry is missing a name.");
    const doc = createDocument(entry, index, folderId);
    if (seenIds.has(doc._id)) {
      throw new Error(`Stable ID collision detected for Character Buff "${entry.name}".`);
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
