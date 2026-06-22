import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const options = {};
  const passthrough = [];

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) {
      passthrough.push(part);
      continue;
    }

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

  return { options, passthrough };
}

function toBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function writePrefixedOutput(prefix, text, writer = process.stdout.write.bind(process.stdout)) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line && index === lines.length - 1) continue;
    writer(`[${prefix}] ${line}\n`);
  }
}

function runNodeScript({ label, scriptName, args = [] }) {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), scriptName);

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      writePrefixedOutput(label, text, process.stdout.write.bind(process.stdout));
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      writePrefixedOutput(label, text, process.stderr.write.bind(process.stderr));
    });

    child.on("close", (code) => {
      resolve({
        label,
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function main() {
  const { options } = parseArgs(process.argv.slice(2));
  const skipWiki = toBoolean(options["skip-wiki"], false);
  const skipFoundry = toBoolean(options["skip-foundry"], false);
  const dryRunWiki = toBoolean(options["dry-run-wiki"], false);
  const moduleId = String(options.module || process.env.FOUNDRY_MODULE_ID || "darkfinder").trim();
  const headless = String(options.headless || process.env.FOUNDRY_HEADLESS || "true").trim();
  const timeout = String(options.timeout || process.env.FOUNDRY_TIMEOUT_MS || "90000").trim();
  const urls = String(options.urls || options.url || process.env.FOUNDRY_SETUP_URLS || process.env.FOUNDRY_SETUP_URL || "").trim();
  const wikiPage = String(options["wiki-page"] || process.env.WIKI_PAGE || "").trim();
  const wikiBaseUrl = String(options["wiki-base-url"] || process.env.WIKI_BASE_URL || "").trim();

  const summary = [];

  if (!skipWiki) {
    const wikiArgs = [];
    if (dryRunWiki) wikiArgs.push("--dry-run", "true");
    if (wikiPage) wikiArgs.push("--wiki-page", wikiPage);
    if (wikiBaseUrl) wikiArgs.push("--wiki-base-url", wikiBaseUrl);

    const wikiResult = await runNodeScript({
      label: "wiki",
      scriptName: "sync-spell-wiki.mjs",
      args: wikiArgs,
    });
    summary.push({ step: "wiki", exitCode: wikiResult.code });
    if (wikiResult.code !== 0) {
      process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
      process.exit(wikiResult.code);
    }
  }

  if (!skipFoundry) {
    const foundryArgs = ["--module", moduleId, "--headless", headless, "--timeout", timeout];
    if (urls) foundryArgs.push("--urls", urls);

    const foundryResult = await runNodeScript({
      label: "foundry",
      scriptName: "update-foundry-modules.mjs",
      args: foundryArgs,
    });
    summary.push({ step: "foundry", exitCode: foundryResult.code });
    if (foundryResult.code !== 0) {
      process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
      process.exit(foundryResult.code);
    }
  }

  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
