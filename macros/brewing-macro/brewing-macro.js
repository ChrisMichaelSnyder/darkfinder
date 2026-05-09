// Foundry VTT 13 macro for Pathfinder 1e potion brewing UI

(async () => {
  const actor = canvas.tokens.controlled[0]?.actor || game.user.character;
  if (!actor) {
    return ui.notifications.warn("Please select a token or set an active character before using Brewing.");
  }

  const STORAGE_KEY = `pf1-brewing-last-books-${actor.id}`;
  const FLAG_SCOPE = "pf1-brewing";

  const spellbooks = getSpellbooks(actor);
  if (!spellbooks.length) {
    return ui.notifications.warn("No spellbooks found on this actor. Add spellbook items first.");
  }

  const lastSelection = loadLastSelection();
  const defaultSpellbookId = getValidSpellbookId(lastSelection.spellbookId) || spellbooks[0]?.id || "";
  const state = {
    spellbookId: defaultSpellbookId,
    selectedSpellId: null,
    availableSpells: [],
    itemLookup: {},
  };

  installLongRestCleanupHook();

  const dialog = new Dialog({
    title: "Potion Brewing",
    content: buildDialogContent(spellbooks, state),
    buttons: {},
    width: 465,
    height: 820,
    resizable: true,
    render: async function(html) {
      dialog.setPosition({ width: 465, height: 820 });
      const appWindow = html.closest(".app.window-app");
      const dialogWindow = html.closest(".app.window-app, .dialog");
      let dialogContent = dialogWindow.find(".window-content");
      if (!dialogContent.length) dialogContent = html;

      if (appWindow.length) {
        appWindow.css({
          width: "465px",
          minWidth: "465px",
          maxWidth: "465px",
          height: "820px",
          minHeight: "820px",
          maxHeight: "820px",
        });
      }
      dialogWindow.css({
        width: "465px",
        height: "820px",
        minHeight: "820px",
        minWidth: "465px",
        maxWidth: "465px",
        maxHeight: "820px",
      });
      dialogContent.css({
        width: "100%",
        maxWidth: "465px",
        height: "100%",
        minHeight: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        padding: "0.75rem",
        boxSizing: "border-box",
      });
      html.css({
        width: "100%",
        height: "100%",
        minHeight: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
      });
      if (dialogWindow.length) {
        dialogWindow.addClass("brewing-dialog");
        dialogWindow.attr("data-brewing", "true");
      }

      bindDialogEvents(html, spellbooks, state, actor);
      await updateDialog(html, state, actor);
    },
  }).render(true);

  function loadLastSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn("Brewing macro could not read last selection.", err);
      return {};
    }
  }

  function saveLastSelection() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ spellbookId: state.spellbookId }));
    } catch (err) {
      console.warn("Brewing macro could not save last selection.", err);
    }
  }

  function getValidSpellbookId(candidate) {
    return spellbooks.some((book) => String(book.id) === String(candidate)) ? String(candidate) : "";
  }

  function installLongRestCleanupHook() {
    if (globalThis.pf1BrewingLongRestHookId != null) return;
    globalThis.pf1BrewingLongRestHookId = Hooks.on("pf1ActorRest", async (restActor, restOptions) => {
      try {
        if (!shouldDeleteDraughtsOnRest(restOptions)) return;
        await deleteBrewedDraughts(restActor);
      } catch (err) {
        console.warn("Brewing macro could not clean up draughts after rest.", err);
      }
    });
  }

  function shouldDeleteDraughtsOnRest(restOptions) {
    if (!restOptions || typeof restOptions !== "object") return false;
    if (restOptions.restoreDailyUses === true) return true;
    const hours = Number(restOptions.hours ?? 0);
    return !Number.isNaN(hours) && hours >= 8;
  }

  function isBrewedDraught(item) {
    return getObjectPath(item, ["flags", FLAG_SCOPE, "deleteOnLongRest"]) === true;
  }

  async function deleteBrewedDraughts(actor) {
    if (!actor?.items?.size && !Array.isArray(actor?.items)) return;
    const draughtIds = actor.items
      .filter((item) => isBrewedDraught(item))
      .map((item) => item.id)
      .filter(Boolean);
    if (!draughtIds.length) return;
    await actor.deleteEmbeddedDocuments("Item", draughtIds);
  }

  function getSelectedSpellbooksFromSheet(actor) {
    const selector = `.app.sheet.actor[data-actor-id="${actor.id}"]`;
    const sheetElement = document.querySelector(selector) || document;
    if (!sheetElement) return [];

    const checkboxSelectors = [
      '[data-group="spellbooks"] input[type="checkbox"]',
      '[data-group="spellbooks"] input[type="radio"]',
      'input[name*="spellbook"]',
    ];
    const inputs = sheetElement.querySelectorAll(checkboxSelectors.join(","));
    const spellbookEntries = new Map();

    inputs.forEach((input) => {
      if (!input.checked) return;
      const fieldName = input.name || input.id || "";
      const match = fieldName.match(/spellbooks?\.([^\.\]]+)/i) || fieldName.match(/spellbook\.([^\.\]]+)/i);
      const id = match?.[1] || input.value || input.id || "";
      if (!id) return;

      let label = "";
      const labelElement = input.closest("label") || document.querySelector(`label[for="${input.id}"]`);
      if (labelElement) label = labelElement.textContent.trim();
      if (!label && input.getAttribute("aria-label")) label = input.getAttribute("aria-label").trim();
      if (!label && input.title) label = input.title.trim();
      if (!label) label = String(input.value || input.id || id).trim();

      spellbookEntries.set(String(id), label);
    });

    return Array.from(spellbookEntries.entries()).map(([id, name]) => ({ id, name, source: "sheet" }));
  }

  function resolveSpellbookAttributeEntry(actor, search) {
    const attributeSpellbooks = getObjectPath(actor.system, ["attributes", "spells", "spellbooks"]);
    if (!attributeSpellbooks || typeof attributeSpellbooks !== "object") return null;
    const normalizedSearch = String(search || "").trim().toLowerCase();
    return Object.entries(attributeSpellbooks).find(([key, entry]) => {
      if (!entry || typeof entry !== "object") return false;
      if (String(key).toLowerCase() === normalizedSearch) return true;
      if (String(entry?.id || "").toLowerCase() === normalizedSearch) return true;
      if (String(entry?.key || "").toLowerCase() === normalizedSearch) return true;
      if (String(entry?.name || "").toLowerCase() === normalizedSearch) return true;
      if (String(entry?.label || "").toLowerCase() === normalizedSearch) return true;
      if (String(getObjectPath(entry, ["spellbook", "name"]) || "").toLowerCase() === normalizedSearch) return true;
      if (String(getObjectPath(entry, ["book", "name"]) || "").toLowerCase() === normalizedSearch) return true;
      return false;
    }) || null;
  }

  function getSpellbooks(actor) {
    const bookMap = new Map();
    const addBook = (id, name, source) => {
      if (!id) return;
      const normalizedId = String(id);
      if (!bookMap.has(normalizedId)) {
        bookMap.set(normalizedId, { id: normalizedId, name: name || `Spellbook ${bookMap.size + 1}`, source });
      }
    };

    const isSelectedSpellbookEntry = (entry) => {
      if (!entry || typeof entry !== "object") return false;
      const truthyValues = (value) => {
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value === 1;
        if (typeof value === "string") return ["1", "true", "yes", "on", "enabled"].includes(value.toLowerCase());
        return false;
      };
      if (truthyValues(entry.value)) return true;
      if (truthyValues(entry.enabled)) return true;
      if (truthyValues(entry.active)) return true;
      if (truthyValues(entry.selected)) return true;
      if (truthyValues(entry.isSelected)) return true;
      if (truthyValues(entry.isActive)) return true;
      if (truthyValues(entry.checked)) return true;
      if (truthyValues(entry.visible)) return true;
      if (typeof entry.disabled === "boolean" && entry.disabled) return false;
      if (typeof entry.inactive === "boolean" && entry.inactive) return false;
      if (typeof entry.isDisabled === "boolean" && entry.isDisabled) return false;
      if (typeof entry.isInactive === "boolean" && entry.isInactive) return false;
      return false;
    };

    const addAttributeSpellbooks = (path) => {
      const attributeSpellbooks = getObjectPath(actor.system, path);
      if (!attributeSpellbooks || typeof attributeSpellbooks !== "object") return;
      Object.entries(attributeSpellbooks).forEach(([key, value]) => {
        if (!value || typeof value !== "object") return;
        if (value.inUse !== true && !isSelectedSpellbookEntry(value)) return;
        const name = value.name || value.label || getObjectPath(value, ["spellbook", "name"]) || getObjectPath(value, ["book", "name"]) || key;
        addBook(key, name, "attributes");
      });
    };

    addAttributeSpellbooks(["attributes", "spells", "spellbooks"]);
    if (bookMap.size) return Array.from(bookMap.values());

    const sheetSpellbooks = getSelectedSpellbooksFromSheet(actor);
    if (sheetSpellbooks.length) {
      sheetSpellbooks.forEach((book) => {
        const resolved = resolveSpellbookAttributeEntry(actor, book.id);
        const id = resolved?.[0] || book.id;
        const entry = resolved?.[1];
        const name = entry
          ? entry.name || entry.label || getObjectPath(entry, ["spellbook", "name"]) || getObjectPath(entry, ["book", "name"])
          : book.name || book.id;
        addBook(id, name, book.source);
      });
      return Array.from(bookMap.values());
    }

    actor.items.forEach((item) => {
      const typeName = item.type?.toLowerCase?.() ?? "";
      const nameText = item.name?.toLowerCase?.() ?? "";
      if (typeName === "spellbook" || typeName === "book" || nameText.includes("spellbook")) {
        addBook(item.id, item.name, "item");
      }
    });

    actor.items.filter((item) => item.type === "spell").forEach((spell) => {
      getSpellbookRefs(spell).forEach((ref) => addBook(ref.id, ref.name || ref.id, "derived"));
    });

    return Array.from(bookMap.values());
  }

  function getSpellbookRefs(spell) {
    const flags = spell.flags || {};
    const nodes = [
      { id: getObjectPath(flags, ["pf1", "spellbook", "id"]), name: getObjectPath(flags, ["pf1", "spellbook", "name"]) },
      { id: getObjectPath(flags, ["spellbook", "id"]), name: getObjectPath(flags, ["spellbook", "name"]) },
      { id: getObjectPath(spell, ["system", "spellbook", "id"]), name: getObjectPath(spell, ["system", "spellbook", "name"]) },
      { id: getObjectPath(spell, ["system", "spellbook"]), name: getObjectPath(spell, ["system", "spellbook", "name"]) },
      { id: getObjectPath(spell, ["data", "spellbook", "id"]), name: getObjectPath(spell, ["data", "spellbook", "name"]) },
      { id: getObjectPath(spell, ["data", "spellbook"]), name: getObjectPath(spell, ["data", "spellbook", "name"]) },
      { id: getObjectPath(spell, ["system", "spellbook", "name"]), name: getObjectPath(spell, ["system", "spellbook", "name"]) },
      { id: getObjectPath(spell, ["data", "spellbook", "name"]), name: getObjectPath(spell, ["data", "spellbook", "name"]) },
    ];
    return nodes
      .filter((node) => node && node.id != null)
      .map((node) => ({ id: String(node.id), name: node.name || String(node.id) }))
      .reduce((unique, node) => {
        if (!unique.some((existing) => existing.id === node.id)) unique.push(node);
        return unique;
      }, []);
  }

  function getSpellbookSpells(actor, bookId) {
    return actor.items.filter((item) => {
      if (item.type !== "spell") return false;
      return getSpellbookRefs(item).some((ref) => String(ref.id) === String(bookId));
    });
  }

  function getItemSourceKey(item) {
    if (!item) return "";
    return item.pack ? `${item.pack}:${item.id}` : String(item.id || "");
  }

  function getActiveItemById(state, itemId) {
    return state.itemLookup?.[String(itemId)] || null;
  }

  function indexItemsBySourceKey(items) {
    const lookup = {};
    for (const item of items) {
      const key = getItemSourceKey(item);
      if (key) lookup[key] = item;
    }
    return lookup;
  }

  function sortItemsByDisplayName(items) {
    return [...items].sort((left, right) => {
      const leftName = getDisplaySpellName(left?.name || "");
      const rightName = getDisplaySpellName(right?.name || "");
      return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
    });
  }

  function getDisplaySpellName(name) {
    return String(name || "")
      .replace(/\s*\((?:core|augment)\)\s*/gi, " ")
      .replace(/\b(?:core|augment)\b\s*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function getSpellDescription(item) {
    return item?.system?.description?.value || item?.data?.description || item?.data?.data?.description?.value || item?.data?.system?.description?.value || "";
  }

  function getSpellSchool(item) {
    const schoolMap = {
      abj: "Abjuration",
      abjuration: "Abjuration",
      con: "Conjuration",
      conjuration: "Conjuration",
      div: "Divination",
      divination: "Divination",
      enc: "Enchantment",
      enchantment: "Enchantment",
      evo: "Evocation",
      evocation: "Evocation",
      ill: "Illusion",
      illusion: "Illusion",
      nec: "Necromancy",
      necromancy: "Necromancy",
      trs: "Transmutation",
      tra: "Transmutation",
      transmutation: "Transmutation",
      uni: "Universal",
      universal: "Universal",
    };
    const searchPaths = [
      ["system", "school"],
      ["system", "spellSchool"],
      ["system", "school", "name"],
      ["system", "spellSchool", "name"],
      ["data", "school"],
      ["data", "spellSchool"],
      ["data", "data", "school"],
      ["data", "data", "spellSchool"],
    ];
    for (const path of searchPaths) {
      const value = getObjectPath(item, path);
      if (value == null || value === "") continue;
      if (typeof value === "string" || typeof value === "number") {
        const normalized = String(value).trim();
        return schoolMap[normalized.toLowerCase()] || normalized;
      }
      if (typeof value === "object") {
        const nested = value.name || value.label || value.value;
        if (nested != null && nested !== "") {
          const normalized = String(nested).trim();
          return schoolMap[normalized.toLowerCase()] || normalized;
        }
      }
    }
    return "";
  }

  function normalizeAttributeValue(value) {
    if (value == null || value === "") return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeAttributeValue(entry)).filter(Boolean).join(", ").trim();
    }
    if (typeof value === "object") {
      const preferredKeys = ["value", "current", "name", "label", "text", "description", "units"];
      for (const key of preferredKeys) {
        const nested = normalizeAttributeValue(value[key]);
        if (nested) return nested;
      }
    }
    return "";
  }

  function findFieldByKeyPatterns(object, patterns) {
    if (!object || typeof object !== "object") return null;
    for (const [key, value] of Object.entries(object)) {
      if (patterns.some((pattern) => pattern.test(String(key || "")))) {
        const normalized = normalizeAttributeValue(value);
        if (normalized) return normalized;
      }
      if (value && typeof value === "object") {
        const nested = findFieldByKeyPatterns(value, patterns);
        if (nested) return nested;
      }
    }
    return null;
  }

  function getSpellAttributeValue(item, searchPaths, keyPatterns) {
    for (const path of searchPaths || []) {
      const value = getObjectPath(item, path);
      const normalized = normalizeAttributeValue(value);
      if (normalized) return normalized;
    }
    return normalizeAttributeValue(findFieldByKeyPatterns(item, keyPatterns || [])) || "None";
  }

  function formatActivationDisplay(cost, type) {
    const normalizedType = String(type || "").trim().toLowerCase();
    const normalizedCost = cost == null || cost === "" ? null : Number(cost);
    const typeLabels = {
      passive: "Passive",
      nonaction: "Passive",
      free: "Free",
      swift: "Swift",
      immediate: "Immediate",
      standard: "Standard",
      move: "Move",
      full: "Full Round",
      round: "Round",
      minute: "Minute",
      hour: "Hour",
      day: "Day",
    };

    if (!normalizedType && normalizedCost == null) return "";
    if (normalizedType === "passive" || normalizedType === "nonaction") return "Passive";

    const typeLabel = typeLabels[normalizedType] || String(type || "").trim();
    if (!typeLabel) return normalizedCost == null ? "" : String(cost).trim();
    if (normalizedCost == null || Number.isNaN(normalizedCost)) return typeLabel;
    if (normalizedCost === 1 && ["standard", "move", "swift", "immediate", "free", "full"].includes(normalizedType)) return typeLabel;
    if (normalizedCost === 1) return `1 ${typeLabel}`;
    return `${normalizedCost} ${typeLabel}s`;
  }

  function getItemActionEntries(itemData) {
    const actions = itemData?.system?.actions;
    if (!actions) return [];
    if (Array.isArray(actions)) return actions.filter((action) => action && typeof action === "object");
    if (typeof actions === "object") return Object.values(actions).filter((action) => action && typeof action === "object");
    return [];
  }

  function getSpellCastingTime(item) {
    const actionEntries = getItemActionEntries(item);
    for (const action of actionEntries) {
      const display = formatActivationDisplay(
        getObjectPath(action, ["activation", "cost"]),
        getObjectPath(action, ["activation", "type"]),
      );
      if (display) return display;

      const unchainedDisplay = formatActivationDisplay(
        getObjectPath(action, ["activation", "unchained", "cost"]),
        getObjectPath(action, ["activation", "unchained", "type"]),
      );
      if (unchainedDisplay) return unchainedDisplay;
    }

    const directDisplay = formatActivationDisplay(
      getObjectPath(item, ["system", "activation", "cost"]),
      getObjectPath(item, ["system", "activation", "type"]),
    );
    if (directDisplay) return directDisplay;

    return getSpellAttributeValue(item, [
      ["system", "castingTime"],
      ["system", "castTime"],
      ["system", "time"],
      ["data", "castingTime"],
      ["data", "castTime"],
    ], [/casting.*time/i, /^cast.*time$/i, /^time$/i, /^activation$/i]);
  }

  function getSpellRange(item) {
    return getSpellAttributeValue(item, [
      ["system", "range"],
      ["system", "range", "value"],
      ["system", "range", "units"],
      ["data", "range"],
    ], [/^range$/i]);
  }

  function getSpellTarget(item) {
    return getSpellAttributeValue(item, [
      ["system", "target"],
      ["system", "target", "value"],
      ["system", "targets"],
      ["system", "effect"],
      ["data", "target"],
      ["data", "targets"],
    ], [/^targets?$/i, /^effect$/i, /^area$/i]);
  }

  function formatDurationDisplay(durationData) {
    if (durationData == null || durationData === "") return "";
    if (typeof durationData === "string" || typeof durationData === "number") return String(durationData).trim();
    if (typeof durationData !== "object") return "";

    const value = normalizeAttributeValue(
      durationData.value
      ?? durationData.amount
      ?? durationData.current
      ?? durationData.text,
    );
    const unitsRaw = normalizeAttributeValue(
      durationData.units
      ?? durationData.unit
      ?? durationData.type
      ?? durationData.label,
    );
    const unitsMap = {
      round: "round",
      rounds: "rounds",
      rnd: "round",
      minute: "minute",
      minutes: "minutes",
      min: "minute",
      hour: "hour",
      hours: "hours",
      hr: "hour",
      day: "day",
      days: "days",
      week: "week",
      weeks: "weeks",
      month: "month",
      months: "months",
      year: "year",
      years: "years",
      turn: "turn",
      turns: "turns",
      perm: "permanent",
      permanent: "permanent",
      spec: "",
      special: "",
      inst: "instantaneous",
      instantaneous: "instantaneous",
      seeText: "see text",
      text: "see text",
    };
    const units = unitsMap[String(unitsRaw || "").trim().toLowerCase()] ?? unitsRaw;

    if (value && units) return `${value} ${units}`.trim();
    if (value) return value;
    if (units) return units;

    const concentration = durationData.concentration === true ? "Concentration" : "";
    const dismiss = durationData.dismiss === true ? "(D)" : "";
    return [concentration, dismiss].filter(Boolean).join(" ").trim();
  }

  function getSpellDuration(item) {
    const actionEntries = getItemActionEntries(item);
    for (const action of actionEntries) {
      const actionDuration = formatDurationDisplay(getObjectPath(action, ["duration"]));
      if (actionDuration) return actionDuration;
    }

    const directDuration = formatDurationDisplay(getObjectPath(item, ["system", "duration"]));
    if (directDuration) return directDuration;

    const alternateDuration = formatDurationDisplay({
      value: getObjectPath(item, ["system", "duration", "value"]),
      units: getObjectPath(item, ["system", "duration", "units"])
        || getObjectPath(item, ["system", "duration", "unit"])
        || getObjectPath(item, ["system", "duration", "type"]),
      concentration: getObjectPath(item, ["system", "duration", "concentration"]),
      dismiss: getObjectPath(item, ["system", "duration", "dismiss"]),
    });
    if (alternateDuration) return alternateDuration;

    return getSpellAttributeValue(item, [
      ["system", "duration", "value"],
      ["system", "duration", "units"],
      ["system", "duration", "unit"],
      ["system", "duration", "type"],
      ["data", "duration"],
    ], [/^duration$/i]);
  }

  function getSpellSavingThrow(item) {
    return getSpellAttributeValue(item, [
      ["system", "save", "description"],
      ["system", "save", "type"],
      ["system", "savingThrow"],
      ["system", "save"],
      ["data", "savingThrow"],
    ], [/saving.*throw/i, /^save$/i]);
  }

  function floorHalf(value) {
    return Math.floor(Number(value || 0) / 2);
  }

  function normalizeAbilityKey(value) {
    const normalized = String(value || "").trim().toLowerCase();
    const aliases = {
      str: "str",
      strength: "str",
      dex: "dex",
      dexterity: "dex",
      con: "con",
      constitution: "con",
      int: "int",
      intelligence: "int",
      wis: "wis",
      wisdom: "wis",
      cha: "cha",
      charisma: "cha",
    };
    return aliases[normalized] || null;
  }

  function getAbilityDisplayName(value) {
    const normalizedKey = normalizeAbilityKey(value);
    const labels = {
      str: "Strength",
      dex: "Dexterity",
      con: "Constitution",
      int: "Intelligence",
      wis: "Wisdom",
      cha: "Charisma",
    };
    return labels[normalizedKey] || "spellcasting ability";
  }

  function normalizeSchoolKey(value) {
    const normalized = String(value || "").trim().toLowerCase();
    const aliases = {
      abj: "abj",
      abjuration: "abj",
      con: "con",
      conjuration: "con",
      div: "div",
      divination: "div",
      enc: "enc",
      enchantment: "enc",
      evo: "evo",
      evocation: "evo",
      ill: "ill",
      illusion: "ill",
      nec: "nec",
      necromancy: "nec",
      trs: "trs",
      tra: "trs",
      transmutation: "trs",
      uni: "uni",
      universal: "uni",
    };
    return aliases[normalized] || null;
  }

  function getSpellSchoolDisplayName(value) {
    const normalizedKey = normalizeSchoolKey(value);
    const labels = {
      abj: "Abjuration",
      con: "Conjuration",
      div: "Divination",
      enc: "Enchantment",
      evo: "Evocation",
      ill: "Illusion",
      nec: "Necromancy",
      trs: "Transmutation",
      uni: "Universal",
    };
    return labels[normalizedKey] || String(value || "").trim() || "Spell";
  }

  function parseBonusNumericValue(value) {
    if (value == null || value === "") return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return 0;
      if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
      if (!/^[\d+\-.\s()]+$/.test(text)) return 0;
      const matches = text.match(/[+-]?\d+(?:\.\d+)?/g);
      if (!matches) return 0;
      return matches.reduce((sum, match) => sum + Number(match), 0);
    }
    return 0;
  }

  function getFirstNumericBonusFromPaths(object, paths) {
    for (const path of paths || []) {
      const value = getObjectPath(object, path);
      const bonus = parseBonusNumericValue(value);
      if (bonus) return bonus;
    }
    return 0;
  }

  function getGenericSpellDcBonusFromEntry(entry) {
    if (!entry || typeof entry !== "object") return 0;
    const directPaths = [
      ["spellDCBonus"],
      ["spellDcBonus"],
      ["dcBonus"],
      ["saveDcBonus"],
      ["bonuses", "spellDC"],
      ["bonuses", "spellDc"],
      ["bonuses", "dc"],
      ["spell", "dcBonus"],
      ["spell", "spellDCBonus"],
    ];
    return getFirstNumericBonusFromPaths(entry, directPaths);
  }

  function getSchoolSpecificSpellDcBonusFromEntry(entry, schoolKey) {
    if (!entry || typeof entry !== "object" || !schoolKey) return 0;
    const schoolPaths = [
      ["schools", schoolKey, "dcBonus"],
      ["schools", schoolKey, "spellDCBonus"],
      ["schoolBonuses", schoolKey, "dcBonus"],
      ["schoolBonuses", schoolKey, "spellDCBonus"],
      ["bonuses", "schools", schoolKey, "dc"],
      ["bonuses", "schools", schoolKey, "spellDC"],
      ["bonuses", "school", schoolKey, "dc"],
      ["bonuses", "school", schoolKey, "spellDC"],
    ];
    return getFirstNumericBonusFromPaths(entry, schoolPaths);
  }

  function getGenericSpellDcBonusFromActor(actor) {
    if (!actor) return 0;
    const actorPaths = [
      ["system", "attributes", "spells", "dcBonus"],
      ["system", "attributes", "spells", "spellDCBonus"],
      ["system", "bonuses", "spells", "dc"],
      ["system", "bonuses", "spells", "spellDC"],
    ];
    return getFirstNumericBonusFromPaths(actor, actorPaths);
  }

  function getSchoolSpecificSpellDcBonusFromActor(actor, schoolKey) {
    if (!actor || !schoolKey) return 0;
    const actorPaths = [
      ["system", "bonuses", "spells", "school", schoolKey, "dc"],
      ["system", "bonuses", "spells", "school", schoolKey, "spellDC"],
      ["system", "bonuses", "spells", "schools", schoolKey, "dc"],
      ["system", "bonuses", "spells", "schools", schoolKey, "spellDC"],
      ["system", "attributes", "spells", "schools", schoolKey, "dcBonus"],
      ["system", "attributes", "spells", "schoolBonuses", schoolKey, "dcBonus"],
    ];
    return getFirstNumericBonusFromPaths(actor, actorPaths);
  }

  function isItemDisabledForSpellBonuses(item) {
    return getObjectPath(item, ["disabled"]) === true
      || getObjectPath(item, ["system", "disabled"]) === true
      || getObjectPath(item, ["data", "disabled"]) === true
      || getObjectPath(item, ["data", "data", "disabled"]) === true;
  }

  function getItemChangeEntries(item) {
    const candidates = [
      getObjectPath(item, ["system", "changes"]),
      getObjectPath(item, ["changes"]),
      getObjectPath(item, ["data", "changes"]),
      getObjectPath(item, ["data", "system", "changes"]),
      getObjectPath(item, ["data", "data", "changes"]),
    ];
    const entries = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (Array.isArray(candidate)) {
        entries.push(...candidate.filter((entry) => entry && typeof entry === "object"));
        continue;
      }
      if (typeof candidate === "object") {
        entries.push(...Object.values(candidate).filter((entry) => entry && typeof entry === "object"));
      }
    }
    return entries;
  }

  function getSpellDcBonusValueFromChange(change) {
    return parseBonusNumericValue(
      change.value
      ?? change.formula
      ?? change.modifier
      ?? change.bonus
      ?? change.amount,
    );
  }

  function doesChangeReferenceSpellDc(change) {
    const rawFields = [
      change?.name,
      change?.label,
      change?.target,
      change?.subTarget,
      change?.modifier,
      change?.type,
      change?.key,
      change?.path,
      change?.field,
      change?.category,
    ];
    const normalizedFields = rawFields
      .filter((value) => value != null && value !== "")
      .map((value) => String(value).trim().toLowerCase());
    const blob = normalizedFields.join(" ");
    return {
      normalizedFields,
      blob,
      referencesDc: /(adjust\s*dc|spell\s*dc|save\s*dc|\bdc\b)/i.test(blob),
    };
  }

  function getGenericSpellDcBonusFromItemChanges(item) {
    if (!item) return 0;
    let total = 0;
    for (const change of getItemChangeEntries(item)) {
      const { normalizedFields, referencesDc } = doesChangeReferenceSpellDc(change);
      if (!referencesDc) continue;
      const referencesSchool = normalizedFields.some((value) => normalizeSchoolKey(value))
        || normalizedFields.some((value) => /\.school\./i.test(value))
        || normalizedFields.some((value) => /\((abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation|universal)\)/i.test(value));
      if (referencesSchool) continue;
      const bonus = getSpellDcBonusValueFromChange(change);
      if (bonus) total += bonus;
    }
    return total;
  }

  function getSchoolSpecificSpellDcBonusFromItemChanges(item, schoolKey) {
    if (!item || !schoolKey) return 0;
    const schoolDisplayName = getSpellSchoolDisplayName(schoolKey).toLowerCase();
    let total = 0;

    const fieldMentionsSchool = (value) => {
      const text = String(value || "").trim().toLowerCase();
      if (!text) return false;
      if (normalizeSchoolKey(text) === schoolKey) return true;
      if (text.includes(schoolDisplayName)) return true;
      const segments = text.split(/[^a-z]+/i).filter(Boolean);
      return segments.some((segment) => normalizeSchoolKey(segment) === schoolKey);
    };

    for (const change of getItemChangeEntries(item)) {
      const { normalizedFields, blob, referencesDc } = doesChangeReferenceSpellDc(change);
      const referencesSchool = normalizedFields.some((value) => fieldMentionsSchool(value))
        || blob.includes(`(${schoolDisplayName})`);
      if (!referencesDc || !referencesSchool) continue;
      const bonus = getSpellDcBonusValueFromChange(change);
      if (bonus) total += bonus;
    }

    return total;
  }

  function getGenericSpellDcBonusFromItems(actor) {
    if (!actor) return 0;
    let total = 0;
    for (const item of actor.items || []) {
      if (isItemDisabledForSpellBonuses(item)) continue;
      total += getGenericSpellDcBonusFromItemChanges(item);
    }
    return total;
  }

  function getSchoolSpecificSpellDcBonusFromItems(actor, schoolKey) {
    if (!actor || !schoolKey) return 0;
    let total = 0;
    for (const item of actor.items || []) {
      if (isItemDisabledForSpellBonuses(item)) continue;

      const changeBonus = getSchoolSpecificSpellDcBonusFromItemChanges(item, schoolKey);
      if (changeBonus) {
        total += changeBonus;
        continue;
      }

      const name = String(item?.name || "").trim();
      let match = name.match(/^Spell Focus\s*[:(]\s*([^)]+?)\s*\)?$/i);
      if (match && normalizeSchoolKey(match[1]) === schoolKey) {
        total += 1;
        continue;
      }
      match = name.match(/^Greater Spell Focus\s*[:(]\s*([^)]+?)\s*\)?$/i);
      if (match && normalizeSchoolKey(match[1]) === schoolKey) {
        total += 1;
      }
    }
    return total;
  }

  function getSpellAttackDcBonusTerms(actor, spellbookId, schoolName) {
    const schoolKey = normalizeSchoolKey(schoolName);
    const spellbookEntry = resolveSpellbookAttributeEntry(actor, spellbookId)?.[1];
    const terms = [];

    const genericEntryBonus = getGenericSpellDcBonusFromEntry(spellbookEntry);
    if (genericEntryBonus) terms.push({ bonus: genericEntryBonus, label: "Spell DC" });

    const genericActorBonus = getGenericSpellDcBonusFromActor(actor);
    if (genericActorBonus) terms.push({ bonus: genericActorBonus, label: "Spell DC" });

    const genericItemBonus = getGenericSpellDcBonusFromItems(actor);
    if (genericItemBonus) terms.push({ bonus: genericItemBonus, label: "Spell DC" });

    if (schoolKey) {
      const entryBonus = getSchoolSpecificSpellDcBonusFromEntry(spellbookEntry, schoolKey);
      if (entryBonus) terms.push({ bonus: entryBonus, label: `${getSpellSchoolDisplayName(schoolKey)} Spell DC` });

      const actorBonus = getSchoolSpecificSpellDcBonusFromActor(actor, schoolKey);
      if (actorBonus) terms.push({ bonus: actorBonus, label: `${getSpellSchoolDisplayName(schoolKey)} Spell DC` });

      const itemBonus = getSchoolSpecificSpellDcBonusFromItems(actor, schoolKey);
      if (itemBonus) terms.push({ bonus: itemBonus, label: `${getSpellSchoolDisplayName(schoolKey)} Spell DC` });
    }

    return terms;
  }

  function getActorAbilityModifier(actor, abilityKey) {
    const normalizedKey = normalizeAbilityKey(abilityKey);
    if (!normalizedKey) return null;
    const abilityEntry = getObjectPath(actor, ["system", "abilities", normalizedKey]);
    if (!abilityEntry || typeof abilityEntry !== "object") return null;

    const explicitModPaths = [
      ["mod"],
      ["modifier"],
      ["totalMod"],
      ["abilityMod"],
    ];
    for (const path of explicitModPaths) {
      const rawValue = getObjectPath(abilityEntry, path);
      const numeric = Number(rawValue);
      if (rawValue != null && rawValue !== "" && !Number.isNaN(numeric)) return numeric;
    }

    const scoreCandidates = [
      getObjectPath(abilityEntry, ["total"]),
      getObjectPath(abilityEntry, ["value"]),
      getObjectPath(abilityEntry, ["score"]),
    ];
    for (const candidate of scoreCandidates) {
      const numeric = Number(candidate);
      if (candidate != null && candidate !== "" && !Number.isNaN(numeric)) {
        return Math.floor((numeric - 10) / 2);
      }
    }

    return null;
  }

  function getSpellbookCasterLevel(actor, spellbookId) {
    const entry = resolveSpellbookAttributeEntry(actor, spellbookId)?.[1];
    if (!entry || typeof entry !== "object") return null;

    const explicitPaths = [
      ["cl", "total"],
      ["cl", "value"],
      ["cl"],
      ["casterLevel", "total"],
      ["casterLevel", "value"],
      ["casterLevel"],
      ["spellcasting", "level"],
      ["spellcastingLevel"],
      ["level"],
    ];
    for (const path of explicitPaths) {
      const rawValue = getObjectPath(entry, path);
      const numeric = Number(rawValue);
      if (rawValue != null && rawValue !== "" && !Number.isNaN(numeric)) return numeric;
    }

    return findNumericLeafPath(entry, {
      include: [/^cl$/i, /caster.*level/i, /spellcasting.*level/i],
      exclude: [/max/i, /base/i, /temp/i, /used/i, /spent/i, /cost/i],
    });
  }

  function getSpellbookCastingAbilityModifier(actor, spellbookId) {
    const entry = resolveSpellbookAttributeEntry(actor, spellbookId)?.[1];
    if (!entry || typeof entry !== "object") return null;

    const explicitAbilityKeyPaths = [
      ["ability"],
      ["abilityKey"],
      ["abilityScore"],
      ["castingAbility"],
      ["spellcastingAbility"],
      ["ability", "value"],
      ["casting", "ability"],
    ];
    for (const path of explicitAbilityKeyPaths) {
      const abilityKey = normalizeAbilityKey(getObjectPath(entry, path));
      if (!abilityKey) continue;
      const actorMod = getActorAbilityModifier(actor, abilityKey);
      if (actorMod != null) return actorMod;
    }

    const explicitModifierPaths = [
      ["abilityMod"],
      ["spellcastingAbilityMod"],
      ["castingAbilityMod"],
      ["ability", "mod"],
      ["casting", "abilityMod"],
    ];
    for (const path of explicitModifierPaths) {
      const rawValue = getObjectPath(entry, path);
      const numeric = Number(rawValue);
      if (rawValue != null && rawValue !== "" && !Number.isNaN(numeric)) return numeric;
    }

    return null;
  }

  function getSpellbookCastingAbilityLabel(actor, spellbookId) {
    const entry = resolveSpellbookAttributeEntry(actor, spellbookId)?.[1];
    if (!entry || typeof entry !== "object") return "spellcasting ability";

    const explicitAbilityKeyPaths = [
      ["ability"],
      ["abilityKey"],
      ["abilityScore"],
      ["castingAbility"],
      ["spellcastingAbility"],
      ["ability", "value"],
      ["casting", "ability"],
    ];
    for (const path of explicitAbilityKeyPaths) {
      const rawValue = getObjectPath(entry, path);
      const normalizedKey = normalizeAbilityKey(rawValue);
      if (normalizedKey) return getAbilityDisplayName(normalizedKey);
    }

    return "spellcasting ability";
  }

  function getSpellAttackData(actor, spellbookId, schoolName) {
    const casterLevel = Number(getSpellbookCasterLevel(actor, spellbookId) || 0);
    const casterLevelHalf = floorHalf(casterLevel);
    const abilityMod = Number(getSpellbookCastingAbilityModifier(actor, spellbookId) || 0);
    const abilityLabel = getSpellbookCastingAbilityLabel(actor, spellbookId);
    const dcBonusTerms = getSpellAttackDcBonusTerms(actor, spellbookId, schoolName);
    const dcBonusTotal = dcBonusTerms.reduce((sum, term) => sum + Number(term.bonus || 0), 0);
    const labeledTerms = [
      `10`,
      `${casterLevelHalf}[Half CL]`,
      `${abilityMod}[${abilityLabel}]`,
    ];
    if (dcBonusTotal) labeledTerms.push(`${dcBonusTotal}[DC Bonus]`);
    return {
      casterLevel,
      casterLevelHalf,
      abilityMod,
      abilityLabel,
      dcBonusTerms,
      dcBonusTotal,
      totalBonus: 10 + casterLevelHalf + abilityMod + dcBonusTotal,
      formulaText: labeledTerms.join(" + "),
    };
  }

  function getSpellSaveDc(item) {
    const actionEntries = getItemActionEntries(item);
    for (const action of actionEntries) {
      const actionDc = Number(
        getObjectPath(action, ["save", "dc"])
        ?? getObjectPath(action, ["save", "value"])
        ?? getObjectPath(action, ["save", "total"])
      );
      if (!Number.isNaN(actionDc) && actionDc > 0) return actionDc;
    }

    const searchPaths = [
      ["system", "save", "dc"],
      ["system", "save", "value"],
      ["system", "saveDc"],
      ["system", "dc"],
      ["data", "save", "dc"],
      ["data", "save", "value"],
      ["data", "saveDc"],
      ["data", "dc"],
      ["data", "data", "save", "dc"],
      ["data", "data", "save", "value"],
      ["data", "data", "saveDc"],
      ["data", "data", "dc"],
    ];
    for (const path of searchPaths) {
      const rawValue = getObjectPath(item, path);
      const numeric = Number(rawValue);
      if (!Number.isNaN(numeric) && numeric > 0) return numeric;
    }

    return 0;
  }

  function getSpellLevelValue(item) {
    const searchPaths = [
      ["system", "level"],
      ["system", "lvl"],
      ["data", "level"],
      ["data", "lvl"],
      ["data", "data", "level"],
      ["data", "data", "lvl"],
    ];
    for (const path of searchPaths) {
      const rawValue = getObjectPath(item, path);
      if (rawValue == null || rawValue === "") continue;
      const numeric = Number(rawValue);
      if (!Number.isNaN(numeric)) return numeric;
    }
    return 0;
  }

  function getResolvedSpellAttributes(spell) {
    return {
      school: getSpellSchool(spell) || "None",
      castingTime: getSpellCastingTime(spell) || "None",
      range: getSpellRange(spell) || "None",
      target: getSpellTarget(spell) || "None",
      duration: getSpellDuration(spell) || "None",
      savingThrow: getSpellSavingThrow(spell) || "None",
      saveDc: Math.max(0, getSpellSaveDc(spell)),
      level: Math.max(0, getSpellLevelValue(spell)),
    };
  }

  function getSpellPointCostFromSpellLevel(item) {
    const spellLevel = Math.max(0, getSpellLevelValue(item));
    return spellLevel > 0 ? (spellLevel * 2) - 1 : 0;
  }

  function parseSPCost(description) {
    if (!description) return 0;
    const match = description.match(/SP Cost:\s*(\d+)/i);
    return match ? Number(match[1]) : 0;
  }

  function getSpellPointCost(item) {
    if (!item) return 0;
    const searchKeys = [
      ["system", "spellPointCost"],
      ["system", "spellPoint", "cost"],
      ["system", "spellPoints", "cost"],
      ["system", "spellPoints", "value"],
      ["system", "spCost"],
      ["system", "spellCost"],
      ["data", "system", "spellPointCost"],
      ["data", "system", "spellPoint", "cost"],
      ["data", "system", "spellPoints", "cost"],
      ["data", "system", "spellPoints", "value"],
      ["data", "system", "spCost"],
      ["data", "spellPointCost"],
      ["data", "spellPoint", "cost"],
      ["data", "spellPoints", "cost"],
      ["data", "spellPoints", "value"],
      ["data", "spCost"],
      ["data", "data", "spellPointCost"],
      ["data", "data", "spellPoint", "cost"],
      ["data", "data", "spellPoints", "cost"],
      ["data", "data", "spellPoints", "value"],
      ["data", "data", "spCost"],
    ];
    for (const path of searchKeys) {
      const rawValue = getObjectPath(item, path);
      if (rawValue != null && rawValue !== "") {
        const numeric = Number(rawValue);
        if (!Number.isNaN(numeric)) return numeric;
      }
    }
    const parsedDescriptionCost = parseSPCost(getSpellDescription(item));
    if (parsedDescriptionCost) return parsedDescriptionCost;
    return getSpellPointCostFromSpellLevel(item);
  }

  function toSystemSchoolKey(value) {
    const normalized = String(value || "").trim().toLowerCase();
    const reverseMap = {
      abjuration: "abj",
      conjuration: "con",
      divination: "div",
      enchantment: "enc",
      evocation: "evo",
      illusion: "ill",
      necromancy: "nec",
      transmutation: "trs",
      universal: "uni",
    };
    return reverseMap[normalized] || String(value || "").trim();
  }

  function toSystemSaveType(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || normalized === "none") return "";
    if (normalized.includes("fortitude")) return "fort";
    if (normalized.includes("reflex")) return "ref";
    if (normalized.includes("will")) return "will";
    return "";
  }

  function getActivationDataFromCastingTime(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || normalized === "none" || normalized === "passive") {
      return { cost: null, type: "passive" };
    }
    if (normalized.includes("free")) return { cost: 1, type: "free" };
    if (normalized.includes("swift")) return { cost: 1, type: "swift" };
    if (normalized.includes("immediate")) return { cost: 1, type: "immediate" };
    if (normalized.includes("move")) return { cost: 1, type: "move" };
    if (normalized.includes("full round") || normalized.includes("full-round")) return { cost: 1, type: "full" };
    if (normalized.includes("round")) return { cost: 1, type: "round" };
    if (normalized.includes("standard")) return { cost: 1, type: "standard" };
    if (normalized.includes("minute")) return { cost: 1, type: "minute" };
    if (normalized.includes("hour")) return { cost: 1, type: "hour" };
    if (normalized.includes("day")) return { cost: 1, type: "day" };
    return { cost: null, type: "other" };
  }

  function getDurationDataFromDisplay(durationText) {
    const normalized = String(durationText || "").trim();
    if (!normalized || /^none$/i.test(normalized)) {
      return { value: "None", units: "spec", concentration: false, dismiss: false };
    }
    if (/^instantaneous$/i.test(normalized)) {
      return { value: "", units: "inst", concentration: false, dismiss: false };
    }
    if (/^permanent$/i.test(normalized)) {
      return { value: "", units: "perm", concentration: false, dismiss: false };
    }
    if (/^concentration$/i.test(normalized)) {
      return { value: "", units: "spec", concentration: true, dismiss: false };
    }

    const dismiss = /\(d\)\s*$/i.test(normalized);
    const withoutDismiss = normalized.replace(/\s*\(d\)\s*$/i, "").trim();
    const match = withoutDismiss.match(/^(\d+)\s+(round|rounds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)$/i);
    if (match) {
      const [, value, units] = match;
      return { value, units: units.toLowerCase(), concentration: false, dismiss };
    }

    return { value: withoutDismiss || "None", units: "spec", concentration: false, dismiss };
  }

  function deepCloneData(value) {
    if (value == null) return value;
    if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeArrayLikeValue(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (value instanceof Set) return Array.from(value);
    if (value && typeof value === "object") return Object.values(value).filter((entry) => entry != null);
    if (value == null) return [...fallback];
    return [...fallback];
  }

  function normalizeActionSourceData(action) {
    if (!action || typeof action !== "object") return action;

    const normalized = deepCloneData(action);
    if (!normalized._id && normalized.id) normalized._id = normalized.id;

    setObjectPathValue(normalized, ["conditionals"], normalizeArrayLikeValue(normalized.conditionals));
    setObjectPathValue(normalized, ["damage", "parts"], normalizeArrayLikeValue(getObjectPath(normalized, ["damage", "parts"])));
    setObjectPathValue(normalized, ["damage", "critParts"], normalizeArrayLikeValue(getObjectPath(normalized, ["damage", "critParts"])));
    setObjectPathValue(normalized, ["damage", "nonCritParts"], normalizeArrayLikeValue(getObjectPath(normalized, ["damage", "nonCritParts"])));
    setObjectPathValue(normalized, ["extraAttacks", "manual"], normalizeArrayLikeValue(getObjectPath(normalized, ["extraAttacks", "manual"])));
    setObjectPathValue(normalized, ["notes", "attack"], normalizeArrayLikeValue(getObjectPath(normalized, ["notes", "attack"])));
    setObjectPathValue(normalized, ["notes", "effect"], normalizeArrayLikeValue(getObjectPath(normalized, ["notes", "effect"])));
    setObjectPathValue(normalized, ["notes", "footer"], normalizeArrayLikeValue(getObjectPath(normalized, ["notes", "footer"])));
    setObjectPathValue(normalized, ["specialActions"], normalizeArrayLikeValue(getObjectPath(normalized, ["specialActions"])));
    setObjectPathValue(normalized, ["material", "addon"], normalizeArrayLikeValue(getObjectPath(normalized, ["material", "addon"])));

    return normalized;
  }

  function normalizeGeneratedActionsToArray(itemData) {
    if (!itemData?.system || typeof itemData.system !== "object") return [];

    const actions = getItemActionEntries(itemData);
    if (!actions.length) {
      setObjectPathValue(itemData, ["system", "actions"], []);
      return [];
    }

    const normalizedActions = actions.map((action) => normalizeActionSourceData(action));
    setObjectPathValue(itemData, ["system", "actions"], normalizedActions);
    return normalizedActions;
  }

  function buildGeneratedDrinkAction(actionId) {
    return {
      _id: actionId,
      name: "Drink",
      sort: 0,
      actionType: "spell",
      activation: {
        cost: 1,
        type: "standard",
        unchained: {
          cost: 1,
          type: "standard",
        },
      },
      range: {},
      duration: {},
      target: {},
      save: {},
      uses: {},
      damage: {
        parts: [],
        critParts: [],
        nonCritParts: [],
      },
    };
  }

  function ensurePrimaryDrinkAction(itemData) {
    const existingActions = normalizeGeneratedActionsToArray(itemData);
    if (existingActions.length) return existingActions;

    const actionId = foundry?.utils?.randomID ? foundry.utils.randomID(8) : Math.random().toString(36).slice(2, 10);
    const action = buildGeneratedDrinkAction(actionId);
    setObjectPathValue(itemData, ["system", "actions"], [action]);
    return [action];
  }

  function getConsumableTemplateItem(actor) {
    return actor.items.find((item) => item.type === "consumable" && /potion/i.test(String(item.name || "")))
      || actor.items.find((item) => item.type === "consumable")
      || null;
  }

  function getSpellbookCurrentPointPath(entry) {
    const explicitPaths = [
      ["spellPoints", "value"],
      ["spellPoints", "current"],
      ["spellPoints", "points"],
      ["spellPoint", "value"],
      ["spellPoint", "current"],
      ["points", "value"],
      ["points", "current"],
      ["sp", "value"],
      ["sp", "current"],
      ["powerPoints", "value"],
      ["powerPoints", "current"],
      ["spellPoints"],
      ["spellPoint"],
      ["points"],
      ["sp"],
    ];
    for (const path of explicitPaths) {
      const value = getObjectPath(entry, path);
      const numeric = Number(value);
      if (value != null && value !== "" && !Number.isNaN(numeric)) return path;
    }
    return findNumericLeafPath(entry, {
      include: [/spell.*point/i, /^sp$/i, /^points?$/i, /power.*point/i],
      exclude: [/max/i, /total/i, /base/i, /temp/i, /used/i, /spent/i, /cost/i, /level/i],
    });
  }

  function findNumericLeafPath(object, options, currentPath = []) {
    if (!object || typeof object !== "object") return null;
    for (const [key, value] of Object.entries(object)) {
      const path = [...currentPath, key];
      const keyText = String(key || "");
      if (options.exclude?.some((pattern) => pattern.test(keyText))) continue;
      if (typeof value === "number" || (typeof value === "string" && value !== "" && !Number.isNaN(Number(value)))) {
        if (options.include?.some((pattern) => pattern.test(keyText))) return path;
      }
      if (value && typeof value === "object") {
        const nested = findNumericLeafPath(value, options, path);
        if (nested) return nested;
      }
    }
    return null;
  }

  function getSpellbookCurrentPoints(actor, spellbookId) {
    const resolved = resolveSpellbookAttributeEntry(actor, spellbookId);
    if (!resolved) return null;
    const [entryKey, entry] = resolved;
    const relativePath = getSpellbookCurrentPointPath(entry);
    if (!relativePath) return null;
    const rawValue = getObjectPath(entry, relativePath);
    const current = Number(rawValue);
    if (Number.isNaN(current)) return null;
    return {
      entryKey,
      current,
      actorUpdatePath: ["system", "attributes", "spells", "spellbooks", entryKey, ...relativePath].join("."),
    };
  }

  async function spendSpellbookPoints(actor, spellbookId, amount) {
    const pointInfo = getSpellbookCurrentPoints(actor, spellbookId);
    if (!pointInfo) {
      throw new Error("Could not determine the current SP field for the selected spellbook.");
    }
    if (pointInfo.current < amount) {
      throw new Error(`Not enough SP in this spellbook. Current: ${pointInfo.current}, required: ${amount}.`);
    }
    await actor.update({ [pointInfo.actorUpdatePath]: pointInfo.current - amount });
    return pointInfo.current - amount;
  }

  function buildPotionItemData(actor, state) {
    const spell = getActiveItemById(state, state.selectedSpellId);
    if (!spell) {
      throw new Error("Select a spell before brewing.");
    }

    const spellSource = typeof spell?.toObject === "function"
      ? spell.toObject()
      : deepCloneData(spell);
    const templateItem = getConsumableTemplateItem(actor);
    const templateSource = templateItem
      ? (typeof templateItem.toObject === "function" ? templateItem.toObject() : deepCloneData(templateItem))
      : null;

    const itemData = templateSource
      ? deepCloneData(templateSource)
      : {
          name: "",
          type: "consumable",
          img: "icons/consumables/potions/potion-bottle-corked-blue.webp",
          system: {
            description: { value: "" },
            actions: [],
            uses: { value: 1, max: 1, autoDeductChargesCost: "1" },
            activation: {},
            duration: {},
            range: {},
            save: {},
          },
          flags: {},
        };

    delete itemData._id;
    delete itemData.id;
    delete itemData._stats;
    delete itemData.folder;
    delete itemData.sort;
    delete itemData.pack;
    delete itemData.actions;

    itemData.name = `Draught of ${getDisplaySpellName(spell.name)}`;
    itemData.type = "consumable";
    itemData.img = spellSource?.img || templateSource?.img || itemData.img || "icons/consumables/potions/potion-bottle-corked-blue.webp";
    itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};
    itemData.system = itemData.system && typeof itemData.system === "object" ? itemData.system : {};

    setObjectPathValue(itemData, ["flags", FLAG_SCOPE, "sourceUuid"], String(spell.uuid || ""));
    setObjectPathValue(itemData, ["flags", FLAG_SCOPE, "deleteOnLongRest"], true);
    setObjectPathValue(itemData, ["flags", FLAG_SCOPE, "brewType"], "draught");
    setObjectPathValue(itemData, ["system", "description"], itemData.system.description && typeof itemData.system.description === "object" ? itemData.system.description : {});
    setObjectPathValue(itemData, ["system", "description", "value"], getSpellDescription(spell));
    setObjectPathValue(itemData, ["system", "quantity"], 1);
    setObjectPathValue(itemData, ["system", "uses", "per"], "single");
    setObjectPathValue(itemData, ["system", "uses", "value"], 1);
    setObjectPathValue(itemData, ["system", "uses", "max"], 1);
    setObjectPathValue(itemData, ["system", "uses", "autoDeductChargesCost"], "1");
    setObjectPathValue(itemData, ["system", "consumableType"], "potion");

    if (itemData.flags?.pf1?.spellbook) delete itemData.flags.pf1.spellbook;
    if (itemData.flags?.spellbook) delete itemData.flags.spellbook;
    if (itemData.system?.spellbook != null) delete itemData.system.spellbook;
    if (itemData.system?.spellbookId != null) delete itemData.system.spellbookId;
    if (itemData.system?.spellbookName != null) delete itemData.system.spellbookName;

    const sourceActions = getItemActionEntries(spellSource).map((action) => normalizeActionSourceData(action));
    if (sourceActions.length) {
      setObjectPathValue(itemData, ["system", "actions"], sourceActions.map((action) => deepCloneData(action)));
    } else {
      ensurePrimaryDrinkAction(itemData);
    }

    populatePotionItemAttributes(itemData, spell);

    return { spell, itemData };
  }

  function populatePotionItemAttributes(itemData, spell) {
    const resolvedAttributes = getResolvedSpellAttributes(spell);
    const systemSchoolKey = toSystemSchoolKey(resolvedAttributes.school);
    const saveDescription = String(resolvedAttributes.savingThrow || "").trim();
    const saveType = toSystemSaveType(saveDescription);
    const attackData = getSpellAttackData(actor, state.spellbookId, resolvedAttributes.school);
    const saveDc = attackData.formulaText;
    const castingTime = String(resolvedAttributes.castingTime || "").trim() || "Standard";
    const durationData = getDurationDataFromDisplay(resolvedAttributes.duration);
    const activationData = getActivationDataFromCastingTime(castingTime);

    setObjectPathValue(itemData, ["system", "school"], systemSchoolKey);
    setObjectPathValue(itemData, ["system", "spellSchool"], systemSchoolKey);
    setObjectPathValue(itemData, ["system", "castingTime"], castingTime);
    setObjectPathValue(itemData, ["system", "time"], castingTime);
    setObjectPathValue(itemData, ["system", "target"], resolvedAttributes.target);
    setObjectPathValue(itemData, ["system", "targets"], resolvedAttributes.target);
    setObjectPathValue(itemData, ["system", "savingThrow"], saveDescription);
    setObjectPathValue(itemData, ["system", "save", "description"], saveDescription);
    setObjectPathValue(itemData, ["system", "save", "type"], saveType);
    setObjectPathValue(itemData, ["system", "save", "dc"], saveDc);
    setObjectPathValue(itemData, ["system", "activation", "cost"], activationData.cost);
    setObjectPathValue(itemData, ["system", "activation", "type"], activationData.type);
    setObjectPathValue(itemData, ["system", "duration", "value"], durationData.value);
    setObjectPathValue(itemData, ["system", "duration", "units"], durationData.units);
    setObjectPathValue(itemData, ["system", "duration", "concentration"], durationData.concentration);
    setObjectPathValue(itemData, ["system", "duration", "dismiss"], durationData.dismiss);
    setObjectPathValue(itemData, ["system", "level"], resolvedAttributes.level);

    if (itemData.system?.range && typeof itemData.system.range === "object") {
      setObjectPathValue(itemData, ["system", "range", "value"], resolvedAttributes.range);
      setObjectPathValue(itemData, ["system", "range", "units"], getObjectPath(spell, ["system", "range", "units"]) || "");
    } else {
      setObjectPathValue(itemData, ["system", "range"], resolvedAttributes.range);
    }

    const actions = ensurePrimaryDrinkAction(itemData);
    for (const action of actions) {
      setObjectPathValue(action, ["name"], "Drink");
      setObjectPathValue(action, ["activation", "cost"], activationData.cost);
      setObjectPathValue(action, ["activation", "type"], activationData.type);
      setObjectPathValue(action, ["activation", "unchained", "cost"], activationData.cost);
      setObjectPathValue(action, ["activation", "unchained", "type"], activationData.type);
      setObjectPathValue(action, ["save", "description"], saveDescription);
      setObjectPathValue(action, ["save", "type"], saveType);
      setObjectPathValue(action, ["save", "dc"], saveDc);
      setObjectPathValue(action, ["duration", "value"], durationData.value);
      setObjectPathValue(action, ["duration", "units"], durationData.units);
      setObjectPathValue(action, ["duration", "concentration"], durationData.concentration);
      setObjectPathValue(action, ["duration", "dismiss"], durationData.dismiss);
      if (getObjectPath(action, ["target", "value"]) == null || getObjectPath(action, ["target", "value"]) === "") {
        setObjectPathValue(action, ["target", "value"], resolvedAttributes.target);
      }
      if (getObjectPath(action, ["range", "value"]) == null || getObjectPath(action, ["range", "value"]) === "") {
        setObjectPathValue(action, ["range", "value"], resolvedAttributes.range);
      }
    }
  }

  async function addPotionToInventory(actor, state) {
    const spell = getActiveItemById(state, state.selectedSpellId);
    if (!spell) {
      throw new Error("Select a spell before brewing.");
    }
    await spendSpellbookPoints(actor, state.spellbookId, getSpellPointCost(spell));
    const { itemData } = buildPotionItemData(actor, state);
    const [createdItem] = await actor.createEmbeddedDocuments("Item", [itemData]);
    return createdItem;
  }

  function buildDialogContent(spellbooks, state) {
    const spellbookOptions = spellbooks.map((book) => getSpellbookOptionHtml(book, state.spellbookId)).join("");
    const spellListItems = "<div class=\"brewing-empty\">Select a spellbook to see spells.</div>";

    return `
      <style>
        .brewing-root { width: 100%; display: flex; flex-direction: column; gap: 0.8rem; flex: 1 1 auto; overflow: hidden; min-height: 100%; height: 100%; box-sizing: border-box; background: #58544d; padding: 0.75rem; border-radius: 10px; }
        .brewing-panel { border: 1px solid #7d7668; background: rgba(201, 196, 184, 0.94); padding: 1rem 1.1rem; border-radius: 8px; overflow: hidden; color: #151412; width: 100%; box-sizing: border-box; min-width: 0; min-height: 0; box-shadow: 0 1px 0 rgba(255, 255, 255, 0.18) inset; flex: 0 0 auto; }
        .brewing-top-panel { padding: 0.9rem 1.1rem; flex: 0 0 auto; }
        .brewing-panel h3 { margin: 0 0 0.8rem; padding-bottom: 0.35rem; border-bottom: 1px solid #b85b4d; font-size: 1.05rem; font-weight: 700; color: #2c2a25; }
        .brewing-field label { font-weight: 700; display: block; margin-bottom: 0.45rem; font-size: 0.95rem; color: #26231d; }
        .brewing-field select { width: 100%; min-height: 2.35rem; line-height: 1.4; color: #161616; background: #e4dfd3; border: 1px solid #8f8673; border-radius: 4px; padding: 0.4rem 0.55rem; font-size: 0.96rem; box-shadow: 0 1px 0 rgba(255, 255, 255, 0.28) inset; }
        .brewing-scrollable-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; height: 100%; }
        .brewing-spell-list { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 0.5rem; min-height: 0; padding-right: 0.2rem; }
        .brewing-spell-item { display: grid; grid-template-columns: auto minmax(0, 1fr) max-content; align-items: center; gap: 0.65rem; background: rgba(236, 233, 225, 0.82); padding: 0.45rem 0.65rem; border-radius: 4px; color: #111; border: 1px solid #9f9787; font-size: 0.96rem; transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; cursor: pointer; }
        .brewing-spell-item:hover { background: rgba(244, 240, 232, 0.9); border-color: #887d63; }
        .brewing-spell-item.selected { background: rgba(173, 220, 182, 0.98); border-color: #1f7a3d; box-shadow: inset 0 0 0 1px rgba(21, 100, 46, 0.34), 0 0 0 1px rgba(31, 122, 61, 0.28), 0 2px 6px rgba(24, 92, 44, 0.18); }
        .brewing-spell-item input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; margin: 0; }
        .brewing-spell-icon { width: 2rem; height: 2rem; object-fit: cover; border-radius: 4px; border: 1px solid rgba(89, 82, 66, 0.35); background: rgba(255, 255, 255, 0.75); box-shadow: 0 1px 2px rgba(0,0,0,0.12); }
        .brewing-spell-name { min-width: 0; overflow-wrap: anywhere; word-break: break-word; font-weight: 700; }
        .brewing-spell-meta { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 0.12rem; text-align: right; min-width: max-content; }
        .brewing-spell-school { width: auto; text-align: right; justify-self: end; color: #5a554a; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; }
        .brewing-spell-cost { color: #6b4225; font-size: 0.8rem; font-weight: 700; white-space: nowrap; }
        .brewing-empty { color: #555; font-style: italic; font-size: 0.92rem; }
        .brewing-actions { display: inline-grid; grid-template-columns: repeat(2, minmax(120px, 150px)); gap: 1.1rem; justify-content: center; width: auto; }
        .brewing-actions button { width: 100%; min-width: 0; padding: 0.5rem 0.75rem; font-size: 0.92rem; font-weight: 600; white-space: nowrap; border: 1px solid #9e916d; border-radius: 4px; background: linear-gradient(to bottom, #ddd4b8, #c9bea0); color: #1c1914; }
        .brewing-actions button:hover { background: linear-gradient(to bottom, #e4dbc0, #d0c4a6); }
        .brewing-actions button:disabled { background: linear-gradient(to bottom, #b9b19d, #9d9583); border-color: #857d6d; color: #5d564c; cursor: default; opacity: 0.85; }
        .brewing-actions-panel { display: flex; justify-content: center; padding-top: 0.8rem; padding-bottom: 0.8rem; flex: 0 0 auto; }
        .ui-dialog-buttonpane { display: none !important; }
      </style>
      <div id="brewing-root" class="brewing-root">
        <div class="brewing-panel brewing-top-panel">
          <div class="brewing-field">
            <label for="selectedSpellbook">Spellbook</label>
            <select id="selectedSpellbook">${spellbookOptions}</select>
          </div>
        </div>
        <div class="brewing-panel brewing-scrollable-panel">
          <h3>Spells</h3>
          <div class="brewing-spell-list">${spellListItems}</div>
        </div>
        <div class="brewing-panel brewing-actions-panel">
          <div class="brewing-actions">
            <button type="button" class="brewing-brew" disabled>Brew</button>
            <button type="button" class="brewing-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  function getSpellbookOptionHtml(book, selectedId) {
    const selected = book.id === selectedId ? "selected" : "";
    return `<option value="${book.id}" ${selected}>${escapeHtml(book.name)}</option>`;
  }

  function bindDialogEvents(html, spellbooks, state, actor) {
    const dialogRoot = html.closest(".dialog");
    const eventRoot = dialogRoot.length ? dialogRoot : html;

    eventRoot.off("change", "#selectedSpellbook").on("change", "#selectedSpellbook", async (event) => {
      state.spellbookId = String(event.target.value || "");
      state.selectedSpellId = null;
      saveLastSelection();
      await updateDialog(html, state, actor);
    });

    eventRoot.off("change", "input[name=selectedSpell]").on("change", "input[name=selectedSpell]", async (event) => {
      state.selectedSpellId = String(event.target.value || "");
      renderSpellList(html, state);
      renderButtons(html, state);
    });

    eventRoot.off("click", ".brewing-cancel").on("click", ".brewing-cancel", (event) => {
      event.preventDefault();
      dialog.close();
    });

    eventRoot.off("click", ".brewing-brew").on("click", ".brewing-brew", async (event) => {
      event.preventDefault();
      if (event.currentTarget.disabled) return;

      try {
        saveLastSelection();
        const createdItem = await addPotionToInventory(actor, state);
        if (createdItem) {
          ui.notifications.info(`You brewed ${createdItem.name}.`);
          dialog.close();
        }
      } catch (err) {
        console.warn("Brewing macro could not create the potion.", err);
        ui.notifications.error(err?.message || "The potion could not be brewed.");
      }
    });
  }

  async function updateDialog(html, state, actor) {
    if (state.spellbookId) {
      state.availableSpells = sortItemsByDisplayName(getSpellbookSpells(actor, state.spellbookId));
      state.itemLookup = indexItemsBySourceKey(state.availableSpells);
    } else {
      state.availableSpells = [];
      state.itemLookup = {};
    }

    if (!getActiveItemById(state, state.selectedSpellId)) {
      state.selectedSpellId = null;
    }

    html.find("#selectedSpellbook").val(state.spellbookId);
    renderSpellList(html, state);
    renderButtons(html, state);
  }

  function renderSpellList(html, state) {
    const spellContainer = html.find(".brewing-spell-list");
    const spells = state.availableSpells || [];

    if (!state.spellbookId) {
      spellContainer.html("<div class=\"brewing-empty\">Select a spellbook to see spells.</div>");
      return;
    }

    if (!spells.length) {
      spellContainer.html("<div class=\"brewing-empty\">No spells were found in the selected spellbook.</div>");
      return;
    }

    spellContainer.html(spells.map((spell) => {
      const spellKey = getItemSourceKey(spell);
      const checked = spellKey === state.selectedSpellId ? "checked" : "";
      const selectedClass = checked ? " selected" : "";
      const schoolText = escapeHtml(getSpellSchool(spell));
      const spellPointCost = getSpellPointCost(spell);
      const iconSrc = escapeHtml(spell?.img || "icons/svg/mystery-man.svg");
      return `<label class="brewing-spell-item${selectedClass}"><input type="radio" name="selectedSpell" value="${spellKey}" ${checked} /><img class="brewing-spell-icon" src="${iconSrc}" alt="" loading="lazy" /><span class="brewing-spell-name">${escapeHtml(getDisplaySpellName(spell.name))}</span><span class="brewing-spell-meta"><span class="brewing-spell-school">${schoolText}</span><span class="brewing-spell-cost">${spellPointCost} SP</span></span></label>`;
    }).join(""));
  }

  function renderButtons(html, state) {
    html.find(".brewing-brew").prop("disabled", !state.selectedSpellId);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getObjectPath(object, path) {
    return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), object);
  }

  function setObjectPathValue(object, path, value) {
    if (!object || !Array.isArray(path) || !path.length) return;
    let current = object;
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index];
      if (!current[key] || typeof current[key] !== "object") current[key] = {};
      current = current[key];
    }
    current[path[path.length - 1]] = value;
  }
})();
