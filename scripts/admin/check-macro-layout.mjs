import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClassicLevel } from "classic-level";
import { macroPackConfig, macroRoots } from "./macro-compendium-config.mjs";

function collectJsFiles(root) {
  const results = [];
  if (!fs.existsSync(root)) return results;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".js")) {
        results.push(fullPath);
      }
    }
  };

  walk(root);
  results.sort();
  return results;
}

async function readPackDocuments(folder) {
  const sourceFolder = path.resolve(folder);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "darkfinder-pack-check-"));
  const tempFolder = path.join(tempRoot, path.basename(sourceFolder));

  fs.cpSync(sourceFolder, tempFolder, { recursive: true });

  const db = new ClassicLevel(tempFolder, { valueEncoding: "utf8" });
  await db.open();

  try {
    const rows = [];
    for await (const [key, value] of db.iterator()) {
      if (!String(key).startsWith("!macros!")) continue;
      rows.push(JSON.parse(value));
    }
    return rows;
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

  const configuredPaths = new Set();
  for (const pack of macroPackConfig) {
    for (const entry of pack.entries) {
      configuredPaths.add(path.resolve(entry.absolutePath));
      if (!fs.existsSync(entry.absolutePath)) {
        errors.push(`Missing configured macro file: ${entry.relativePath}`);
      }
    }
  }

  const playerFiles = collectJsFiles(macroRoots.player);
  const gmFiles = collectJsFiles(macroRoots.gm);
  const nonModuleFiles = collectJsFiles(macroRoots.nonModule);

  for (const file of [...playerFiles, ...gmFiles]) {
    if (!configuredPaths.has(path.resolve(file))) {
      errors.push(`Macro file is not represented in the shipped compendium config: ${path.relative(process.cwd(), file).replace(/\\\\/g, "/")}`);
    }
  }

  for (const file of nonModuleFiles) {
    if (configuredPaths.has(path.resolve(file))) {
      errors.push(`Non-module macro is incorrectly configured for shipping: ${path.relative(process.cwd(), file).replace(/\\\\/g, "/")}`);
    }
  }

  for (const pack of macroPackConfig) {
    const docs = await readPackDocuments(pack.folder);
    const expectedById = new Map(pack.entries.map((entry) => [entry.id, entry]));

    for (const doc of docs) {
      const entry = expectedById.get(doc._id);
      if (!entry) {
        errors.push(`Unexpected macro document "${doc.name}" found in ${pack.folder}.`);
        continue;
      }

      const expectedCommand = `game.modules.get("darkfinder")?.api?.executeMacroFile("${entry.relativePath}");`;
      if (doc.command !== expectedCommand) {
        errors.push(`Macro "${doc.name}" in ${pack.folder} has an out-of-sync launcher path.`);
      }
      if (Number(doc.ownership?.default) !== entry.ownershipDefault) {
        errors.push(`Macro "${doc.name}" in ${pack.folder} has incorrect default ownership.`);
      }
      if (doc.img !== entry.img) {
        errors.push(`Macro "${doc.name}" in ${pack.folder} has an out-of-sync icon.`);
      }
    }

    for (const entry of pack.entries) {
      if (!docs.some((doc) => doc._id === entry.id)) {
        errors.push(`Expected macro "${entry.name}" is missing from ${pack.folder}.`);
      }
    }
  }

  if (fs.existsSync(path.resolve("packs/darkfinder-macros"))) {
    errors.push("Legacy pack packs/darkfinder-macros should not exist anymore.");
  }

  if (errors.length) fail(errors);
  console.log("Macro layout and shipped compendiums are in sync.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
