import fs from "node:fs";
import path from "node:path";
import { ClassicLevel } from "classic-level";
import { macroPackConfig } from "./macro-compendium-config.mjs";

const STABLE_DOCUMENT_STATS = {
  coreVersion: "13.346",
  systemId: null,
  systemVersion: null,
  createdTime: 0,
  modifiedTime: 0,
  lastModifiedBy: null,
  compendiumSource: null,
  duplicateSource: null,
  exportSource: null,
};

function createMacroDocument(entry) {
  return {
    _id: entry.id,
    name: entry.name,
    type: "script",
    command: `game.modules.get("darkfinder")?.api?.executeMacroFile("${entry.relativePath}");`,
    _stats: STABLE_DOCUMENT_STATS,
    img: entry.img,
    scope: "global",
    folder: null,
    sort: 50,
    ownership: { default: entry.ownershipDefault },
    flags: {
      darkfinder: {
        launcher: true,
        module: true,
        runtime: "executeMacroFile",
      },
    },
  };
}

async function rebuildPack(folder, entries) {
  fs.rmSync(folder, { recursive: true, force: true });

  const db = new ClassicLevel(folder, { valueEncoding: "utf8" });
  await db.open();

  for (const entry of entries) {
    const key = `!macros!${entry.id}`;
    await db.put(key, JSON.stringify(createMacroDocument(entry)));
  }

  await db.close();

  // LevelDB log files are runtime diagnostics and can churn between identical
  // rebuilds, so strip them from the shipped pack to keep the repo stable.
  for (const transientFile of ["LOG", "LOG.old"]) {
    fs.rmSync(path.join(folder, transientFile), { force: true });
  }
}

async function main() {
  for (const pack of macroPackConfig) {
    await rebuildPack(path.resolve(pack.folder), pack.entries);
  }

  const legacyPack = path.resolve("packs/darkfinder-macros");
  fs.rmSync(legacyPack, { recursive: true, force: true });

  console.log(JSON.stringify(macroPackConfig.map((pack) => ({
    pack: pack.folder,
    count: pack.entries.length,
  })), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
