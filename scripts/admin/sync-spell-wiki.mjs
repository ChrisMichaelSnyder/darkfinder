import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_WIKI_BASE_URL,
  DEFAULT_WIKI_PAGE_TITLE,
  GENERATED_WIKI_DIR,
  parseArgs,
  toBoolean,
  buildSpellWikiSections,
  replaceManagedSection,
  writeSpellWikiExports,
} from "./spell-wiki-utils.mjs";

const USER_AGENT = "darkfinder-wiki-sync/1.0";

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  absorb(headers) {
    const setCookies = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ? [headers.get("set-cookie")] : []);

    for (const headerValue of setCookies) {
      const cookiePair = String(headerValue || "").split(";", 1)[0];
      const separatorIndex = cookiePair.indexOf("=");
      if (separatorIndex <= 0) continue;
      const name = cookiePair.slice(0, separatorIndex).trim();
      const value = cookiePair.slice(separatorIndex + 1).trim();
      if (!name) continue;
      this.cookies.set(name, value);
    }
  }

  toHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function buildApiUrl(baseUrl) {
  return new URL("/w/api.php", baseUrl).toString();
}

async function requestWiki(apiUrl, { method = "GET", params = null, form = null, cookieJar = null } = {}) {
  const url = new URL(apiUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const headers = {
    "User-Agent": USER_AGENT,
  };
  if (cookieJar?.toHeader()) {
    headers.cookie = cookieJar.toHeader();
  }

  let body;
  if (form) {
    body = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) {
      if (value == null) continue;
      body.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: "follow",
  });
  cookieJar?.absorb(response.headers);

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Wiki request failed with ${response.status}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertApiNoError(payload, context) {
  if (payload?.error) {
    const code = payload.error.code || "unknown";
    const info = payload.error.info || "Unknown wiki API error.";
    throw new Error(`${context} failed: ${code} - ${info}`);
  }
}

async function fetchLoginToken(apiUrl, cookieJar) {
  const payload = await requestWiki(apiUrl, {
    params: {
      action: "query",
      meta: "tokens",
      type: "login",
      format: "json",
    },
    cookieJar,
  });
  assertApiNoError(payload, "Login token fetch");
  const token = payload?.query?.tokens?.logintoken;
  if (!token) throw new Error("Wiki did not return a login token.");
  return token;
}

async function loginToWiki(apiUrl, cookieJar, username, password) {
  const loginToken = await fetchLoginToken(apiUrl, cookieJar);
  const payload = await requestWiki(apiUrl, {
    method: "POST",
    form: {
      action: "login",
      lgname: username,
      lgpassword: password,
      lgtoken: loginToken,
      format: "json",
    },
    cookieJar,
  });
  assertApiNoError(payload, "Wiki login");
  if (payload?.login?.result !== "Success") {
    throw new Error(`Wiki login failed: ${payload?.login?.result || "Unknown result"}.`);
  }
}

async function fetchCsrfToken(apiUrl, cookieJar) {
  const payload = await requestWiki(apiUrl, {
    params: {
      action: "query",
      meta: "tokens",
      format: "json",
    },
    cookieJar,
  });
  assertApiNoError(payload, "CSRF token fetch");
  const token = payload?.query?.tokens?.csrftoken;
  if (!token) throw new Error("Wiki did not return a CSRF token.");
  return token;
}

async function fetchPageRevision(apiUrl, cookieJar, title) {
  const payload = await requestWiki(apiUrl, {
    params: {
      action: "query",
      prop: "revisions",
      rvprop: "content|timestamp",
      rvslots: "main",
      titles: title,
      format: "json",
      formatversion: "2",
    },
    cookieJar,
  });
  assertApiNoError(payload, "Page fetch");
  const page = payload?.query?.pages?.[0];
  const revision = page?.revisions?.[0];
  const source = revision?.slots?.main?.content;
  const timestamp = revision?.timestamp || "";
  if (!page || page.missing) {
    throw new Error(`Wiki page "${title}" was not found.`);
  }
  if (typeof source !== "string") {
    throw new Error(`Wiki page "${title}" did not return editable source.`);
  }
  return { source, timestamp };
}

async function submitPageEdit(apiUrl, cookieJar, { title, text, summary, baseTimestamp, csrfToken }) {
  const payload = await requestWiki(apiUrl, {
    method: "POST",
    form: {
      action: "edit",
      title,
      text,
      summary,
      token: csrfToken,
      basetimestamp: baseTimestamp,
      contentmodel: "wikitext",
      format: "json",
      formatversion: "2",
      assert: "user",
    },
    cookieJar,
  });
  assertApiNoError(payload, "Wiki edit");
  if (payload?.edit?.result !== "Success") {
    throw new Error(`Wiki edit failed: ${payload?.edit?.result || "Unknown result"}.`);
  }
  return payload.edit;
}

function buildUpdatedSource(pageSource, sections) {
  let updatedSource = replaceManagedSection(pageSource, "Spell Augments", sections.spellAugments);
  updatedSource = replaceManagedSection(updatedSource, "Spell Cores", sections.spellCores);
  return updatedSource;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wikiBaseUrl = String(args["wiki-base-url"] || process.env.WIKI_BASE_URL || DEFAULT_WIKI_BASE_URL).trim();
  const wikiPageTitle = String(args["wiki-page"] || process.env.WIKI_PAGE || DEFAULT_WIKI_PAGE_TITLE).trim();
  const wikiUser = String(args["wiki-user"] || process.env.WIKI_USER || "").trim();
  const wikiPassword = String(args["wiki-password"] || process.env.WIKI_PASSWORD || "").trim();
  const editSummary = String(args.summary || process.env.WIKI_EDIT_SUMMARY || "Sync Spell Cores and Spell Augments from Darkfinder repo").trim();
  const dryRun = toBoolean(args["dry-run"] ?? process.env.WIKI_DRY_RUN, false);
  const outputDir = String(args["output-dir"] || GENERATED_WIKI_DIR).trim();

  const apiUrl = buildApiUrl(wikiBaseUrl);
  const sections = buildSpellWikiSections();
  const exportFiles = writeSpellWikiExports(outputDir, sections);

  const cookieJar = new CookieJar();
  if (!dryRun && (!wikiUser || !wikiPassword)) {
    throw new Error("Missing wiki credentials. Provide --wiki-user/--wiki-password or WIKI_USER/WIKI_PASSWORD.");
  }

  if (wikiUser && wikiPassword) {
    await loginToWiki(apiUrl, cookieJar, wikiUser, wikiPassword);
  }

  const currentRevision = await fetchPageRevision(apiUrl, cookieJar, wikiPageTitle);
  const updatedSource = buildUpdatedSource(currentRevision.source, sections);
  const changed = updatedSource !== currentRevision.source;

  const previewPath = path.join(outputDir, "spell-system.updated-preview.wiki.txt");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(previewPath, updatedSource, "utf8");

  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      changed,
      wikiPageTitle,
      wikiBaseUrl,
      previewPath: path.relative(process.cwd(), previewPath).replace(/\\/g, "/"),
      exportFiles: Object.fromEntries(Object.entries(exportFiles).map(([key, filePath]) => [
        key,
        path.relative(process.cwd(), filePath).replace(/\\/g, "/"),
      ])),
    }, null, 2));
    return;
  }

  if (!changed) {
    console.log(JSON.stringify({
      edited: false,
      changed: false,
      wikiPageTitle,
      wikiBaseUrl,
      message: "Wiki page is already in sync with the repo spell sources.",
    }, null, 2));
    return;
  }

  const csrfToken = await fetchCsrfToken(apiUrl, cookieJar);
  const editResult = await submitPageEdit(apiUrl, cookieJar, {
    title: wikiPageTitle,
    text: updatedSource,
    summary: editSummary,
    baseTimestamp: currentRevision.timestamp,
    csrfToken,
  });

  console.log(JSON.stringify({
    edited: true,
    changed: true,
    wikiPageTitle,
    wikiBaseUrl,
    newRevisionId: editResult.newrevid || null,
    newTimestamp: editResult.newtimestamp || "",
    previewPath: path.relative(process.cwd(), previewPath).replace(/\\/g, "/"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
