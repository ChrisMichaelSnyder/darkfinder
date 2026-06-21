import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ClassicLevel } from "classic-level";

const ROOT = process.cwd();
const PACK_PATH = path.resolve(ROOT, "packs/spell-cores-augments");
const CORE_SOURCE_PATH = path.resolve(ROOT, "data/spell-cores-augments/spell-cores.yaml");
const AUGMENT_SOURCE_PATH = path.resolve(ROOT, "data/spell-cores-augments/spell-augments.yaml");
const ITEM_KEY_PREFIX = "!items!";

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseYamlEntries(filePath) {
  const source = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const entries = [];
  let current = null;
  let collectingText = false;

  for (const line of lines) {
    if (!line || line === "entries:") continue;

    const entryStart = line.match(/^  - icon:\s+"(.*)"$/);
    if (entryStart) {
      if (current) entries.push(current);
      current = { icon: entryStart[1], text: [] };
      collectingText = false;
      continue;
    }

    if (!current) continue;

    if (/^    text:\s*\|\s*$/.test(line)) {
      collectingText = true;
      continue;
    }

    if (collectingText) {
      current.text.push(line.startsWith("      ") ? line.slice(6) : line);
    }
  }

  if (current) entries.push(current);
  return entries.map((entry) => ({
    icon: normalizeText(entry.icon),
    text: entry.text.join("\n").trim(),
  }));
}

function parseSpellText(text, expectedType) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const name = normalizeText(lines[0]);
  if (!name) {
    throw new Error("Encountered an entry with no name line.");
  }

  const fields = {};
  let currentSection = null;
  let sectionLines = [];

  const flushSection = () => {
    if (!currentSection) return;
    fields[currentSection] = sectionLines.join("\n").trim();
    currentSection = null;
    sectionLines = [];
  };

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const headerMatch = line.match(/^([A-Za-z /]+):\s*(.*)$/);
    if (headerMatch) {
      const label = normalizeText(headerMatch[1]);
      const inlineValue = headerMatch[2] ?? "";
      const isMultilineSection = ["Description", "Core Augments", "Spell Augments"].includes(label)
        || (label === "Limitation" && inlineValue === "");
      if (isMultilineSection) {
        flushSection();
        currentSection = label;
        sectionLines = inlineValue ? [inlineValue] : [];
        continue;
      }
      flushSection();
      fields[label] = inlineValue.trim();
      continue;
    }

    if (currentSection) sectionLines.push(line);
  }

  flushSection();

  const typeValue = normalizeText(fields.Type);
  if (!typeValue) {
    throw new Error(`Entry "${name}" is missing a Type field.`);
  }
  if (expectedType && normalizeCompare(typeValue) !== normalizeCompare(expectedType)) {
    throw new Error(`Entry "${name}" expected Type "${expectedType}" but found "${typeValue}".`);
  }

  return {
    name,
    type: typeValue,
    spCost: normalizeText(fields["SP Cost"]),
    school: normalizeText(fields.School),
    text: String(text || "").trim(),
  };
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

function createDocument(entry, index) {
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
    folder: null,
    flags: {},
    sort,
    ownership: {
      default: 0,
    },
    _stats: STABLE_DOCUMENT_STATS,
  };
}

async function rebuildPack(folder, documents) {
  fs.rmSync(folder, { recursive: true, force: true });

  const db = new ClassicLevel(folder, { valueEncoding: "utf8" });
  await db.open();
  try {
    for (const doc of documents) {
      await db.put(`${ITEM_KEY_PREFIX}${doc._id}`, JSON.stringify(doc));
    }
  } finally {
    await db.close();
  }

  for (const transientFile of ["LOG", "LOG.old"]) {
    fs.rmSync(path.join(folder, transientFile), { force: true });
  }
}

function buildEntryRecords() {
  const coreEntries = parseYamlEntries(CORE_SOURCE_PATH).map((entry) => ({
    ...parseSpellText(entry.text, "Core"),
    icon: entry.icon,
  }));
  const augmentEntries = parseYamlEntries(AUGMENT_SOURCE_PATH).map((entry) => ({
    ...parseSpellText(entry.text, "Augment"),
    icon: entry.icon,
  }));
  return [...coreEntries, ...augmentEntries];
}

async function main() {
  const sourceEntries = buildEntryRecords();
  const seenIds = new Set();
  const documents = sourceEntries.map((entry, index) => {
    const doc = createDocument(entry, index);
    if (seenIds.has(doc._id)) {
      throw new Error(`Stable ID collision detected for "${entry.name}".`);
    }
    seenIds.add(doc._id);
    return doc;
  });

  await rebuildPack(PACK_PATH, documents);

  console.log(JSON.stringify({
    sourceEntries: sourceEntries.length,
    rebuilt: documents.length,
    packPath: path.relative(ROOT, PACK_PATH).replace(/\\/g, "/"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
