import fs from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
export const SPELL_CORE_SOURCE_PATH = path.resolve(ROOT, "data/spell-cores-augments/spell-cores.yaml");
export const SPELL_AUGMENT_SOURCE_PATH = path.resolve(ROOT, "data/spell-cores-augments/spell-augments.yaml");

export function normalizeText(value) {
  return String(value || "").trim();
}

export function normalizeCompare(value) {
  return normalizeText(value)
    .replace(/[â€œâ€]/g, "\"")
    .replace(/[â€˜â€™]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function parseYamlEntries(filePath) {
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

export function parseSpellText(text, expectedType = "") {
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

export function deriveEntryType(text) {
  const match = String(text || "").match(/^\s*Type:\s*(.+)$/m);
  return normalizeCompare(match?.[1] || "");
}

export function buildSpellEntryRecords() {
  const coreEntries = parseYamlEntries(SPELL_CORE_SOURCE_PATH).map((entry) => ({
    ...parseSpellText(entry.text, "Core"),
    icon: entry.icon,
  }));
  const augmentEntries = parseYamlEntries(SPELL_AUGMENT_SOURCE_PATH).map((entry) => ({
    ...parseSpellText(entry.text, "Augment"),
    icon: entry.icon,
  }));

  return {
    coreEntries,
    augmentEntries,
    allEntries: [...coreEntries, ...augmentEntries],
  };
}
