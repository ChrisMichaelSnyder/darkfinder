import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClassicLevel } from "classic-level";

const ROOT = process.cwd();
const CORE_SOURCE_PATH = path.resolve(ROOT, "data/spell-cores-augments/spell-cores.yaml");
const AUGMENT_SOURCE_PATH = path.resolve(ROOT, "data/spell-cores-augments/spell-augments.yaml");
const PACK_PATH = path.resolve(ROOT, "packs/spell-cores-augments");
const ITEM_KEY_PREFIX = "!items!";
const FOLDER_KEY_PREFIX = "!folders!";
const EXPECTED_FOLDER_NAME_BY_TYPE = {
  core: "Spell Cores",
  augment: "Spell Augments",
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
    const folders = [];
    for await (const [key, value] of db.iterator()) {
      if (String(key).startsWith(ITEM_KEY_PREFIX)) {
        docs.push(JSON.parse(value));
        continue;
      }
      if (String(key).startsWith(FOLDER_KEY_PREFIX)) {
        folders.push(JSON.parse(value));
      }
    }
    return { docs, folders };
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

function deriveEntryType(text) {
  const match = String(text || "").match(/^\s*Type:\s*(.+)$/m);
  return normalizeCompare(match?.[1] || "");
}

async function main() {
  const errors = [];
  const sourceEntries = [...parseYamlEntries(CORE_SOURCE_PATH), ...parseYamlEntries(AUGMENT_SOURCE_PATH)]
    .map((entry) => ({
      ...parseSpellText(entry.text),
      icon: entry.icon,
      text: entry.text,
      entryType: deriveEntryType(entry.text),
    }));
  const { docs: packDocs, folders: packFolders } = await readPackDocuments(PACK_PATH);
  const packByName = new Map(packDocs.map((doc) => [normalizeEntryName(doc.name || ""), doc]));
  const folderById = new Map(packFolders.map((folder) => [String(folder._id), folder]));

  for (const expectedFolderName of Object.values(EXPECTED_FOLDER_NAME_BY_TYPE)) {
    const folderMatches = packFolders.filter((folder) => normalizeCompare(folder.name) === normalizeCompare(expectedFolderName));
    if (!folderMatches.length) {
      errors.push(`Compendium folder "${expectedFolderName}" is missing.`);
    } else if (folderMatches.length > 1) {
      errors.push(`Compendium folder "${expectedFolderName}" is duplicated.`);
    }
  }

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

    const expectedFolderName = EXPECTED_FOLDER_NAME_BY_TYPE[entry.entryType];
    const assignedFolder = folderById.get(String(doc.folder || ""));
    if (!expectedFolderName) {
      errors.push(`Source spell "${entry.name}" has unsupported Type "${entry.entryType}".`);
    } else if (!assignedFolder) {
      errors.push(`Compendium entry "${entry.name}" is not assigned to a folder.`);
    } else if (normalizeCompare(assignedFolder.name) !== normalizeCompare(expectedFolderName)) {
      errors.push(`Compendium entry "${entry.name}" is assigned to "${assignedFolder.name}" instead of "${expectedFolderName}".`);
    }
  }

  if (errors.length) fail(errors);
  console.log("Spell Cores/Augments compendium is in sync with YAML sources.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
