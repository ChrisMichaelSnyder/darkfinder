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
    preparationMode: null,
    selectedSpellId: null,
    coreFilterText: "",
    selectedCoreId: null,
    selectedCoreAugments: {},
    selectedSpellAugments: {},
    availableCores: [],
    availableSpellAugments: [],
    availableSpells: [],
    itemLookup: {},
    spellDataCacheKey: null,
    displayNameCache: {},
    displayNameSearchCache: {},
    coreHoverDescriptionCache: {},
    warnedHybridSpellbookId: null,
  };
  const FILTER_INPUT_DEBOUNCE_MS = 75;
  let coreFilterDebounceHandle = null;
  let preparedSpellDataCache = null;

  installLongRestCleanupHook();
  registerSpellAttackChatCardHook();

  const dialog = new Dialog({
    title: "Potion Brewing",
    content: buildDialogContent(spellbooks, state),
    buttons: {},
    width: 1800,
    height: 860,
    resizable: true,
    render: async function(html) {
      const dialogWindow = applyDialogChrome(html, false);
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

  function applyDialogChrome(html, isSpontaneous) {
    const width = isSpontaneous ? 1800 : 465;
    const height = isSpontaneous ? 860 : 820;
    dialog.setPosition({ width, height });
    const appWindow = html.closest(".app.window-app");
    const dialogWindow = html.closest(".app.window-app, .dialog");
    let dialogContent = dialogWindow.find(".window-content");
    if (!dialogContent.length) dialogContent = html;

    if (appWindow.length) {
      appWindow.css({
        width: `${width}px`,
        minWidth: `${width}px`,
        maxWidth: `${width}px`,
        height: `${height}px`,
        minHeight: `${height}px`,
        maxHeight: `${height}px`,
      });
    }
    dialogWindow.css({
      width: `${width}px`,
      minWidth: `${width}px`,
      maxWidth: `${width}px`,
      height: `${height}px`,
      minHeight: `${height}px`,
      maxHeight: `${height}px`,
    });
    dialogContent.css({
      width: "100%",
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
    return dialogWindow;
  }

  function installLongRestCleanupHook() {
    if (globalThis.pf1BrewingLongRestHookId != null) return;
    globalThis.pf1BrewingLongRestHookId = Hooks.on("pf1ActorRest", async (restActor, restOptions) => {
      try {
        if (!shouldDeleteDraftsOnRest(restOptions)) return;
        await deleteBrewedDrafts(restActor);
      } catch (err) {
        console.warn("Brewing macro could not clean up drafts after rest.", err);
      }
    });
  }

  function shouldDeleteDraftsOnRest(restOptions) {
    if (!restOptions || typeof restOptions !== "object") return false;
    if (restOptions.restoreDailyUses === true) return true;
    const hours = Number(restOptions.hours ?? 0);
    return !Number.isNaN(hours) && hours >= 8;
  }

  function isBrewedDraft(item) {
    return getObjectPath(item, ["flags", FLAG_SCOPE, "deleteOnLongRest"]) === true;
  }

  async function deleteBrewedDrafts(actor) {
    if (!actor?.items?.size && !Array.isArray(actor?.items)) return;
    const draftIds = actor.items
      .filter((item) => isBrewedDraft(item))
      .map((item) => item.id)
      .filter(Boolean);
    if (!draftIds.length) return;
    await actor.deleteEmbeddedDocuments("Item", draftIds);
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

  function getDescriptionSavingThrowValue(core, savingThrowOverride = "") {
    const explicitSavingThrow = String(savingThrowOverride || "").trim();
    if (explicitSavingThrow) return explicitSavingThrow;

    const parsedAttributes = parseSpellDescriptionAttributes(core);
    return String(parsedAttributes.savingThrow || getSpellSavingThrow(core) || "").trim();
  }

  function shouldShowSpellAttackButton(core, savingThrowOverride = "") {
    const savingThrow = getDescriptionSavingThrowValue(core, savingThrowOverride);
    return !!savingThrow && savingThrow.toLowerCase() !== "none";
  }

  function buildSpellAttackButtonHtml(actor, spellbookId, core, spellName, savingThrowOverride = "") {
    const savingThrow = getDescriptionSavingThrowValue(core, savingThrowOverride);
    if (!shouldShowSpellAttackButton(core, savingThrow)) return "";
    return `
      <div class="spellcrafting-spell-attack-row" style="margin:0.05rem 0 0.95rem;">
        <span
          class="spellcrafting-spell-attack-button"
          data-actor-uuid="${escapeHtml(actor.uuid || "")}"
          data-spellbook-id="${escapeHtml(String(spellbookId || ""))}"
          data-spell-school="${escapeHtml(getSpellSchool(core) || "")}"
          data-saving-throw="${escapeHtml(savingThrow)}"
          data-spell-name="${escapeHtml(spellName || getDisplaySpellName(core?.name || ""))}"
          role="button"
          tabindex="0"
          style="display:inline-flex;align-items:center;justify-content:center;padding:0.56rem 1rem;border:1px solid #8f8674;border-radius:5px;background:linear-gradient(to bottom, #ddd4b8, #c9bea0);color:#1c1914;font-weight:700;font-size:1.15rem;line-height:1;cursor:pointer;text-decoration:none;"
        >Spell Attack</span>
      </div>
    `;
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

    itemData.name = `Draft of ${getDisplaySpellName(spell.name)}`;
    itemData.type = "consumable";
    itemData.img = spellSource?.img || templateSource?.img || itemData.img || "icons/consumables/potions/potion-bottle-corked-blue.webp";
    itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};
    itemData.system = itemData.system && typeof itemData.system === "object" ? itemData.system : {};

    setObjectPathValue(itemData, ["flags", FLAG_SCOPE, "sourceUuid"], String(spell.uuid || ""));
    setObjectPathValue(itemData, ["flags", FLAG_SCOPE, "deleteOnLongRest"], true);
    setObjectPathValue(itemData, ["flags", FLAG_SCOPE, "brewType"], "draft");
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

  async function addSpontaneousPotionToInventory(actor, state) {
    const core = getActiveItemById(state, state.selectedCoreId);
    if (!core) {
      throw new Error("Select a Core before brewing.");
    }
    const customName = await promptForSpontaneousDraftName(state);
    if (customName == null) return null;
    const totalSP = calculateTotalSP(actor, state);
    await spendSpellbookPoints(actor, state.spellbookId, totalSP);
    const { itemData } = buildSpontaneousPotionItemData(actor, state, { customName });
    const [createdItem] = await actor.createEmbeddedDocuments("Item", [itemData]);
    return createdItem;
  }

  function normalizePreparationType(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes("hybrid")) return "hybrid";
    if (normalized.includes("spont")) return "spontaneous";
    if (normalized.includes("prep")) return "prepared";
    return null;
  }

  function detectPreparationTypeFromEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const explicitSearchPaths = [
      ["preparationMode"],
      ["spellPreparationMode"],
      ["preparation", "mode"],
      ["spellPreparation", "mode"],
      ["casting", "type"],
      ["castingType"],
      ["spellcastingType"],
      ["spellbook", "preparationMode"],
      ["spellbook", "spellPreparationMode"],
      ["book", "preparationMode"],
      ["book", "spellPreparationMode"],
    ];
    for (const path of explicitSearchPaths) {
      const match = normalizePreparationType(getObjectPath(entry, path));
      if (match) return match;
    }

    const explicitFlags = [
      ["isPrepared", "prepared"],
      ["prepared", "prepared"],
      ["isSpontaneous", "spontaneous"],
      ["spontaneous", "spontaneous"],
      ["isHybrid", "hybrid"],
      ["hybrid", "hybrid"],
    ];
    for (const [key, mode] of explicitFlags) {
      if (entry[key] === true) return mode;
    }

    const queue = [entry];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      for (const [key, value] of Object.entries(current)) {
        const keyText = String(key || "").toLowerCase();
        if (typeof value === "string") {
          if (/(prep|spont|hybrid|casting)/i.test(keyText)) {
            const match = normalizePreparationType(value);
            if (match) return match;
          }
        } else if (typeof value === "boolean") {
          if (value && /prepared/.test(keyText)) return "prepared";
          if (value && /spontaneous/.test(keyText)) return "spontaneous";
          if (value && /hybrid/.test(keyText)) return "hybrid";
        } else if (value && typeof value === "object") {
          queue.push(value);
        }
      }
    }
    return null;
  }

  function getSpellbookPreparationType(actor, spellbookId) {
    const entry = resolveSpellbookAttributeEntry(actor, spellbookId)?.[1];
    return detectPreparationTypeFromEntry(entry);
  }

  function getCompendiumFolderName(pack) {
    return pack?.folder?.name || pack?.metadata?.folder || pack?.folderName || "";
  }

  function getDocumentFolderName(document) {
    return document?.folder?.name || document?._source?.folder?.name || "";
  }

  function findCompendiumPack(label, folderName) {
    const normalizedLabel = String(label || "").trim().toLowerCase();
    const normalizedFolder = String(folderName || "").trim().toLowerCase();
    return Array.from(game.packs ?? []).find((pack) => {
      const packLabel = String(pack.metadata?.label || pack.title || pack.collection || "").trim().toLowerCase();
      const packFolder = String(getCompendiumFolderName(pack) || "").trim().toLowerCase();
      return packLabel.includes(normalizedLabel) && (!normalizedFolder || packFolder === normalizedFolder);
    }) || null;
  }

  async function loadPreparedSpellData() {
    if (preparedSpellDataCache) return preparedSpellDataCache;
    const spellPack = findCompendiumPack("Spell Cores/Augments", "Darkfinder");
    if (!spellPack) {
      throw new Error("Could not find the Darkfinder compendium 'Spell Cores/Augments'.");
    }
    const documents = await spellPack.getDocuments();
    const cores = [];
    const augments = [];
    for (const item of documents) {
      const folderName = String(getDocumentFolderName(item) || "").trim().toLowerCase();
      if (folderName === "augments" || isAugmentSpell(item)) {
        augments.push(item);
      } else {
        cores.push(item);
      }
    }
    preparedSpellDataCache = {
      cores: sortItemsByDisplayName(cores),
      augments: sortItemsByDisplayName(augments),
      coreIndex: new Map(sortItemsByDisplayName(cores).map((item) => [normalizeSpellReferenceName(item.name), item])),
      augmentIndex: new Map(sortItemsByDisplayName(augments).map((item) => [normalizeSpellReferenceName(item.name), item])),
    };
    return preparedSpellDataCache;
  }

  function normalizeSpellReferenceName(name) {
    return getDisplaySpellName(name).trim().toLowerCase();
  }

  function mapSpontaneousItemsToBestSource(items, compendiumIndex) {
    return sortItemsByDisplayName((items || []).map((item) => compendiumIndex?.get(normalizeSpellReferenceName(item?.name || "")) || item));
  }

  function getSpellType(item) {
    const name = String(item?.name || "");
    if (/\(augment\)\s*$/i.test(name) || /\baugment\b/i.test(name)) return "augment";
    const descriptionType = parseDescriptionType(getSpellDescription(item));
    return descriptionType === "augment" ? "augment" : "core";
  }

  function isAugmentSpell(item) {
    return getSpellType(item) === "augment";
  }

  function isCoreSpell(item) {
    return !!item && !isAugmentSpell(item);
  }

  function parseDescriptionType(description) {
    if (!description) return null;
    const plaintext = stripHtmlTags(description);
    return plaintext.match(/Type:\s*([^\n\r]+)/i)?.[1]?.trim()?.toLowerCase?.() || null;
  }

  function clearSelectedSpellData(state) {
    state.selectedCoreId = null;
    state.selectedCoreAugments = {};
    state.selectedSpellAugments = {};
  }

  function resetDerivedDisplayCaches(state) {
    state.displayNameCache = {};
    state.displayNameSearchCache = {};
    state.coreHoverDescriptionCache = {};
  }

  function setLoadedSpellData(state, cacheKey, cores, augments) {
    state.availableCores = cores;
    state.availableSpellAugments = augments;
    state.itemLookup = indexItemsBySourceKey([...cores, ...augments]);
    state.spellDataCacheKey = cacheKey;
    resetDerivedDisplayCaches(state);
  }

  function clearLoadedSpellData(state, cacheKey = null) {
    state.availableCores = [];
    state.availableSpellAugments = [];
    state.itemLookup = {};
    state.spellDataCacheKey = cacheKey;
    resetDerivedDisplayCaches(state);
  }

  function getCachedDisplaySpellName(state, item) {
    const itemKey = getItemSourceKey(item);
    if (!itemKey) return getDisplaySpellName(item?.name || "");
    if (state.displayNameCache[itemKey] == null) {
      state.displayNameCache[itemKey] = getDisplaySpellName(item?.name || "");
    }
    return state.displayNameCache[itemKey];
  }

  function getCachedDisplaySpellNameSearch(state, item) {
    const itemKey = getItemSourceKey(item);
    if (!itemKey) return getDisplaySpellName(item?.name || "").toLowerCase();
    if (state.displayNameSearchCache[itemKey] == null) {
      state.displayNameSearchCache[itemKey] = getCachedDisplaySpellName(state, item).toLowerCase();
    }
    return state.displayNameSearchCache[itemKey];
  }

  function normalizeDisplayedSpellText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function stripHtmlTags(html) {
    if (!html) return "";
    return String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|th|td|h[1-6])>/gi, "\n")
      .replace(/<(p|div|li|tr|th|td|h[1-6])[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
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

  function descriptionHasStructuredSpellAttributes(description) {
    const text = stripHtmlTags(description);
    const attributePatterns = [
      /^Type:\s*/im,
      /^SP Cost:\s*/im,
      /^School:\s*/im,
      /^Casting Time:\s*/im,
      /^Range:\s*/im,
      /^Target:\s*/im,
      /^Duration:\s*/im,
      /^Saving Throw:\s*/im,
      /^Description:\s*/im,
    ];
    return attributePatterns.filter((pattern) => pattern.test(text)).length >= 4;
  }

  function getCoreDescriptionWithoutAugments(core) {
    const plaintext = stripHtmlTags(getSpellDescription(core));
    return normalizeDisplayedSpellText(plaintext.replace(/\n?\s*Core Augments?:[\s\S]*$/i, "").trim());
  }

  function parseSpellDescriptionAttributes(core) {
    const text = getCoreDescriptionWithoutAugments(core);
    if (!text) return {};
    const descriptionIndex = text.search(/(?:^|\n)\s*Description:\s*/i);
    const attributeText = descriptionIndex >= 0 ? text.slice(0, descriptionIndex).trim() : text;
    const attributes = {};
    const patterns = {
      name: /(?:^|\n)\s*Name:\s*([^\n\r]+)/i,
      school: /(?:^|\n)\s*School:\s*([^\n\r]+)/i,
      castingTime: /(?:^|\n)\s*Casting Time:\s*([^\n\r]+)/i,
      range: /(?:^|\n)\s*Range:\s*([^\n\r]+)/i,
      target: /(?:^|\n)\s*Target:\s*([^\n\r]+)/i,
      duration: /(?:^|\n)\s*Duration:\s*([^\n\r]+)/i,
      savingThrow: /(?:^|\n)\s*Saving Throw:\s*([^\n\r]+)/i,
    };
    for (const [key, pattern] of Object.entries(patterns)) {
      const value = attributeText.match(pattern)?.[1]?.trim();
      if (value) attributes[key] = normalizeDisplayedSpellText(value);
    }
    return attributes;
  }

  function parseAugmentLines(description, headingRegex) {
    if (!description) return [];
    const plaintext = stripHtmlTags(description);
    const sectionStart = plaintext.search(headingRegex);
    const sectionText = sectionStart === -1 ? plaintext : plaintext.slice(sectionStart);
    const augmentRegex = /([^\n\r]*?)\(\s*([+-]?\d+)(\*)?\s*\)\s*([^\n\r]+)/g;
    const entries = [];
    let match;
    while ((match = augmentRegex.exec(sectionText)) !== null) {
      const prefix = match[1].trim();
      const cost = Number(match[2]);
      const repeatable = !!match[3];
      let descriptionText = match[4].trim();
      if (descriptionText.startsWith(":")) descriptionText = descriptionText.slice(1).trim();
      const normalizedTitle = prefix ? prefix.replace(/[:\s]*$/, "") : null;
      const costLabel = `${cost >= 0 ? "+" : ""}${cost}${repeatable ? "*" : ""}`;
      const title = normalizedTitle ? `${normalizedTitle} (${costLabel})` : costLabel;
      entries.push({ cost, repeatable, title, description: descriptionText, raw: match[0].trim() });
    }
    return entries;
  }

  function getSpellAugmentLimitation(description) {
    const plaintext = stripHtmlTags(description || "");
    return plaintext.match(/(?:^|\n)\s*Limitation:\s*([^\n\r]+)/i)?.[1]?.trim() || "";
  }

  function getCoreHoverSpellPointCost(core) {
    return getSpellPointCost(core);
  }

  function buildCoreHoverDescription(core) {
    const rawDescription = normalizeDisplayedSpellText(stripHtmlTags(getSpellDescription(core)));
    if (descriptionHasStructuredSpellAttributes(rawDescription)) return rawDescription;
    return normalizeDisplayedSpellText([
      getDisplaySpellName(core?.name || "") || "Unnamed Core",
      "Type: Core",
      `SP Cost: ${getCoreHoverSpellPointCost(core)}`,
      `School: ${getSpellSchool(core) || "None"}`,
      `Casting Time: ${getSpellCastingTime(core) || "None"}`,
      `Range: ${getSpellRange(core) || "None"}`,
      `Target: ${getSpellTarget(core) || "None"}`,
      `Duration: ${getSpellDuration(core) || "None"}`,
      `Saving Throw: ${getSpellSavingThrow(core) || "None"}`,
      "Description:",
      rawDescription || "None",
    ].join("\n"));
  }

  function getCachedCoreHoverDescription(state, core) {
    const itemKey = getItemSourceKey(core);
    if (!itemKey) return buildCoreHoverDescription(core);
    if (state.coreHoverDescriptionCache[itemKey] == null) {
      state.coreHoverDescriptionCache[itemKey] = buildCoreHoverDescription(core);
    }
    return state.coreHoverDescriptionCache[itemKey];
  }

  function filterCoresByName(cores, filterText, state) {
    const normalizedFilter = String(filterText || "").trim().toLowerCase();
    if (!normalizedFilter) return cores;
    return (cores || []).filter((core) => getCachedDisplaySpellNameSearch(state, core).includes(normalizedFilter));
  }

  async function ensureSpontaneousSpellDataLoaded(actor, state) {
    state.preparationMode = getSpellbookPreparationType(actor, state.spellbookId) || "spontaneous";
    const cacheKey = JSON.stringify({
      spellbookId: String(state.spellbookId || ""),
      preparationMode: state.preparationMode,
    });
    if (!state.spellbookId) {
      clearLoadedSpellData(state);
      return;
    }
    if (state.preparationMode === "hybrid") {
      if (state.warnedHybridSpellbookId !== state.spellbookId) {
        ui.notifications.error("This Hybrid caster needs to choose Prepared or Spontaneous on the spellbook before using Brewing.");
        state.warnedHybridSpellbookId = state.spellbookId;
      }
      clearLoadedSpellData(state, cacheKey);
      return;
    }
    state.warnedHybridSpellbookId = null;
    if (state.preparationMode !== "spontaneous") {
      clearLoadedSpellData(state, cacheKey);
      return;
    }
    if (state.spellDataCacheKey === cacheKey && Object.keys(state.itemLookup || {}).length) return;
    try {
      const preparedData = await loadPreparedSpellData();
      const actorCores = getSpellbookSpells(actor, state.spellbookId).filter((item) => isCoreSpell(item));
      const actorAugments = getSpellbookSpells(actor, state.spellbookId).filter((item) => isAugmentSpell(item));
      setLoadedSpellData(
        state,
        cacheKey,
        mapSpontaneousItemsToBestSource(actorCores, preparedData.coreIndex),
        mapSpontaneousItemsToBestSource(actorAugments, preparedData.augmentIndex),
      );
    } catch (err) {
      console.warn("Brewing macro could not map spontaneous spell items to compendium data.", err);
      setLoadedSpellData(
        state,
        cacheKey,
        sortItemsByDisplayName(getSpellbookSpells(actor, state.spellbookId).filter((item) => isCoreSpell(item))),
        sortItemsByDisplayName(getSpellbookSpells(actor, state.spellbookId).filter((item) => isAugmentSpell(item))),
      );
    }
  }

  function getSelectedCoreBaseSP(actor, state) {
    const core = getActiveItemById(state, state.selectedCoreId);
    return core ? getSpellPointCost(core) : 0;
  }

  function normalizeSpellAttributeDuration(durationText, totalSP) {
    const rawDuration = normalizeDisplayedSpellText(String(durationText || "").trim());
    if (!rawDuration) return rawDuration;
    if (/^(?:@cl|SP spent)\s+rounds?$/i.test(rawDuration)) return `${totalSP} rounds`;
    if (/^(?!1\b)(?:\d+|SP spent)\s+round$/i.test(rawDuration)) return rawDuration.replace(/\bround$/i, "rounds");
    if (/\bminutes?\b/i.test(rawDuration) || /\bhours?\b/i.test(rawDuration)) return "Concentration";
    if (/\bdays?\b/i.test(rawDuration)) return "24 hours";
    return rawDuration;
  }

  function getResolvedBuiltSpellAttributes(core, totalSP) {
    const parsedAttributes = parseSpellDescriptionAttributes(core);
    const rawDuration = parsedAttributes.duration || getSpellDuration(core) || "None";
    return {
      name: parsedAttributes.name || getDisplaySpellName(core.name) || "None",
      spCost: String(totalSP),
      school: parsedAttributes.school || getSpellSchool(core) || "None",
      castingTime: parsedAttributes.castingTime || getSpellCastingTime(core) || "None",
      range: parsedAttributes.range || getSpellRange(core) || "None",
      target: parsedAttributes.target || getSpellTarget(core) || "None",
      duration: normalizeSpellAttributeDuration(rawDuration, totalSP) || "None",
      savingThrow: parsedAttributes.savingThrow || getSpellSavingThrow(core) || "None",
      level: Math.max(0, Math.ceil(totalSP / 2)),
    };
  }

  function buildPreparedAttributeText(core, totalSP) {
    const resolvedAttributes = getResolvedBuiltSpellAttributes(core, totalSP);
    const lines = [
      `<strong>SP Cost:</strong> ${escapeHtml(resolvedAttributes.spCost)}`,
      `<strong>School:</strong> ${escapeHtml(resolvedAttributes.school)}`,
      `<strong>Casting Time:</strong> ${escapeHtml(resolvedAttributes.castingTime)}`,
      `<strong>Range:</strong> ${escapeHtml(resolvedAttributes.range)}`,
      `<strong>Target:</strong> ${escapeHtml(resolvedAttributes.target)}`,
      `<strong>Duration:</strong> ${escapeHtml(resolvedAttributes.duration)}`,
      `<strong>Saving Throw:</strong> ${escapeHtml(resolvedAttributes.savingThrow)}`,
    ];
    return lines.join("\n");
  }

  function calculateTotalSP(actor, state) {
    let total = getSelectedCoreBaseSP(actor, state);
    for (const entry of [...getSelectedAugmentDetails(actor, state, "core"), ...getSelectedAugmentDetails(actor, state, "spell")]) {
      total += entry.augment.cost * entry.count;
    }
    return total;
  }

  function getSelectedAugmentDetails(actor, state, type) {
    const collection = type === "core" ? state.selectedCoreAugments : state.selectedSpellAugments;
    const entries = [];
    for (const key of Object.keys(collection)) {
      const prefix = key.slice(0, key.indexOf("-"));
      if (type === "core" && prefix !== "core") continue;
      if (type === "spell" && prefix !== "spell") continue;
      const lastDash = key.lastIndexOf("-");
      const itemId = key.slice(prefix.length + 1, lastDash);
      const entryIndex = Number(key.slice(lastDash + 1));
      const item = getActiveItemById(state, itemId);
      if (!item) continue;
      const parsed = parseAugmentLines(getSpellDescription(item), type === "core" ? /Core Augments?:/i : /Augment|Description:/i);
      const augment = parsed[entryIndex];
      if (!augment) continue;
      entries.push({ item, augment, count: Math.max(1, collection[key].count || 1), type, key });
    }
    return entries;
  }

  function getSignedCostLabel(cost) {
    return `${cost >= 0 ? "+" : ""}${cost}`;
  }

  function formatAppliedAugmentLabel(detail) {
    const rawTitle = normalizeDisplayedSpellText(String(detail.augment.title || "").trim());
    const baseTitle = rawTitle.replace(/\s*\([^)]+\)\s*$/, "").trim();
    const costLabel = `(${getSignedCostLabel(detail.augment.cost)})`;
    const repeatLabel = detail.augment.repeatable && detail.count > 1 ? ` x${detail.count}` : "";
    const isCostOnlyTitle = !baseTitle || /^[+-]?\d+\*?$/.test(baseTitle);
    return `${isCostOnlyTitle ? "" : `${baseTitle} `}${costLabel}${repeatLabel}`;
  }

  function getAppliedAugmentDisplayText(detail) {
    const rawTitle = normalizeDisplayedSpellText(String(detail.augment.title || "").trim());
    const baseTitle = rawTitle.replace(/\s*\([^)]+\)\s*$/, "").trim();
    const isCostOnlyTitle = !baseTitle || /^[+-]?\d+\*?$/.test(baseTitle);
    return normalizeDisplayedSpellText(`${isCostOnlyTitle ? "" : `${baseTitle}: `}${detail.augment.description}`).trim();
  }

  function buildAppliedAugmentHtml(details) {
    if (!details.length) {
      return "<div><strong>Applied Augments:</strong><br><span>None</span></div>";
    }
    return `
      <div>
        <strong>Applied Augments:</strong>
        <div style="display:grid;gap:0.35rem;margin-top:0.35rem;">
          ${details.map((detail) => `
            <div style="display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:start;column-gap:0.5rem;">
              <span style="white-space:nowrap;font-weight:700;">${escapeHtml(formatAppliedAugmentLabel(detail))}</span>
              <span style="min-width:0;overflow-wrap:anywhere;">${escapeHtml(getAppliedAugmentDisplayText(detail))}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function buildCastDescriptionText(core) {
    let trimmed = getCoreDescriptionWithoutAugments(core);
    const descriptionMatch = trimmed.match(/(?:^|\n)\s*Description:\s*/i);
    if (descriptionMatch) {
      const start = (descriptionMatch.index || 0) + descriptionMatch[0].length;
      return trimmed.slice(start).trim();
    }
    return trimmed
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^(Name|SP Cost|School|Casting Time|Range|Target|Duration|Saving Throw)\s*:/i.test(line))
      .join("\n")
      .trim();
  }

  function buildPreparedSpellDescriptionHtml(actor, spellbookId, core, totalSP, details, spellName) {
    const resolvedAttributes = getResolvedBuiltSpellAttributes(core, totalSP);
    const attributeText = buildPreparedAttributeText(core, totalSP);
    const descriptionBody = buildCastDescriptionText(core);
    const spellAttackButtonHtml = buildSpellAttackButtonHtml(
      actor,
      spellbookId,
      core,
      spellName || resolvedAttributes.name,
      resolvedAttributes.savingThrow,
    );
    const spellAttackSpacerHtml = spellAttackButtonHtml
      ? spellAttackButtonHtml
      : `<div class="spellcrafting-spell-attack-spacer" style="height:0.45rem;"></div>`;
    const appliedAugmentsHtml = buildAppliedAugmentHtml(details);
    const attributeHtml = attributeText.replace(/\n/g, "<br>");
    const descriptionHtml = descriptionBody
      ? `<strong>Description:</strong><br>${escapeHtml(descriptionBody).replace(/\n/g, "<br>")}`
      : "";

    return `
      <div class="brewing-generated-description">
        <strong>${escapeHtml(resolvedAttributes.name)}</strong>
        <br>
        ${attributeHtml}
        ${spellAttackSpacerHtml}
        ${appliedAugmentsHtml}
        ${descriptionHtml ? `<br>${descriptionHtml}` : ""}
      </div>
    `;
  }

  async function promptForSpontaneousDraftName(state) {
    const core = getActiveItemById(state, state.selectedCoreId);
    if (!core) return null;

    const defaultName = getDisplaySpellName(core.name) || "";
    const content = `
      <div style="display:grid; gap:0.8rem;">
        <div style="display:grid; grid-template-columns:max-content minmax(0,1fr); align-items:center; gap:0.55rem; padding-bottom:0.35rem;">
          <span style="font-weight:700; white-space:nowrap;">Draft of</span>
          <input
            id="brewing-custom-name"
            type="text"
            value="${escapeHtml(defaultName)}"
            placeholder="Name your new draft"
            style="width:100%; min-height:2.2rem; padding:0.45rem 0.55rem; border:1px solid #8f8673; border-radius:4px;"
          />
        </div>
      </div>
    `;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      new Dialog({
        title: "Name New Draft",
        content,
        buttons: {
          accept: {
            label: "Accept",
            callback: (html) => {
              const input = html.find("#brewing-custom-name");
              const chosenName = String(input.val() || "").trim();
              settle(chosenName || null);
            },
          },
          cancel: {
            label: "Cancel",
            callback: () => settle(null),
          },
        },
        default: "accept",
        close: () => settle(null),
        render: (html) => {
          const input = html.find("#brewing-custom-name");
          const acceptButton = html.closest(".app").find('[data-button="accept"]');
          const syncAcceptState = () => {
            const hasName = String(input.val() || "").trim().length > 0;
            acceptButton.prop("disabled", !hasName);
          };

          acceptButton.prop("disabled", !defaultName.trim().length);
          input.on("input change", syncAcceptState);
          setTimeout(() => {
            input.trigger("focus");
            input[0]?.setSelectionRange?.(0, String(input.val() || "").length);
            syncAcceptState();
          }, 0);
        },
      }).render(true);
    });
  }

  function applyChatRollMode(chatData) {
    const rollMode = game.settings?.get("core", "rollMode") || CONST.DICE_ROLL_MODES.PUBLIC;
    const applyRollMode = ChatMessage.applyRollMode || ChatMessage.implementation?.applyRollMode;
    if (typeof applyRollMode === "function") {
      applyRollMode(chatData, rollMode);
    } else {
      chatData.rollMode = rollMode;
    }
    return chatData;
  }

  function registerSpellAttackChatCardHook() {
    globalThis.pf1SpellcraftingHandleAttackButton = async function(buttonElement) {
      const button = buttonElement instanceof HTMLElement ? buttonElement : buttonElement?.currentTarget;
      if (!button || button.disabled) return;

      const actorUuid = button.dataset.actorUuid || "";
      const spellbookId = button.dataset.spellbookId || "";
      const spellSchool = button.dataset.spellSchool || "";
      const savingThrow = button.dataset.savingThrow || "None";

      const actor = actorUuid ? await fromUuid(actorUuid) : null;
      if (!actor) {
        ui.notifications.warn("The actor for this Spell Attack could not be found.");
        return;
      }

      const attackData = getSpellAttackData(actor, spellbookId, spellSchool);
      const roll = new Roll(attackData.formulaText);
      await roll.evaluate();
      const d20Result = Number(roll.dice?.[0]?.total ?? roll.terms?.find?.((term) => term?.faces === 20)?.total ?? 0);
      const dcBonusTooltip = attackData.dcBonusTotal ? ` + ${attackData.dcBonusTotal} [Spell DC Bonuses]` : "";
      const tooltipText = `${d20Result} [1d20] + ${attackData.casterLevelHalf} [CL/2] + ${attackData.abilityMod} [${attackData.abilityLabel}]${dcBonusTooltip}`;

      const resultContent = `
        <div class="spellcrafting-spell-attack-result" style="display:flex;justify-content:center;padding:0.15rem 0;">
          <div title="${escapeHtml(tooltipText)}" style="min-width:208px;max-width:100%;padding:0.75rem 0.85rem;border:1px solid #b6a16e;border-radius:8px;background:linear-gradient(180deg, #f6f1e5 0%, #e8dfcf 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.55), 0 2px 5px rgba(0,0,0,0.08);text-align:center;cursor:help;">
            <div style="font-size:0.7rem;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:#6b5c3d;">Spell Attack</div>
            <div style="margin-top:0.22rem;display:flex;flex-direction:column;align-items:center;justify-content:center;">
              <span class="spellcrafting-spell-attack-total" style="font-weight:900;font-size:2rem;line-height:1;color:#1f1a12;">${escapeHtml(String(roll.total))}</span>
              <span style="margin-top:0.18rem;font-size:0.98rem;font-weight:700;line-height:1.08;color:#3e3424;">${escapeHtml(savingThrow)}</span>
            </div>
          </div>
        </div>
      `;
      const chatData = {
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content: resultContent,
      };
      applyChatRollMode(chatData);
      await ChatMessage.create(chatData);
    };

    if (globalThis.pf1SpellcraftingAttackHookId != null) {
      Hooks.off("renderChatMessage", globalThis.pf1SpellcraftingAttackHookId);
      Hooks.off("renderChatMessageHTML", globalThis.pf1SpellcraftingAttackHookId);
      globalThis.pf1SpellcraftingAttackHookId = null;
    }

    globalThis.pf1SpellcraftingAttackHookId = Hooks.on("renderChatMessageHTML", (message, element) => {
      const root = element instanceof HTMLElement ? element : null;
      if (!root) return;

      const buttons = root.querySelectorAll(".spellcrafting-spell-attack-button");
      if (!buttons.length) return;

      const messageAuthorId = String(message.author?.id || "");
      const isCreator = messageAuthorId === String(game.user.id);

      for (const button of buttons) {
        button.setAttribute("aria-disabled", isCreator ? "false" : "true");
        button.setAttribute("data-disabled", isCreator ? "false" : "true");
        button.style.opacity = isCreator ? "1" : "0.6";
        button.style.cursor = isCreator ? "pointer" : "not-allowed";

        if (!isCreator) {
          button.setAttribute("title", "Only the player who created this chat card can use Spell Attack.");
        } else {
          button.removeAttribute("title");
        }

        button.onclick = async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (button.dataset.disabled === "true") return;
          await globalThis.pf1SpellcraftingHandleAttackButton(button);
        };

        button.onkeydown = async (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          if (button.dataset.disabled === "true") return;
          await globalThis.pf1SpellcraftingHandleAttackButton(button);
        };
      }
    });
    globalThis.pf1SpellcraftingAttackHookRegistered = true;
  }

  function buildSpontaneousPotionItemData(actor, state, options = {}) {
    const core = getActiveItemById(state, state.selectedCoreId);
    if (!core) throw new Error("Select a Core before brewing.");
    const totalSP = calculateTotalSP(actor, state);
    const augmentDetails = [
      ...getSelectedAugmentDetails(actor, state, "core"),
      ...getSelectedAugmentDetails(actor, state, "spell"),
    ];
    const resolvedAttributes = getResolvedBuiltSpellAttributes(core, totalSP);
    const customName = String(options.customName || "").trim() || resolvedAttributes.name;
    const coreSource = typeof core?.toObject === "function" ? core.toObject() : deepCloneData(core);
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

    itemData.name = `Draft of ${customName}`;
    itemData.type = "consumable";
    itemData.img = coreSource?.img || templateSource?.img || itemData.img || "icons/consumables/potions/potion-bottle-corked-blue.webp";
    itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};
    itemData.system = itemData.system && typeof itemData.system === "object" ? itemData.system : {};
    setObjectPathValue(itemData, ["flags", FLAG_SCOPE, "sourceUuid"], String(core.uuid || ""));
    setObjectPathValue(itemData, ["flags", FLAG_SCOPE, "deleteOnLongRest"], true);
    setObjectPathValue(itemData, ["flags", FLAG_SCOPE, "brewType"], "draft");
    setObjectPathValue(itemData, ["system", "description"], itemData.system.description && typeof itemData.system.description === "object" ? itemData.system.description : {});
    setObjectPathValue(itemData, ["system", "description", "value"], buildPreparedSpellDescriptionHtml(actor, state.spellbookId, core, totalSP, augmentDetails, customName));
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
    const sourceActions = getItemActionEntries(coreSource).map((action) => normalizeActionSourceData(action));
    if (sourceActions.length) {
      setObjectPathValue(itemData, ["system", "actions"], sourceActions.map((action) => deepCloneData(action)));
    } else {
      ensurePrimaryDrinkAction(itemData);
    }
    populateBuiltPotionItemAttributes(itemData, core, resolvedAttributes, totalSP);
    return { core, itemData, totalSP, augmentDetails, resolvedAttributes };
  }

  function populateBuiltPotionItemAttributes(itemData, core, resolvedAttributes, totalSP) {
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
    setObjectPathValue(itemData, ["system", "spellPointCost"], totalSP);
    setObjectPathValue(itemData, ["system", "spCost"], totalSP);
    setObjectPathValue(itemData, ["system", "spellPoints", "cost"], totalSP);
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
      setObjectPathValue(itemData, ["system", "range", "units"], getObjectPath(core, ["system", "range", "units"]) || "");
    } else {
      setObjectPathValue(itemData, ["system", "range"], resolvedAttributes.range);
    }
    const actions = ensurePrimaryDrinkAction(itemData);
    for (const action of actions) {
      setObjectPathValue(action, ["name"], "Drink");
      setObjectPathValue(action, ["sp"], totalSP);
      setObjectPathValue(action, ["spellPointCost"], totalSP);
      setObjectPathValue(action, ["uses", "spellPointCost"], String(totalSP));
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

  function buildDialogContent(spellbooks, state) {
    const spellbookOptions = spellbooks.map((book) => getSpellbookOptionHtml(book, state.spellbookId)).join("");
    const spellListItems = "<div class=\"brewing-empty\">Select a spellbook to see spells.</div>";
    const coreListItems = "<div class=\"brewing-empty\">Select a spellbook to see cores.</div>";
    const coreAugmentsHtml = "<div class=\"brewing-empty\">Select a core to view core augments.</div>";
    const spellAugmentsHtml = "<div class=\"brewing-empty\">Select a spellbook to view spell augments.</div>";

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
        .brewing-mode { display: none; min-height: 0; }
        .brewing-root.is-prepared .brewing-mode-prepared { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
        .brewing-root.is-spontaneous .brewing-mode-spontaneous { display: grid; grid-template-rows: auto minmax(0, 1fr); row-gap: 1.5rem; flex: 1 1 auto; min-height: 0; }
        .brewing-root.is-spontaneous { padding: 0.9rem; gap: 0; }
        .brewcraft-body { min-height: 0; overflow: hidden; display: flex; align-items: stretch; }
        .brewcraft-grid { display: grid; grid-template-columns: 2fr 3fr 5fr; gap: 1.5rem; width: 100%; height: 100%; min-height: 0; flex: 1 1 auto; align-items: stretch; }
        .brewcraft-panel { border: 1px solid #7d7668; background: rgba(201, 196, 184, 0.94); padding: 1rem 1.1rem; border-radius: 8px; overflow: hidden; color: #151412; width: 100%; box-sizing: border-box; min-width: 0; min-height: 0; box-shadow: 0 1px 0 rgba(255, 255, 255, 0.18) inset; }
        .brewcraft-panel h3 { margin: 0 0 0.8rem; padding-bottom: 0.35rem; border-bottom: 1px solid #b85b4d; font-size: 1.05rem; font-weight: 700; color: #2c2a25; }
        .brewcraft-scrollable-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; height: 100%; }
        .brewcraft-toolbar { display: grid; grid-template-columns: minmax(290px, 380px) auto auto; align-items: end; gap: 1.25rem; }
        .brewcraft-actions { display: inline-grid; grid-template-columns: repeat(2, minmax(120px, 150px)); gap: 1.1rem; justify-content: flex-start; width: auto; }
        .brewcraft-actions button { width: 100%; min-width: 0; padding: 0.5rem 0.75rem; font-size: 0.92rem; font-weight: 600; white-space: nowrap; border: 1px solid #9e916d; border-radius: 4px; background: linear-gradient(to bottom, #ddd4b8, #c9bea0); color: #1c1914; }
        .brewcraft-actions button:hover { background: linear-gradient(to bottom, #e4dbc0, #d0c4a6); }
        .brewcraft-actions button:disabled { background: linear-gradient(to bottom, #b9b19d, #9d9583); border-color: #857d6d; color: #5d564c; cursor: default; opacity: 0.85; }
        .brewcraft-costs { display: grid; grid-template-columns: auto auto auto; column-gap: 1.25rem; row-gap: 0.2rem; align-items: center; padding: 0.65rem 0.85rem; background: rgba(223, 218, 205, 0.95); border: 1px solid #8f8674; border-radius: 6px; color: #111; font-size: 0.98rem; width: 41rem; max-width: 41rem; min-width: 41rem; min-height: 2.35rem; box-sizing: border-box; }
        .brewcraft-costs div { display: flex; align-items: baseline; gap: 0.5rem; }
        .brewcraft-costs strong { font-size: 0.95rem; color: #333029; }
        .brewcraft-costs span { font-size: 1.85rem; font-weight: 700; line-height: 1; display: inline-block; color: #191816; }
        .brewcraft-school-value { width: 13ch; min-width: 13ch; text-align: left; font-size: 1.25rem; }
        .brewcraft-core-filter { margin-bottom: 0.8rem; }
        .brewcraft-core-filter input { width: 100%; min-height: 2rem; padding: 0.35rem 0.5rem; border: 1px solid #8f8673; border-radius: 4px; background: #e4dfd3; color: #161616; font-size: 0.92rem; box-sizing: border-box; }
        .brewcraft-core-list, .brewcraft-augment-list { flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; min-height: 0; padding-right: 0.2rem; }
        .brewcraft-core-item { display: grid; grid-template-columns: auto minmax(0, 1fr) max-content; align-items: center; gap: 0.65rem; background: rgba(236, 233, 225, 0.82); padding: 0.45rem 0.65rem; border-radius: 4px; color: #111; border: 1px solid #9f9787; font-size: 0.96rem; transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; cursor: pointer; }
        .brewcraft-core-item:hover { background: rgba(244, 240, 232, 0.9); border-color: #887d63; }
        .brewcraft-core-item.selected { background: rgba(173, 220, 182, 0.98); border-color: #1f7a3d; box-shadow: inset 0 0 0 1px rgba(21, 100, 46, 0.34), 0 0 0 1px rgba(31, 122, 61, 0.28), 0 2px 6px rgba(24, 92, 44, 0.18); }
        .brewcraft-core-item input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; margin: 0; }
        .brewcraft-core-icon { width: 2rem; height: 2rem; object-fit: cover; border-radius: 4px; border: 1px solid rgba(89, 82, 66, 0.35); background: rgba(255, 255, 255, 0.75); box-shadow: 0 1px 2px rgba(0,0,0,0.12); }
        .brewcraft-core-name { min-width: 0; overflow-wrap: anywhere; word-break: break-word; font-weight: 700; }
        .brewcraft-core-meta { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 0.12rem; text-align: right; min-width: max-content; }
        .brewcraft-core-school { color: #5a554a; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; }
        .brewcraft-core-cost { color: #6b4225; font-size: 0.8rem; font-weight: 700; white-space: nowrap; }
        .brewcraft-augment-group { display: grid; gap: 0.45rem; }
        .brewcraft-augment-group + .brewcraft-augment-group { margin-top: 0.35rem; padding-top: 0.55rem; border-top: 1px solid rgba(159, 154, 140, 0.5); }
        .brewcraft-augment-group-title { font-size: 1rem; font-weight: 800; color: #2f2b24; line-height: 1.2; }
        .brewcraft-augment-group-limitation { margin-top: -0.1rem; font-size: 0.86rem; line-height: 1.28; color: #4a4438; }
        .brewcraft-augment-entry { padding: 0.65rem 0.8rem; border: 1px solid #9c9485; border-radius: 4px; background: rgba(236, 233, 225, 0.78); color: #111; font-size: 0.91rem; }
        .brewcraft-augment-entry label { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: start; gap: 0.8rem; }
        .brewcraft-augment-entry strong { min-width: 2.25rem; padding-top: 0.05rem; color: #171614; }
        .brewcraft-augment-entry .augment-description { color: #2f2d28; font-size: 0.91rem; line-height: 1.28; }
        .brewcraft-repeat-control { display: inline-grid; grid-template-columns: auto auto auto; align-items: center; gap: 0.25rem; }
        .brewcraft-repeat-control button { width: 1.8rem; min-width: 1.8rem; height: 1.8rem; padding: 0; border: 1px solid #978d79; border-radius: 4px; background: #d8cfb4; color: #2b2924; font-size: 1rem; font-weight: 700; line-height: 1; }
        .brewcraft-repeat-control button:disabled { background: #cfc8b7; border-color: #b4ac98; color: #8d877c; cursor: default; opacity: 0.75; }
        .brewcraft-repeat-control .repeat-count { width: 2.6rem; min-width: 2.6rem; text-align: center; min-height: 1.8rem; padding: 0.2rem 0.25rem; font-size: 0.86rem; border: 1px solid #978d79; border-radius: 4px; background: #e3ddd1; }
        .ui-dialog-buttonpane { display: none !important; }
      </style>
      <div id="brewing-root" class="brewing-root is-prepared">
        <div class="brewing-mode brewing-mode-prepared">
          <div class="brewing-panel brewing-top-panel">
            <div class="brewing-field">
              <label for="selectedSpellbookPrepared">Spellbook</label>
              <select id="selectedSpellbookPrepared">${spellbookOptions}</select>
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
        <div class="brewing-mode brewing-mode-spontaneous">
          <div class="brewcraft-panel">
            <div class="brewcraft-toolbar">
              <div class="brewing-field">
                <label for="selectedSpellbookSpontaneous">Spellbook</label>
                <select id="selectedSpellbookSpontaneous">${spellbookOptions}</select>
              </div>
              <div class="brewcraft-costs">
                <div><strong>Total SP Cost:</strong> <span id="brewcraftTotalSP">0</span></div>
                <div><strong>Spell Level:</strong> <span id="brewcraftSpellLevel">0</span></div>
                <div><strong>School:</strong> <span id="brewcraftSpellSchool" class="brewcraft-school-value">None</span></div>
              </div>
              <div class="brewcraft-actions">
                <button type="button" class="brewcraft-brew" disabled>Brew</button>
                <button type="button" class="brewcraft-cancel">Cancel</button>
              </div>
            </div>
          </div>
          <div class="brewcraft-body">
            <div class="brewcraft-grid">
              <div class="brewcraft-panel brewcraft-scrollable-panel">
                <h3>Spell Cores</h3>
                <div class="brewcraft-core-filter">
                  <input type="text" id="coreFilterInput" value="" placeholder="Filter cores by name" autocomplete="off" />
                </div>
                <div class="brewcraft-core-list">${coreListItems}</div>
              </div>
              <div class="brewcraft-panel brewcraft-scrollable-panel">
                <h3>Core Augments</h3>
                <div id="brewcraftCoreAugmentsContainer" class="brewcraft-augment-list">${coreAugmentsHtml}</div>
              </div>
              <div class="brewcraft-panel brewcraft-scrollable-panel">
                <h3>Spell Augments</h3>
                <div id="brewcraftSpellAugmentsContainer" class="brewcraft-augment-list">${spellAugmentsHtml}</div>
              </div>
            </div>
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

    eventRoot.off("change", "#selectedSpellbookPrepared, #selectedSpellbookSpontaneous").on("change", "#selectedSpellbookPrepared, #selectedSpellbookSpontaneous", async (event) => {
      state.spellbookId = String(event.target.value || "");
      state.selectedSpellId = null;
      clearSelectedSpellData(state);
      saveLastSelection();
      await updateDialog(html, state, actor);
    });

    eventRoot.off("change", "input[name=selectedSpell]").on("change", "input[name=selectedSpell]", async (event) => {
      state.selectedSpellId = String(event.target.value || "");
      renderSpellList(html, state);
      renderButtons(html, state);
    });

    eventRoot.off("input", "#coreFilterInput").on("input", "#coreFilterInput", async (event) => {
      state.coreFilterText = String(event.target.value || "");
      const selectedCore = getActiveItemById(state, state.selectedCoreId);
      const matchesFilter = !selectedCore || filterCoresByName([selectedCore], state.coreFilterText, state).length > 0;
      if (coreFilterDebounceHandle) clearTimeout(coreFilterDebounceHandle);
      coreFilterDebounceHandle = setTimeout(() => {
        if (!matchesFilter) clearSelectedSpellData(state);
        renderSpontaneousCoreList(html, state);
        renderSpontaneousAugmentPanels(html, actor, state);
        renderSpontaneousSummary(html, state);
        renderButtons(html, state);
      }, FILTER_INPUT_DEBOUNCE_MS);
    });

    eventRoot.off("change", "input[name=selectedCore]").on("change", "input[name=selectedCore]", async (event) => {
      state.selectedCoreId = String(event.target.value || "");
      state.selectedCoreAugments = {};
      await updateDialog(html, state, actor);
    });

    eventRoot.off("change", "input[type=checkbox][data-augment-key]").on("change", "input[type=checkbox][data-augment-key]", async (event) => {
      const key = event.target.dataset.augmentKey;
      const type = event.target.dataset.augmentType;
      const checked = event.target.checked;
      const selectedCollection = type === "core" ? state.selectedCoreAugments : state.selectedSpellAugments;
      if (checked) {
        const repeatCountInput = eventRoot.find(`input.repeat-count[data-augment-key="${key}"]`).first();
        selectedCollection[key] = { count: Math.max(1, Number(repeatCountInput.val()) || 1) };
      } else {
        delete selectedCollection[key];
      }
      await updateDialog(html, state, actor);
    });

    eventRoot.off("change", ".repeat-count").on("change", ".repeat-count", async (event) => {
      const key = event.target.dataset.augmentKey;
      const type = event.target.dataset.augmentType;
      const selectedCollection = type === "core" ? state.selectedCoreAugments : state.selectedSpellAugments;
      const isSelected = !!selectedCollection[key];
      const minValue = isSelected ? 1 : 0;
      const nextValue = Math.min(99, Math.max(minValue, Number(event.target.value) || minValue));
      event.target.value = nextValue;
      if (isSelected) selectedCollection[key].count = nextValue;
      await updateDialog(html, state, actor);
    });

    eventRoot.off("click", ".repeat-adjust").on("click", ".repeat-adjust", async (event) => {
      event.preventDefault();
      const button = event.currentTarget;
      if (button.disabled) return;
      const key = button.dataset.augmentKey;
      const type = button.dataset.augmentType;
      const selectedCollection = type === "core" ? state.selectedCoreAugments : state.selectedSpellAugments;
      if (!selectedCollection[key]) return;
      selectedCollection[key].count = Math.min(99, Math.max(1, (selectedCollection[key].count || 1) + (Number(button.dataset.direction) || 0)));
      await updateDialog(html, state, actor);
    });

    eventRoot.off("click", ".brewing-cancel, .brewcraft-cancel").on("click", ".brewing-cancel, .brewcraft-cancel", (event) => {
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

    eventRoot.off("click", ".brewcraft-brew").on("click", ".brewcraft-brew", async (event) => {
      event.preventDefault();
      if (event.currentTarget.disabled) return;
      try {
        saveLastSelection();
        const createdItem = await addSpontaneousPotionToInventory(actor, state);
        if (createdItem) {
          ui.notifications.info(`You brewed ${createdItem.name}.`);
          dialog.close();
        }
      } catch (err) {
        console.warn("Brewing macro could not create the spontaneous draft.", err);
        ui.notifications.error(err?.message || "The potion could not be brewed.");
      }
    });
  }

  async function updateDialog(html, state, actor) {
    state.preparationMode = getSpellbookPreparationType(actor, state.spellbookId) || "prepared";
    const isSpontaneous = state.preparationMode === "spontaneous" || state.preparationMode === "hybrid";
    applyDialogChrome(html, isSpontaneous);
    const root = html.find("#brewing-root");
    root.toggleClass("is-prepared", !isSpontaneous);
    root.toggleClass("is-spontaneous", isSpontaneous);

    html.find("#selectedSpellbookPrepared").val(state.spellbookId);
    html.find("#selectedSpellbookSpontaneous").val(state.spellbookId);

    if (state.preparationMode === "spontaneous" || state.preparationMode === "hybrid") {
      await ensureSpontaneousSpellDataLoaded(actor, state);
      if (!getActiveItemById(state, state.selectedCoreId)) {
        clearSelectedSpellData(state);
      }
      html.find("#coreFilterInput").val(state.coreFilterText || "");
      renderSpontaneousCoreList(html, state);
      renderSpontaneousAugmentPanels(html, actor, state);
      renderSpontaneousSummary(html, state);
      renderButtons(html, state);
      return;
    }

    if (state.spellbookId) {
      state.availableSpells = sortItemsByDisplayName(
        getSpellbookSpells(actor, state.spellbookId).filter((item) => !isAugmentSpell(item)),
      );
      state.itemLookup = indexItemsBySourceKey(state.availableSpells);
    } else {
      state.availableSpells = [];
      state.itemLookup = {};
    }

    if (!getActiveItemById(state, state.selectedSpellId)) {
      state.selectedSpellId = null;
    }

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
    const preparedEnabled = state.preparationMode !== "spontaneous" && state.preparationMode !== "hybrid" && !!state.selectedSpellId;
    const spontaneousEnabled = state.preparationMode === "spontaneous" && !!state.selectedCoreId;
    html.find(".brewing-brew").prop("disabled", !preparedEnabled);
    html.find(".brewcraft-brew").prop("disabled", !spontaneousEnabled);
  }

  function renderSpontaneousCoreList(html, state) {
    const coreContainer = html.find(".brewcraft-core-list");
    const cores = filterCoresByName(state.availableCores, state.coreFilterText, state);
    if (state.preparationMode === "hybrid") {
      coreContainer.html("<div class=\"brewing-empty\">Hybrid spellbooks are not supported until the spellbook is set to Prepared or Spontaneous.</div>");
      return;
    }
    if (!cores.length) {
      coreContainer.html(`<div class="brewing-empty">${state.coreFilterText ? `No cores start with "${escapeHtml(state.coreFilterText.trim())}".` : "No cores found in the selected spellbook."}</div>`);
      return;
    }
    coreContainer.html(cores.map((core) => {
      const coreKey = getItemSourceKey(core);
      const checked = coreKey === state.selectedCoreId ? "checked" : "";
      const selectedClass = checked ? " selected" : "";
      const titleText = escapeHtml(getCachedCoreHoverDescription(state, core));
      const schoolText = escapeHtml(getSpellSchool(core));
      const spellPointCost = getCoreHoverSpellPointCost(core);
      const iconSrc = escapeHtml(core?.img || "icons/svg/mystery-man.svg");
      return `<label class="brewcraft-core-item${selectedClass}" title="${titleText}"><input type="radio" name="selectedCore" value="${coreKey}" ${checked} /><img class="brewcraft-core-icon" src="${iconSrc}" alt="" loading="lazy" /><span class="brewcraft-core-name">${escapeHtml(getCachedDisplaySpellName(state, core))}</span><span class="brewcraft-core-meta"><span class="brewcraft-core-school">${schoolText}</span><span class="brewcraft-core-cost">${spellPointCost} SP</span></span></label>`;
    }).join(""));
  }

  function buildCoreAugmentsHtml(actor, state) {
    const core = getActiveItemById(state, state.selectedCoreId);
    if (!core) return "<div class=\"brewing-empty\">Select a core to view core augments.</div>";
    const augmentEntries = parseAugmentLines(getSpellDescription(core), /Core Augments?:/i);
    if (!augmentEntries.length) return "<div class=\"brewing-empty\">No core augments were detected for this core.</div>";
    return augmentEntries.map((entry, index) => {
      const key = `core-${getItemSourceKey(core)}-${index}`;
      const checked = state.selectedCoreAugments[key] ? "checked" : "";
      const count = state.selectedCoreAugments[key]?.count || 0;
      const repeatableHtml = entry.repeatable
        ? `<div class="brewcraft-repeat-control"><button type="button" class="repeat-adjust" data-direction="-1" data-augment-key="${key}" data-augment-type="core" ${checked ? "" : "disabled"}>-</button><input class="repeat-count" type="number" min="0" max="99" value="${count}" data-augment-key="${key}" data-augment-type="core" ${checked ? "" : "disabled"} /><button type="button" class="repeat-adjust" data-direction="1" data-augment-key="${key}" data-augment-type="core" ${checked ? "" : "disabled"}>+</button></div>`
        : "";
      return `<div class="brewcraft-augment-entry"><label><input type="checkbox" data-augment-key="${key}" data-augment-type="core" ${checked} /><strong>${escapeHtml(normalizeDisplayedSpellText(entry.title))}</strong><span class="augment-description">${escapeHtml(normalizeDisplayedSpellText(entry.description))}</span>${repeatableHtml}</label></div>`;
    }).join("");
  }

  function buildSpellAugmentsHtml(actor, state) {
    const augments = state.availableSpellAugments;
    if (!augments.length) return "<div class=\"brewing-empty\">No spell augments were detected in the selected spellbook.</div>";
    const entries = augments.flatMap((augmentItem) => parseAugmentLines(getSpellDescription(augmentItem), /Augment|Description:/i).map((entry, index) => ({ augmentItem, entry, index })));
    if (!entries.length) return "<div class=\"brewing-empty\">No augment options were detected in the available augment spells.</div>";
    const groupedEntries = entries.reduce((groups, entryData) => {
      const groupKey = entryData.augmentItem.id;
      if (!groups.has(groupKey)) groups.set(groupKey, { augmentItem: entryData.augmentItem, entries: [] });
      groups.get(groupKey).entries.push(entryData);
      return groups;
    }, new Map());
    return Array.from(groupedEntries.values()).map(({ augmentItem, entries: groupEntries }) => {
      const limitationText = getSpellAugmentLimitation(getSpellDescription(augmentItem));
      const limitationHtml = limitationText ? `<div class="brewcraft-augment-group-limitation"><strong>Limitation:</strong> ${escapeHtml(limitationText)}</div>` : "";
      const entryHtml = groupEntries.map(({ entry, index }) => {
        const key = `spell-${getItemSourceKey(augmentItem)}-${index}`;
        const checked = state.selectedSpellAugments[key] ? "checked" : "";
        const count = state.selectedSpellAugments[key]?.count || 0;
        const repeatableHtml = entry.repeatable
          ? `<div class="brewcraft-repeat-control"><button type="button" class="repeat-adjust" data-direction="-1" data-augment-key="${key}" data-augment-type="spell" ${checked ? "" : "disabled"}>-</button><input class="repeat-count" type="number" min="0" max="99" value="${count}" data-augment-key="${key}" data-augment-type="spell" ${checked ? "" : "disabled"} /><button type="button" class="repeat-adjust" data-direction="1" data-augment-key="${key}" data-augment-type="spell" ${checked ? "" : "disabled"}>+</button></div>`
          : "";
        const title = normalizeDisplayedSpellText(entry.title || `${getDisplaySpellName(augmentItem.name)} (${entry.cost >= 0 ? "+" : ""}${entry.cost})`);
        return `<div class="brewcraft-augment-entry"><label><input type="checkbox" data-augment-key="${key}" data-augment-type="spell" ${checked} /><strong>${escapeHtml(title)}</strong><span class="augment-description">${escapeHtml(normalizeDisplayedSpellText(entry.description))}</span>${repeatableHtml}</label></div>`;
      }).join("");
      return `<div class="brewcraft-augment-group"><div class="brewcraft-augment-group-title">${escapeHtml(getDisplaySpellName(augmentItem.name))}</div>${limitationHtml}${entryHtml}</div>`;
    }).join("");
  }

  function renderSpontaneousAugmentPanels(html, actor, state) {
    html.find("#brewcraftCoreAugmentsContainer").html(buildCoreAugmentsHtml(actor, state));
    html.find("#brewcraftSpellAugmentsContainer").html(buildSpellAugmentsHtml(actor, state));
  }

  function renderSpontaneousSummary(html, state) {
    const totalSP = calculateTotalSP(actor, state);
    html.find("#brewcraftTotalSP").text(totalSP);
    html.find("#brewcraftSpellLevel").text(Math.max(0, Math.ceil(totalSP / 2)));
    const selectedCore = getActiveItemById(state, state.selectedCoreId);
    html.find("#brewcraftSpellSchool").text(selectedCore ? getSpellSchool(selectedCore) || "None" : "None");
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
