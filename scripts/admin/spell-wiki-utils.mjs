import fs from "node:fs";
import path from "node:path";
import { ROOT, buildSpellEntryRecords } from "./spell-source-utils.mjs";

export const DEFAULT_WIKI_BASE_URL = "https://beyondthearchives.miraheze.org";
export const DEFAULT_WIKI_PAGE_TITLE = "Spell_System";
export const GENERATED_WIKI_DIR = path.resolve(ROOT, "generated/wiki");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const [rawKey, inlineValue] = part.slice(2).split("=", 2);
    const key = rawKey.trim();
    if (!key) continue;

    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
      continue;
    }

    options[key] = "true";
  }
  return options;
}

export function toBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function renderSpellEntryToWiki(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const [nameLine, ...rest] = lines;
  const wikiLines = [`'''${String(nameLine || "").trim()}'''`];

  for (const line of rest) {
    if (!String(line).trim()) {
      wikiLines.push("");
      continue;
    }
    wikiLines.push(`<br>${line}`);
  }

  return wikiLines.join("\n").trim();
}

export function renderSpellSection(entries) {
  return entries
    .map((entry) => renderSpellEntryToWiki(entry.text))
    .join("\n\n\n")
    .trim();
}

export function buildSpellWikiSections() {
  const { coreEntries, augmentEntries } = buildSpellEntryRecords();
  return {
    spellAugments: renderSpellSection(augmentEntries),
    spellCores: renderSpellSection(coreEntries),
  };
}

export function wrapWikiSection(heading, body) {
  return `==${heading}==\n\n${String(body || "").trim()}\n`;
}

export function replaceManagedSection(pageSource, heading, replacementBody) {
  const headingRegex = new RegExp(`^==\\s*${escapeRegExp(heading)}\\s*==\\s*$`, "m");
  const headingMatch = headingRegex.exec(pageSource);
  if (!headingMatch) {
    throw new Error(`Could not find wiki section heading "${heading}".`);
  }

  const headingLineEnd = pageSource.indexOf("\n", headingMatch.index + headingMatch[0].length);
  const bodyStart = headingLineEnd === -1 ? pageSource.length : headingLineEnd + 1;

  const nextHeadingRegex = /^==[^=].*?==\s*$/gm;
  nextHeadingRegex.lastIndex = bodyStart;
  const nextHeadingMatch = nextHeadingRegex.exec(pageSource);
  const bodyEnd = nextHeadingMatch ? nextHeadingMatch.index : pageSource.length;

  const before = `${pageSource.slice(0, bodyStart).replace(/\n*$/, "")}\n\n`;
  const after = pageSource.slice(bodyEnd).replace(/^\n+/, "\n");

  return `${before}${String(replacementBody || "").trim()}\n\n${after}`;
}

export function writeSpellWikiExports(outputDir, sections) {
  const resolvedOutputDir = path.resolve(ROOT, outputDir || GENERATED_WIKI_DIR);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  const files = {
    augmentSection: path.join(resolvedOutputDir, "spell-augments.section.wiki.txt"),
    coreSection: path.join(resolvedOutputDir, "spell-cores.section.wiki.txt"),
    combinedPreview: path.join(resolvedOutputDir, "spell-system.managed-sections.wiki.txt"),
  };

  fs.writeFileSync(files.augmentSection, wrapWikiSection("Spell Augments", sections.spellAugments), "utf8");
  fs.writeFileSync(files.coreSection, wrapWikiSection("Spell Cores", sections.spellCores), "utf8");
  fs.writeFileSync(
    files.combinedPreview,
    `${wrapWikiSection("Spell Augments", sections.spellAugments)}\n${wrapWikiSection("Spell Cores", sections.spellCores)}`,
    "utf8",
  );

  return files;
}
