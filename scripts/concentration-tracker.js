import { MODULE_ID } from "./api.js";

const CONCENTRATION_FLAG = "concentrationTracker";

function getObjectPath(object, path) {
  return path.reduce((current, key) => (current && current[key] !== undefined ? current[key] : null), object);
}

function stripHtmlTags(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|th|td|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSpellName(value) {
  return normalizeText(value)
    .replace(/\s*\((?:use|core|augment)\)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isConcentrationDurationValue(value) {
  if (value == null || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string" || typeof value === "number") {
    return /\bconcentration\b/i.test(String(value));
  }
  if (Array.isArray(value)) return value.some((entry) => isConcentrationDurationValue(entry));
  if (typeof value === "object") {
    if (value.concentration === true) return true;
    return ["value", "units", "unit", "type", "label", "text", "description"].some((key) => (
      isConcentrationDurationValue(value[key])
    ));
  }
  return false;
}

function itemHasConcentrationDuration(item) {
  if (!item) return false;
  const durationCandidates = [
    getObjectPath(item, ["system", "duration"]),
    getObjectPath(item, ["system", "duration", "value"]),
    getObjectPath(item, ["system", "duration", "units"]),
    getObjectPath(item, ["system", "duration", "concentration"]),
    getObjectPath(item, ["system", "actions"]),
    getObjectPath(item, ["data", "duration"]),
    getObjectPath(item, ["data", "data", "duration"]),
  ];
  if (durationCandidates.some((candidate) => isConcentrationDurationValue(candidate))) return true;

  const description = getObjectPath(item, ["system", "description", "value"])
    || getObjectPath(item, ["data", "description"])
    || getObjectPath(item, ["data", "data", "description", "value"])
    || "";
  return /(?:^|\n|\b)Duration:\s*Concentration\b/i.test(stripHtmlTags(description));
}

function parseSpellPointCostFromText(text) {
  const source = String(text || "");
  const costMatch = source.match(/\b(?:SP Cost|Spell Point Cost)\s*:?\s*(\d+)\b/i);
  if (costMatch) return Number(costMatch[1]);

  const genericMatch = source.match(/\bSP\s+Cost\s*:?\s*(\d+)\b/i)
    || source.match(/\bCost\s*:?\s*(\d+)\s*SP\b/i);
  return genericMatch ? Number(genericMatch[1]) : null;
}

function getSpellPointCost(item, fallbackText = "") {
  const parsedCardCost = parseSpellPointCostFromText(fallbackText);
  if (parsedCardCost != null) return Math.max(0, parsedCardCost);

  if (item) {
    const paths = [
      ["system", "spellPointCost"],
      ["system", "spellPoints", "cost"],
      ["system", "spCost"],
      ["system", "slotCost"],
      ["system", "uses", "spellPointCost"],
      ["data", "spellPointCost"],
      ["data", "data", "spellPointCost"],
    ];
    for (const path of paths) {
      const value = getObjectPath(item, path);
      const numeric = Number(value);
      if (value != null && value !== "" && Number.isFinite(numeric)) return Math.max(0, numeric);
    }
  }

  return Math.max(0, Number(parseSpellPointCostFromText(fallbackText) || 0));
}

function getItemImage(item) {
  return item?.img || getObjectPath(item, ["data", "img"]) || "icons/svg/mystery-man.svg";
}

function parseSpellImageFromContent(content) {
  const root = document.createElement("div");
  root.innerHTML = String(content || "");
  const selectors = [
    ".card-header img",
    "header img",
    ".item-image",
    ".item-img",
    "img",
  ];
  for (const selector of selectors) {
    const src = normalizeText(root.querySelector(selector)?.getAttribute("src"));
    if (src) return src;
  }
  return "";
}

function parseSpellNameFromContent(content) {
  const root = document.createElement("div");
  root.innerHTML = String(content || "");
  const selectors = [
    ".card-header h3",
    ".card-header h2",
    ".item-name",
    ".spell-name",
    "h3",
    "h2",
    "header",
  ];
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    const text = normalizeSpellName(node?.textContent);
    if (text) return text;
  }
  return "";
}

function contentHasConcentrationDuration(content) {
  return /(?:^|\n|\b)Duration:\s*Concentration\b/i.test(stripHtmlTags(content));
}

async function resolveMessageActor(message) {
  const speaker = message.speaker || {};
  if (speaker.actor) {
    const actor = game.actors?.get?.(speaker.actor);
    if (actor) return actor;
  }

  if (speaker.token && canvas?.tokens) {
    const token = canvas.tokens.get(speaker.token);
    if (token?.actor) return token.actor;
  }

  const actorUuid = message.getFlag?.("pf1", "actorUuid")
    || getObjectPath(message, ["flags", "pf1", "actorUuid"])
    || "";
  if (actorUuid && typeof fromUuid === "function") {
    const actor = await fromUuid(actorUuid).catch(() => null);
    if (actor) return actor;
  }

  return null;
}

async function resolveMessageItem(message, actor) {
  const directItem = message.item || message._item || null;
  if (directItem) return directItem;

  const itemUuid = message.getFlag?.("pf1", "itemUuid")
    || message.getFlag?.("pf1", "origin")
    || getObjectPath(message, ["flags", "pf1", "itemUuid"])
    || getObjectPath(message, ["flags", "pf1", "item", "uuid"])
    || getObjectPath(message, ["flags", "pf1", "origin"])
    || "";
  if (itemUuid && typeof fromUuid === "function") {
    const item = await fromUuid(itemUuid).catch(() => null);
    if (item) return item;
  }

  const itemId = message.getFlag?.("pf1", "itemId")
    || getObjectPath(message, ["flags", "pf1", "itemId"])
    || getObjectPath(message, ["flags", "pf1", "item", "id"])
    || "";
  if (itemId && actor?.items?.get) {
    const item = actor.items.get(itemId);
    if (item) return item;
  }

  const flagItem = message.getFlag?.("pf1", "item") || getObjectPath(message, ["flags", "pf1", "item"]) || null;
  if (flagItem?.name || flagItem?.system || flagItem?.data) return flagItem;

  return null;
}

function getStoredConcentrationEntries(actor) {
  const payload = actor?.getFlag?.(MODULE_ID, CONCENTRATION_FLAG) || {};
  return Array.isArray(payload?.spells) ? payload.spells : [];
}

async function addConcentrationEntry(actor, entry) {
  if (!actor?.setFlag) return;
  const spells = getStoredConcentrationEntries(actor);
  const addedEntry = {
    id: foundry?.utils?.randomID ? foundry.utils.randomID(16) : Math.random().toString(36).slice(2),
    name: normalizeSpellName(entry.name) || "Concentration Spell",
    img: normalizeText(entry.img) || "icons/svg/mystery-man.svg",
    spCost: Math.max(0, Number(entry.spCost) || 0),
    itemUuid: normalizeText(entry.itemUuid),
    messageId: normalizeText(entry.messageId),
    addedAt: Date.now(),
  };
  const nextSpells = [
    ...spells,
    addedEntry,
  ];
  await actor.setFlag(MODULE_ID, CONCENTRATION_FLAG, { spells: nextSpells });
  Hooks.callAll(`${MODULE_ID}.concentrationTrackerUpdated`, actor, nextSpells, addedEntry);
  return addedEntry;
}

async function maybeTrackConcentrationMessage(message) {
  const authorId = String(message.author?.id || message.user?.id || message.user || "");
  if (authorId && authorId !== String(game.user.id)) return;
  if (message.getFlag?.(MODULE_ID, "concentrationTrackerRoll")) return;

  const actor = await resolveMessageActor(message);
  if (!actor?.setFlag) return;

  const content = String(message.content || "");
  const item = await resolveMessageItem(message, actor);
  const isConcentration = itemHasConcentrationDuration(item) || contentHasConcentrationDuration(content);
  if (!isConcentration) return;

  const name = normalizeSpellName(item?.name) || parseSpellNameFromContent(content);
  const spCost = getSpellPointCost(item, content);
  const img = parseSpellImageFromContent(content) || getItemImage(item);
  await addConcentrationEntry(actor, {
    name,
    spCost,
    img,
    itemUuid: item?.uuid || "",
    messageId: message.id || "",
  });

  ui.notifications?.info?.(`${actor.name} is now concentrating on ${name || "a spell"} (${spCost} SP).`);
}

function registerConcentrationTracker() {
  if (globalThis.darkfinderConcentrationTrackerRegistered) return;
  globalThis.darkfinderConcentrationTrackerRegistered = true;

  Hooks.on("createChatMessage", (message) => {
    maybeTrackConcentrationMessage(message).catch((error) => {
      console.warn(`${MODULE_ID} | Concentration Tracker could not process a chat message.`, error);
    });
  });
}

export {
  CONCENTRATION_FLAG,
  registerConcentrationTracker,
};
