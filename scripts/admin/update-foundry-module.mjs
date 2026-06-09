import { chromium } from "playwright";

function parseArgs(argv) {
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

function toBoolean(value, fallback = true) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

async function maybeAuthenticate(page, password) {
  const passwordField = page.locator('input[name="adminPassword"]');
  if (!(await passwordField.isVisible().catch(() => false))) return false;

  await passwordField.fill(password);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button[type="submit"][value="adminAuth"]'),
  ]);
  return true;
}

async function waitForSetupMenu(page, timeoutMs) {
  await page.locator("#setup-menu").waitFor({ state: "visible", timeout: timeoutMs });
}

async function openModulesTab(page) {
  const tab = page.locator('#setup-packages-header [data-group="primary"][data-tab="modules"]');
  await tab.click();
  await page.locator('#setup-packages section[data-group="primary"][data-tab="modules"].active').waitFor({ state: "visible" });
}

async function collectNotificationTexts(page) {
  return page.locator("#notifications .notification p").evaluateAll((nodes) => (
    nodes.map((node) => node.textContent?.trim() || "").filter(Boolean)
  ));
}

async function waitForNewNotification(page, beforeTexts, timeoutMs) {
  await page.waitForFunction(
    (existing) => {
      const texts = Array.from(document.querySelectorAll("#notifications .notification p"))
        .map((node) => node.textContent?.trim() || "")
        .filter(Boolean);
      return texts.some((text) => !existing.includes(text));
    },
    beforeTexts,
    { timeout: timeoutMs },
  );
  const afterTexts = await collectNotificationTexts(page);
  return afterTexts.find((text) => !beforeTexts.includes(text)) || afterTexts.at(-1) || "";
}

async function updateModule(page, moduleId, timeoutMs) {
  const filter = page.locator("#module-filter");
  await filter.fill(moduleId);
  const row = page.locator(`#modules-list .package.module[data-package-id="${moduleId}"]`).first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });

  const packageTitle = (await row.locator(".package-title").textContent())?.trim() || moduleId;
  const updateControl = row.locator('[data-action="updatePackage"]');
  if (!(await updateControl.isVisible().catch(() => false))) {
    throw new Error(`The update button for module "${moduleId}" is not available.`);
  }

  const beforeTexts = await collectNotificationTexts(page);
  await updateControl.click();
  const notification = await waitForNewNotification(page, beforeTexts, timeoutMs);
  return { moduleId, packageTitle, notification };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = String(args.url || process.env.FOUNDRY_SETUP_URL || "").trim();
  const password = String(args.password || process.env.FOUNDRY_ADMIN_PASSWORD || "").trim();
  const moduleId = String(args.module || process.env.FOUNDRY_MODULE_ID || "darkfinder").trim();
  const headless = toBoolean(args.headless ?? process.env.FOUNDRY_HEADLESS, true);
  const timeoutMs = toNumber(args.timeout ?? process.env.FOUNDRY_TIMEOUT_MS, 30000);

  if (!url) throw new Error("Missing Foundry setup URL. Provide --url or FOUNDRY_SETUP_URL.");
  if (!password) throw new Error("Missing Foundry admin password. Provide --password or FOUNDRY_ADMIN_PASSWORD.");
  if (!moduleId) throw new Error("Missing module id. Provide --module or FOUNDRY_MODULE_ID.");

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    await maybeAuthenticate(page, password);
    await waitForSetupMenu(page, timeoutMs);
    await openModulesTab(page);
    const result = await updateModule(page, moduleId, timeoutMs);
    console.log(JSON.stringify({
      url,
      moduleId: result.moduleId,
      packageTitle: result.packageTitle,
      notification: result.notification,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
