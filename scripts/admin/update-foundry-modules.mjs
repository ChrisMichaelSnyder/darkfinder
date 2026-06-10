import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SETUP_URLS = [
  "https://carrion.davidleepatrick.com/setup",
  "https://nightfall.davidleepatrick.com/setup",
  "https://whatif.davidleepatrick.com/setup",
];

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

    if (["url", "urls", "password", "module", "headless", "timeout"].includes(key)) {
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
      continue;
    }

    passthrough.push(part);
    if (inlineValue === undefined) {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        passthrough.push(next);
        index += 1;
      }
    }
  }
  return { options, passthrough };
}

function uniqueUrls(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function getSetupUrls(options) {
  const explicit = options.urls || options.url || process.env.FOUNDRY_SETUP_URLS || process.env.FOUNDRY_SETUP_URL || "";
  if (!explicit) return DEFAULT_SETUP_URLS;
  return uniqueUrls(String(explicit).split(/[,\r\n]+/));
}

function getUrlLabel(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return String(url || "server");
  }
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

function runUpdater({ url, password, moduleId, headless, timeout, passthrough }) {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "update-foundry-module.mjs");
  const args = [
    scriptPath,
    "--url", url,
    "--password", password,
    "--module", moduleId,
    "--headless", headless,
    "--timeout", timeout,
    ...passthrough,
  ];
  const label = getUrlLabel(url);

  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
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
    child.on("close", (code) => resolve({ url, label, code: code ?? 1, stdout, stderr }));
  });
}

async function main() {
  const { options, passthrough } = parseArgs(process.argv.slice(2));
  const password = String(options.password || process.env.FOUNDRY_ADMIN_PASSWORD || "").trim();
  const moduleId = String(options.module || process.env.FOUNDRY_MODULE_ID || "darkfinder").trim();
  const headless = String(options.headless || process.env.FOUNDRY_HEADLESS || "true").trim();
  const timeout = String(options.timeout || process.env.FOUNDRY_TIMEOUT_MS || "90000").trim();
  const urls = getSetupUrls(options);

  if (!password) {
    throw new Error("Missing Foundry admin password. Provide --password or FOUNDRY_ADMIN_PASSWORD.");
  }

  process.stdout.write(`Launching ${urls.length} Foundry updater${urls.length === 1 ? "" : "s"} in parallel.\n`);

  const results = await Promise.all(urls.map((url) => {
    process.stdout.write(`Queued ${url}\n`);
    return runUpdater({ url, password, moduleId, headless, timeout, passthrough });
  }));

  const summary = results.map((result) => ({
    url: result.url,
    exitCode: result.code,
  }));
  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
  if (results.some((result) => result.code !== 0)) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
