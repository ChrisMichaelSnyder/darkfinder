import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ClassicLevel } from "classic-level";

const ROOT = process.cwd();
const SOURCE_PATH = path.resolve(ROOT, "data/character-buffs/character-buffs.yaml");
const PACK_PATH = path.resolve(ROOT, "packs/character-buffs");
const ITEM_KEY_PREFIX = "!items!";

const BUFF_CATEGORY_MAP = {
  miscellaneous: "misc",
  misc: "misc",
  permanent: "perm",
  perm: "perm",
  temporary: "temp",
  temp: "temp",
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

function parseBoolean(value, fallback = false) {
  const normalized = normalizeCompare(value);
  if (!normalized) return fallback;
  if (["true", "yes", "1", "on"].includes(normalized)) return true;
  if (["false", "no", "0", "off"].includes(normalized)) return false;
  return fallback;
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
      category: normalizeText(current.category),
      hideFromToken: parseBoolean(current.hideFromToken, false),
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
        category: "Miscellaneous",
        hideFromToken: "false",
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

    if (collectingDescription) {
      if (line.startsWith("      ")) {
        current.description.push(line.slice(6));
        continue;
      }
      collectingDescription = false;
    }

    const simpleField = line.match(/^    ([A-Za-z]+):\s*(.*)$/);
    if (simpleField) {
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

function resolveLimitedUsePeriod(label) {
  return LIMITED_USE_PERIOD_MAP[normalizeCompare(label)] || "";
}

function resolveBuffCategory(label) {
  return BUFF_CATEGORY_MAP[normalizeCompare(label)] || "";
}

function createStableId(name) {
  return crypto
    .createHash("sha1")
    .update(`character-buff::${normalizeCompare(name)}`)
    .digest("hex")
    .slice(0, 16);
}

function deriveInitialUsesValue(maxUsesFormula) {
  const numeric = Number.parseFloat(String(maxUsesFormula || "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

async function readPackDocuments(folder) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "darkfinder-character-buffs-check-"));
  const tempFolder = path.join(tempRoot, path.basename(folder));
  fs.cpSync(folder, tempFolder, { recursive: true });

  const db = new ClassicLevel(tempFolder, { valueEncoding: "utf8" });
  await db.open();
  try {
    const docs = [];
    for await (const [key, value] of db.iterator()) {
      if (!String(key).startsWith(ITEM_KEY_PREFIX)) continue;
      docs.push(JSON.parse(value));
    }
    return docs;
  } finally {
    await db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function fail(messages) {
  for (const message of messages) {
    console.error(message);
  }
  process.exit(1);
}

async function main() {
  const errors = [];
  const sourceEntries = parseCharacterBuffEntries(SOURCE_PATH);
  const packDocs = await readPackDocuments(PACK_PATH);
  const packById = new Map(packDocs.map((doc) => [String(doc._id), doc]));

  for (const entry of sourceEntries) {
    const doc = packById.get(createStableId(entry.name));
    if (!doc) {
      errors.push(`Character Buff compendium entry is missing for "${entry.name}".`);
      continue;
    }

    if (String(doc.img || "").trim() !== entry.icon) {
      errors.push(`Character Buff icon for "${entry.name}" is out of sync.`);
    }

    const docText = stripHtmlToText(doc.system?.description?.value || "");
    if (normalizeCompare(docText) !== normalizeCompare(entry.description)) {
      errors.push(`Character Buff description for "${entry.name}" is out of sync.`);
    }

    const expectedPer = resolveLimitedUsePeriod(entry.limitedUses || "Unlimited");
    if (String(doc.system?.uses?.per || "").trim() !== expectedPer) {
      errors.push(`Character Buff limitedUses for "${entry.name}" is out of sync.`);
    }

    const expectedCategory = resolveBuffCategory(entry.category || "Miscellaneous");
    if (String(doc.system?.subType || "").trim() !== expectedCategory) {
      errors.push(`Character Buff category for "${entry.name}" is out of sync.`);
    }

    if (Boolean(doc.system?.hideFromToken) !== Boolean(entry.hideFromToken)) {
      errors.push(`Character Buff hideFromToken for "${entry.name}" is out of sync.`);
    }

    if (String(doc.system?.uses?.maxFormula || "").trim() !== String(entry.maxUsesFormula || "").trim()) {
      errors.push(`Character Buff maxUsesFormula for "${entry.name}" is out of sync.`);
    }

    const expectedInitialUses = deriveInitialUsesValue(entry.maxUsesFormula);
    if (Number(doc.system?.uses?.max ?? NaN) !== expectedInitialUses) {
      errors.push(`Character Buff max uses value for "${entry.name}" is out of sync.`);
    }
    if (Number(doc.system?.uses?.value ?? NaN) !== expectedInitialUses) {
      errors.push(`Character Buff current uses value for "${entry.name}" is out of sync.`);
    }

    if (doc.folder !== null) {
      errors.push(`Character Buff "${entry.name}" should be at the top level of the compendium.`);
    }

    const docChanges = Array.isArray(doc.system?.changes) ? doc.system.changes : [];
    if (docChanges.length !== entry.changes.length) {
      errors.push(`Character Buff changes count for "${entry.name}" is out of sync.`);
      continue;
    }

    for (let index = 0; index < entry.changes.length; index += 1) {
      const sourceChange = entry.changes[index];
      const docChange = docChanges[index] || {};
      if (String(docChange.subTarget || "").trim() !== sourceChange.target) {
        errors.push(`Character Buff change target ${index + 1} for "${entry.name}" is out of sync.`);
      }
      if (String(docChange.formula || "").trim() !== sourceChange.formula) {
        errors.push(`Character Buff change formula ${index + 1} for "${entry.name}" is out of sync.`);
      }
      if (String(docChange.modifier || "").trim() !== sourceChange.type) {
        errors.push(`Character Buff change type ${index + 1} for "${entry.name}" is out of sync.`);
      }
    }
  }

  if (packDocs.length !== sourceEntries.length) {
    errors.push(`Character Buff compendium contains ${packDocs.length} entries but YAML defines ${sourceEntries.length}.`);
  }

  if (errors.length) fail(errors);
  console.log("Character Buff compendium is in sync with YAML sources.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
