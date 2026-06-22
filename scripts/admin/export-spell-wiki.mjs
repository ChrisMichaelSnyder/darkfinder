import path from "node:path";
import {
  GENERATED_WIKI_DIR,
  parseArgs,
  buildSpellWikiSections,
  writeSpellWikiExports,
} from "./spell-wiki-utils.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = String(args["output-dir"] || GENERATED_WIKI_DIR).trim();
  const sections = buildSpellWikiSections();
  const files = writeSpellWikiExports(outputDir, sections);

  console.log(JSON.stringify({
    outputDir: path.relative(process.cwd(), outputDir).replace(/\\/g, "/"),
    files: Object.fromEntries(Object.entries(files).map(([key, filePath]) => [
      key,
      path.relative(process.cwd(), filePath).replace(/\\/g, "/"),
    ])),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
