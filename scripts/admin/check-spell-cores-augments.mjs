import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClassicLevel } from "classic-level";

const ROOT = process.cwd();
const CORE_SOURCE_PATH = path.resolve(ROOT, "data/spell-cores-augments/spell-cores.yaml");
const AUGMENT_SOURCE_PATH = path.resolve(ROOT, "data/spell-cores-augments/spell-augments.yaml");
const PACK_PATH = path.resolve(ROOT, "packs/spell-cores-augments");
const ITEM_KEY_PREFIX = "!items!";

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

function parseSpellText(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  return {
    name: normalizeText(lines[0]),
    text: String(text || "").trim(),
  };
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

async function readPackDocuments(folder) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "darkfinder-spell-pack-check-"));
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
  const sourceEntries = [...parseYamlEntries(CORE_SOURCE_PATH), ...parseYamlEntries(AUGMENT_SOURCE_PATH)]
    .map((entry) => ({ ...parseSpellText(entry.text), icon: entry.icon, text: entry.text }));
  const packDocs = await readPackDocuments(PACK_PATH);
  const packByName = new Map(packDocs.map((doc) => [normalizeEntryName(doc.name || ""), doc]));

  for (const entry of sourceEntries) {
    const key = normalizeEntryName(entry.name);
    const doc = packByName.get(key);
    if (!doc) {
      errors.push(`Compendium entry is missing for source spell "${entry.name}".`);
      continue;
    }

    if (String(doc.img || "").trim() !== entry.icon) {
      errors.push(`Compendium icon for "${entry.name}" is out of sync.`);
    }

    const docText = stripHtmlToText(doc.system?.description?.value || "");
    if (normalizeCompare(docText) !== normalizeCompare(entry.text)) {
      errors.push(`Compendium description for "${entry.name}" is out of sync.`);
    }
  }

  if (errors.length) fail(errors);
  console.log("Spell Cores/Augments compendium is in sync with YAML sources.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
