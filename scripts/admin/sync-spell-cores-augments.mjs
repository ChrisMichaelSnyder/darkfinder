import fs from "node:fs";
import path from "node:path";
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

function normalizeEntryName(value) {
  return normalizeCompare(value).replace(/^\(augment\)\s*/i, "");
}

function textBodyFingerprint(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  return normalizeCompare(lines.slice(1).join("\n"));
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

    if (currentSection) {
      sectionLines.push(line);
      continue;
    }
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
    castingTime: normalizeText(fields["Casting Time"]),
    range: normalizeText(fields.Range),
    target: normalizeText(fields.Target),
    duration: normalizeText(fields.Duration),
    savingThrow: normalizeText(fields["Saving Throw"]),
    limitation: normalizeText(fields.Limitation),
    description: normalizeText(fields.Description),
    coreAugments: normalizeText(fields["Core Augments"]),
    spellAugments: normalizeText(fields["Spell Augments"]),
    text: String(text || "").trim(),
  };
}

function buildDescriptionHtml(entry) {
  const lines = entry.text.split("\n");
  return lines
    .map((line) => `<p>${escapeHtml(line || "")}</p>`)
    .join("");
}

function stripHtmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function createBaseSystem(existingSystem = {}) {
  return {
    ...existingSystem,
    description: {
      ...(existingSystem.description || {}),
      value: existingSystem.description?.value || "",
      instructions: existingSystem.description?.instructions || "",
    },
    tags: Array.isArray(existingSystem.tags) ? existingSystem.tags : [],
    actions: Array.isArray(existingSystem.actions) ? existingSystem.actions : [],
    attackNotes: Array.isArray(existingSystem.attackNotes) ? existingSystem.attackNotes : [],
    effectNotes: Array.isArray(existingSystem.effectNotes) ? existingSystem.effectNotes : [],
    links: existingSystem.links && typeof existingSystem.links === "object" ? existingSystem.links : { children: [] },
    flags: existingSystem.flags && typeof existingSystem.flags === "object" ? existingSystem.flags : { boolean: {}, dictionary: {} },
    scriptCalls: Array.isArray(existingSystem.scriptCalls) ? existingSystem.scriptCalls : [],
    learnedAt: existingSystem.learnedAt && typeof existingSystem.learnedAt === "object"
      ? existingSystem.learnedAt
      : { class: {}, domain: {}, subDomain: {}, elementalSchool: {}, bloodline: {} },
    components: existingSystem.components && typeof existingSystem.components === "object"
      ? existingSystem.components
      : {
          value: "",
          verbal: false,
          somatic: false,
          thought: false,
          emotion: false,
          material: false,
          focus: false,
          divineFocus: 0,
        },
    materials: existingSystem.materials && typeof existingSystem.materials === "object"
      ? existingSystem.materials
      : { value: "", focus: "", gpValue: 0 },
    preparation: existingSystem.preparation && typeof existingSystem.preparation === "object"
      ? existingSystem.preparation
      : { value: 0, max: 0 },
    uses: existingSystem.uses && typeof existingSystem.uses === "object"
      ? existingSystem.uses
      : { autoDeductChargesCost: "" },
  };
}

function applyEntryToDocument(existingDoc, entry, sortValue) {
  const system = createBaseSystem(existingDoc?.system);
  system.description.value = buildDescriptionHtml(entry);
  system.school = deriveSchoolCode(entry);
  system.slotCost = deriveSlotCost(entry);
  system.level = Number(existingDoc?.system?.level ?? 1) || 1;
  system.spellbook = existingDoc?.system?.spellbook ?? "";
  system.clOffset = Number(existingDoc?.system?.clOffset ?? 0) || 0;
  system.slOffset = Number(existingDoc?.system?.slOffset ?? 0) || 0;
  system.subschool = Array.isArray(existingDoc?.system?.subschool) ? existingDoc.system.subschool : [];
  system.descriptors = Array.isArray(existingDoc?.system?.descriptors) ? existingDoc.system.descriptors : [];
  system.atWill = existingDoc?.system?.atWill ?? false;
  system.sr = existingDoc?.system?.sr ?? true;
  system.showInQuickbar = existingDoc?.system?.showInQuickbar ?? false;
  system.domain = existingDoc?.system?.domain ?? false;
  system.showInCombat = existingDoc?.system?.showInCombat ?? false;
  system.clCheck = existingDoc?.system?.clCheck ?? false;

  return {
    type: "spell",
    name: deriveDocumentName(entry),
    system,
    img: entry.icon || existingDoc?.img || "icons/svg/dice-target.svg",
    effects: Array.isArray(existingDoc?.effects) ? existingDoc.effects : [],
    folder: existingDoc?.folder ?? null,
    flags: existingDoc?.flags && typeof existingDoc.flags === "object" ? existingDoc.flags : {},
    sort: sortValue,
    ownership: existingDoc?.ownership && typeof existingDoc.ownership === "object"
      ? existingDoc.ownership
      : { default: 0 },
    _stats: existingDoc?._stats && typeof existingDoc._stats === "object"
      ? existingDoc._stats
      : STABLE_DOCUMENT_STATS,
  };
}

function createIdGenerator(existingIds) {
  return () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    while (true) {
      let generated = "";
      for (let index = 0; index < 16; index += 1) {
        generated += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (existingIds.has(generated)) continue;
      existingIds.add(generated);
      return generated;
    }
  };
}

async function readPackDocuments(folder) {
  const db = new ClassicLevel(folder, { valueEncoding: "utf8" });
  await db.open();
  try {
    const docs = [];
    for await (const [key, value] of db.iterator()) {
      if (!String(key).startsWith(ITEM_KEY_PREFIX)) continue;
      docs.push({ key: String(key), doc: JSON.parse(value) });
    }
    return docs;
  } finally {
    await db.close();
  }
}

async function writePackDocuments(folder, documents, existingRows = []) {
  const db = new ClassicLevel(folder, { valueEncoding: "utf8" });
  await db.open();
  try {
    const nextKeys = new Set(documents.map((row) => row.key));
    for (const row of existingRows) {
      if (nextKeys.has(row.key)) continue;
      await db.del(row.key);
    }
    for (const { key, doc } of documents) {
      await db.put(key, JSON.stringify(doc));
    }
  } finally {
    await db.close();
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
  const existingRows = await readPackDocuments(PACK_PATH);
  const existingByName = new Map();
  const existingByBody = new Map();
  const existingIds = new Set();

  for (const row of existingRows) {
    existingIds.add(String(row.doc._id || ""));
    existingByName.set(normalizeEntryName(row.doc.name || ""), row);
    const bodyKey = textBodyFingerprint(stripHtmlToText(row.doc.system?.description?.value || ""));
    if (bodyKey && !existingByBody.has(bodyKey)) existingByBody.set(bodyKey, row);
  }

  const nextId = createIdGenerator(existingIds);
  const nextDocuments = [];
  const usedNames = new Set();
  const usedDocumentIds = new Set();
  const sourceBodyFingerprints = new Set(sourceEntries.map((entry) => textBodyFingerprint(entry.text)).filter(Boolean));
  let createdCount = 0;
  let updatedCount = 0;

  for (let index = 0; index < sourceEntries.length; index += 1) {
    const entry = sourceEntries[index];
    const compareName = normalizeEntryName(entry.name);
    if (!compareName) continue;
    if (usedNames.has(compareName)) {
      throw new Error(`Duplicate source entry name detected: "${entry.name}"`);
    }
    usedNames.add(compareName);

    const existingRow = existingByName.get(compareName)
      || existingByBody.get(textBodyFingerprint(entry.text))
      || null;
    const existingDoc = existingRow?.doc || {};
    const docId = String(existingDoc._id || nextId());
    usedDocumentIds.add(docId);
    const sortValue = Number(existingDoc.sort ?? ((index + 1) * 100000)) || ((index + 1) * 100000);
    const nextDoc = applyEntryToDocument(existingDoc, entry, sortValue);
    nextDoc._id = docId;
    nextDocuments.push({
      key: `${ITEM_KEY_PREFIX}${docId}`,
      doc: nextDoc,
    });
    if (existingRow) updatedCount += 1;
    else createdCount += 1;
  }

  const retainedRows = existingRows.filter((row) => {
    if (usedDocumentIds.has(String(row.doc._id || ""))) return false;
    const bodyKey = textBodyFingerprint(stripHtmlToText(row.doc.system?.description?.value || ""));
    if (bodyKey && sourceBodyFingerprints.has(bodyKey)) return false;
    return true;
  });
  const finalRows = [...nextDocuments, ...retainedRows];
  finalRows.sort((left, right) => {
    const leftSort = Number(left.doc.sort || 0);
    const rightSort = Number(right.doc.sort || 0);
    if (leftSort !== rightSort) return leftSort - rightSort;
    return String(left.doc.name || "").localeCompare(String(right.doc.name || ""), undefined, { sensitivity: "base" });
  });

  await writePackDocuments(PACK_PATH, finalRows, existingRows);

  console.log(JSON.stringify({
    sourceEntries: sourceEntries.length,
    updated: updatedCount,
    created: createdCount,
    retainedUnmanaged: retainedRows.length,
    packPath: path.relative(ROOT, PACK_PATH).replace(/\\/g, "/"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
