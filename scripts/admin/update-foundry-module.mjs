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

function normalizeSetupUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.pathname = "/setup";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

async function waitForAnyLocator(locators, timeoutMs) {
  await Promise.race(locators.map((locator) => (
    locator.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => null)
  )));
}

async function waitForSetupState(page, timeoutMs) {
  await waitForAnyLocator([
    page.locator("#setup-menu"),
    page.locator('input[name="adminPassword"]'),
    page.locator('button[data-action="yes"]'),
    page.locator("form#join-game-form button").filter({ hasText: "Return to Setup" }),
  ], timeoutMs);
}

async function maybeAuthenticate(page, password) {
  const passwordField = page.locator('input[name="adminPassword"]').first();
  await waitForAnyLocator([
    passwordField,
    page.locator("#setup-menu"),
    page.locator('button[data-action="yes"]'),
  ], 10000);

  if (!(await passwordField.isVisible().catch(() => false))) return false;

  await passwordField.fill(password);
  const authForm = passwordField.locator("xpath=ancestor::form[1]");
  const submitButton = authForm.locator('button[type="submit"]').first();
  if (await submitButton.isVisible().catch(() => false)) {
    await submitButton.click();
  } else {
    await passwordField.press("Enter");
  }
  await waitForSetupState(page, 15000);
  return true;
}

async function maybeConfirmReturnToSetup(page, timeoutMs) {
  const confirmYes = page.locator('button[data-action="yes"]').first();
  if (!(await confirmYes.isVisible().catch(() => false))) return false;
  await confirmYes.click();
  await waitForSetupState(page, timeoutMs);
  return true;
}

async function maybeOpenJoinSetup(page, timeoutMs) {
  const returnControl = page.locator("form#join-game-form button").filter({ hasText: "Return to Setup" }).first();
  if (!(await returnControl.isVisible().catch(() => false))) return false;
  await returnControl.click();
  await waitForSetupState(page, timeoutMs);
  return true;
}

async function navigateToSetup(page, url, timeoutMs) {
  const setupUrl = normalizeSetupUrl(url);
  await page.goto(setupUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForSetupState(page, timeoutMs);
  if (page.url().includes("/setup") || page.url().includes("/auth")) return;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForSetupState(page, timeoutMs);
}

async function waitForSetupMenu(page, timeoutMs) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await page.locator("#setup-menu").isVisible().catch(() => false)) return;
    await maybeConfirmReturnToSetup(page, 2000).catch(() => false);
    await maybeAuthenticate(page, process.env.FOUNDRY_ADMIN_PASSWORD || "").catch(() => false);
    await maybeOpenJoinSetup(page, 2000).catch(() => false);
    await page.waitForTimeout(1000);
  }
  await page.locator("#setup-menu").waitFor({ state: "visible", timeout: timeoutMs });
}

async function dismissTourOverlay(page) {
  const closeSelectors = [
    'button[aria-label="Close Tour"]',
    'button[data-action="close"]',
    ".tour button",
    ".introjs-skipbutton",
    ".shepherd-cancel-icon",
    ".shepherd-button",
  ];

  for (const selector of closeSelectors) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true }).catch(() => false);
    }
  }

  await page.evaluate(() => {
    for (const selector of [".tour-overlay", ".introjs-overlay", ".shepherd-modal-overlay-container"]) {
      document.querySelectorAll(selector).forEach((element) => element.remove());
    }
  }).catch(() => false);
}

async function openModulesTab(page) {
  await dismissTourOverlay(page);
  const tab = page.locator('#setup-packages-header [data-group="primary"][data-tab="modules"]');
  await tab.click({ force: true }).catch(async () => {
    await tab.evaluate((node) => node.click());
  });
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
    process.env.FOUNDRY_ADMIN_PASSWORD = password;
    await navigateToSetup(page, url, timeoutMs);
    await maybeOpenJoinSetup(page, timeoutMs).catch(() => false);
    await maybeConfirmReturnToSetup(page, timeoutMs).catch(() => false);
    await maybeAuthenticate(page, password);
    await maybeConfirmReturnToSetup(page, timeoutMs).catch(() => false);
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
