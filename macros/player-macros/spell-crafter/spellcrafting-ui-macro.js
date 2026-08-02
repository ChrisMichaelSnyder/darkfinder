// Foundry VTT 13 macro for Pathfinder 1e spellcrafting UI

(async () => {
  const actor = canvas.tokens.controlled[0]?.actor || game.user.character;
  if (!actor) {
    return ui.notifications.warn("Please select a token or set an active character before using Spellcrafting.");
  }

  const STORAGE_KEY = `pf1-spellcrafting-last-books-${actor.id}`;
  const FLAG_SCOPE = "pf1-spellcrafting";

  const spellbooks = getSpellbooks(actor);
  if (!spellbooks.length) {
    return ui.notifications.warn("No spellbooks found on this actor. Add spellbook items first.");
  }

  const lastSelection = loadLastSelection();
  const state = {
    spellbookId: lastSelection.spellbookId || lastSelection.sourceId || spellbooks[0]?.id,
    useLegacyPreparedCores: false,
    classOnlyLegacyPreparedCores: true,
    coreFilterText: "",
    preparationMode: null,
    selectedCoreId: null,
    selectedCoreAugments: {},
    selectedSpellAugments: {},
    availableCores: [],
    availableSpellAugments: [],
    itemLookup: {},
    warnedHybridSpellbookId: null,
    hasSanitizedSpellItems: false,
    spellDataCacheKey: null,
    displayNameCache: {},
    displayNameSearchCache: {},
    coreHoverDescriptionCache: {},
  };
  const FILTER_INPUT_DEBOUNCE_MS = 75;
  let coreFilterDebounceHandle = null;
  let preparedSpellDataCache = null;
  let legacyPreparedCoreDataCache = null;

  const dialog = new Dialog({
    title: "Spellcrafting Spell Builder",
    content: buildDialogContent(spellbooks, state, actor),
    buttons: {},
    width: 1800,
    height: 860,
    resizable: true,
    render: async function(html) {
      const dialogWindow = html.closest(".dialog");
      let dialogContent = dialogWindow.find(".window-content");
      if (!dialogContent.length) dialogContent = html;
      dialogWindow.css({ width: "1800px", height: "860px", maxWidth: "1800px", maxHeight: "860px" });
      dialogContent.css({ width: "100%", maxWidth: "1800px", height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", padding: "0.75rem", boxSizing: "border-box", minHeight: 0 });
      html.css({ width: "100%", minWidth: "1700px", overflow: "hidden", display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 });
      if (dialogWindow.length) {
        dialogWindow.addClass("spellcrafting-dialog");
        dialogWindow.attr("data-spellcrafting", "true");
      }
      bindDialogEvents(html, spellbooks, state, actor);
      await updateDialog(html, spellbooks, state, actor);
    },
  }).render(true);

  function loadLastSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn("Spellcrafting macro could not read last selection.", err);
      return {};
    }
  }

  function saveLastSelection() {
    try {
      const payload = {
        spellbookId: state.spellbookId,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("Spellcrafting macro could not save last selection.", err);
    }
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

  function getSpellbookNameFromAttributes(actor, key) {
    const resolved = resolveSpellbookAttributeEntry(actor, key);
    if (!resolved) return null;
    const entry = resolved[1];
    return entry.name || entry.label || getObjectPath(entry, ["spellbook", "name"]) || getObjectPath(entry, ["book", "name"]) || null;
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

    if (!bookMap.size) {
      const actorData = actor.system || actor.data?.data || actor.data || {};
      const collectFromObject = (value, source) => {
        if (!value) return;
        if (Array.isArray(value)) {
          value.forEach((entry, index) => {
            if (!entry) return;
            const id = entry?.id || entry?.name || entry?.label || `spellbook-${index}`;
            const name = entry?.name || entry?.label || `Spellbook ${index + 1}`;
            addBook(id, name, source);
          });
        } else if (typeof value === "object") {
          Object.entries(value).forEach(([key, entry]) => {
            if (entry && typeof entry === "object") {
              const id = entry?.id || entry?.name || entry?.label || key;
              const name = entry?.name || entry?.label || key;
              addBook(id, name, source);
            } else if (typeof entry === "string" || typeof entry === "number") {
              addBook(key, String(entry), source);
            }
          });
        }
      };

      collectFromObject(getObjectPath(actorData, ["spellbooks"]), "actor-data");
      collectFromObject(getObjectPath(actorData, ["spellbook"]), "actor-data");
      collectFromObject(getObjectPath(actorData, ["spellbookInfo"]), "actor-data");
      collectFromObject(getObjectPath(actorData, ["spellBooks"]), "actor-data");

      collectFromObject(getObjectPath(actor.flags, ["pf1", "spellbooks"]), "flags");
      collectFromObject(getObjectPath(actor.flags, ["pf1", "spellbook"]), "flags");
      collectFromObject(getObjectPath(actor.flags, ["spellbooks"]), "flags");
      collectFromObject(getObjectPath(actor.flags, ["spellbook"]), "flags");

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
    }

    return Array.from(bookMap.values());
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

  function getCachedCoreHoverDescription(state, core) {
    const itemKey = getItemSourceKey(core);
    if (!itemKey) return buildCoreHoverDescription(core, state);
    const hoverKey = `${itemKey}|${state.preparationMode || "unknown"}|${state.useLegacyPreparedCores ? "legacy" : "default"}`;
    if (state.coreHoverDescriptionCache[hoverKey] == null) {
      state.coreHoverDescriptionCache[hoverKey] = buildCoreHoverDescription(core, state);
    }
    return state.coreHoverDescriptionCache[hoverKey];
  }

  function sortItemsByDisplayName(items) {
    return [...items].sort((left, right) => {
      const leftName = getDisplaySpellName(left?.name || "");
      const rightName = getDisplaySpellName(right?.name || "");
      return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
    });
  }

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).filter(Boolean).map((value) => String(value))));
  }

  function uniqueReferenceEntries(values) {
    const seen = new Set();
    const entries = [];
    for (const value of values || []) {
      if (!value) continue;
      const normalized = typeof value === "string"
        ? { uuid: String(value) }
        : {
            uuid: value.uuid ? String(value.uuid) : "",
            pack: value.pack ? String(value.pack) : "",
            id: value.id ? String(value.id) : "",
            name: value.name ? String(value.name) : "",
          };
      const identity = normalized.uuid || `${normalized.pack}:${normalized.id}` || normalized.name;
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      entries.push(normalized);
    }
    return entries;
  }

  function normalizeSpellReferenceName(name) {
    return getDisplaySpellName(name).trim().toLowerCase();
  }

  function loadLegacySpontaneousSpellData(actor, spellbookId, state) {
    state.availableCores = sortItemsByDisplayName(getCoreSpells(actor, spellbookId));
    state.availableSpellAugments = sortItemsByDisplayName(getAugmentItems(actor, spellbookId));
    state.itemLookup = indexItemsBySourceKey([...state.availableCores, ...state.availableSpellAugments]);
  }

  function mapSpontaneousItemsToBestSource(items, compendiumIndex) {
    return sortItemsByDisplayName((items || []).map((item) => {
      const compendiumMatch = compendiumIndex?.get(normalizeSpellReferenceName(item?.name || ""));
      return compendiumMatch || item;
    }));
  }

  function clearSelectedSpellData(state) {
    state.selectedCoreId = null;
    state.selectedCoreAugments = {};
    state.selectedSpellAugments = {};
  }

  function getSpellbookKeyLookup(spellbooks, actor) {
    const lookup = new Map();
    for (const book of spellbooks || []) {
      if (!book?.id) continue;
      const resolved = resolveSpellbookAttributeEntry(actor, book.id);
      const id = String(resolved?.[0] || book.id);
      const name = book.name
        || resolved?.[1]?.name
        || resolved?.[1]?.label
        || getObjectPath(resolved?.[1], ["spellbook", "name"])
        || getObjectPath(resolved?.[1], ["book", "name"])
        || id;
      lookup.set(id, name);
    }
    return lookup;
  }

  function collectSpellbookCandidatesFromSpell(spell) {
    const candidates = [
      getObjectPath(spell, ["system", "spellbook"]),
      getObjectPath(spell, ["system", "spellbookId"]),
      getObjectPath(spell, ["system", "spellbookName"]),
      getObjectPath(spell, ["flags", "pf1", "spellbook", "id"]),
      getObjectPath(spell, ["flags", "pf1", "spellbook", "name"]),
      getObjectPath(spell, ["flags", "spellbook", "id"]),
      getObjectPath(spell, ["flags", "spellbook", "name"]),
      getObjectPath(spell, ["data", "spellbook"]),
      getObjectPath(spell, ["data", "spellbookId"]),
      getObjectPath(spell, ["data", "spellbookName"]),
    ];
    return uniqueStrings(candidates);
  }

  function resolveValidSpellbookKey(actor, spellbooks, candidate) {
    if (candidate == null || candidate === "") return null;
    const asText = String(candidate);
    const keyLookup = getSpellbookKeyLookup(spellbooks, actor);
    if (keyLookup.has(asText)) return asText;

    const resolved = resolveSpellbookAttributeEntry(actor, candidate);
    if (resolved?.[0] && keyLookup.has(String(resolved[0]))) return String(resolved[0]);

    const normalizedCandidate = asText.trim().toLowerCase();
    for (const [key, name] of keyLookup.entries()) {
      if (String(name || "").trim().toLowerCase() === normalizedCandidate) return key;
    }
    return null;
  }

  function getCanonicalSpellbookKey(actor, spellbookId, spellbooks) {
    const directResolved = resolveSpellbookAttributeEntry(actor, spellbookId);
    if (directResolved?.[0]) return String(directResolved[0]);

    const keyLookup = getSpellbookKeyLookup(spellbooks, actor);
    if (keyLookup.has(String(spellbookId))) return String(spellbookId);

    return resolveValidSpellbookKey(actor, spellbooks, spellbookId);
  }

  async function sanitizeActorSpellbookReferences(actor, spellbooks) {
    const keyLookup = getSpellbookKeyLookup(spellbooks, actor);
    if (!keyLookup.size) return 0;

    const updates = [];
    for (const spell of actor.items.filter((item) => item.type === "spell")) {
      const currentRefs = getSpellbookRefs(spell).map((ref) => String(ref.id));
      const hasValidRef = currentRefs.some((ref) => keyLookup.has(ref));
      if (hasValidRef) continue;

      const candidates = collectSpellbookCandidatesFromSpell(spell);
      const resolvedKey = candidates.map((candidate) => resolveValidSpellbookKey(actor, spellbooks, candidate)).find(Boolean);
      if (!resolvedKey) continue;

      updates.push({
        _id: spell.id,
        "system.spellbook": resolvedKey,
        "system.spellbookId": resolvedKey,
        "system.spellbookName": keyLookup.get(resolvedKey) || resolvedKey,
        "flags.pf1.spellbook": { id: resolvedKey, name: keyLookup.get(resolvedKey) || resolvedKey },
        "flags.spellbook": { id: resolvedKey, name: keyLookup.get(resolvedKey) || resolvedKey },
      });
    }

    if (!updates.length) return 0;
    await actor.updateEmbeddedDocuments("Item", updates);
    return updates.length;
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

  function getCoreSpells(actor, sourceId) {
    const spells = getSpellbookSpells(actor, sourceId);
    return spells.filter((spell) => isCoreSpell(spell));
  }

  function getAugmentItems(actor, sourceId) {
    const spells = getSpellbookSpells(actor, sourceId);
    return spells.filter((spell) => isAugmentSpell(spell));
  }

  function normalizePreparationType(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes("hybrid")) return "hybrid";
    if (normalized.includes("spont")) return "spontaneous";
    if (normalized.includes("prep")) return "prepared";
    if (normalized === "prepared") return "prepared";
    if (normalized === "spontaneous") return "spontaneous";
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
          if (keyText === "type" || keyText === "mode") {
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
    const packs = Array.from(game.packs ?? []);

    const exactMatch = packs.find((pack) => {
      const packLabel = String(pack.metadata?.label || pack.title || pack.collection || "").trim().toLowerCase();
      const packFolder = String(getCompendiumFolderName(pack) || "").trim().toLowerCase();
      return packLabel === normalizedLabel && (!normalizedFolder || packFolder === normalizedFolder);
    });
    if (exactMatch) return exactMatch;

    const folderMatch = packs.find((pack) => {
      const packLabel = String(pack.metadata?.label || pack.title || pack.collection || "").trim().toLowerCase();
      const packFolder = String(getCompendiumFolderName(pack) || "").trim().toLowerCase();
      return packLabel.includes(normalizedLabel) && (!normalizedFolder || packFolder === normalizedFolder);
    });
    if (folderMatch) return folderMatch;

    return packs.find((pack) => {
      const packLabel = String(pack.metadata?.label || pack.title || pack.collection || "").trim().toLowerCase();
      return packLabel === normalizedLabel || packLabel.includes(normalizedLabel);
    }) || null;
  }

  function getModuleSpellPack() {
    return game.packs?.get("darkfinder.spell-cores-augments") || null;
  }

  async function loadPreparedSpellData() {
    if (preparedSpellDataCache) return preparedSpellDataCache;

    const spellPack = getModuleSpellPack() || findCompendiumPack("Spell Cores/Augments", "Darkfinder");
    if (!spellPack) {
      throw new Error("Could not find a Spell Cores/Augments compendium. Expected darkfinder.spell-cores-augments or a world compendium named 'Spell Cores/Augments'.");
    }

    const documents = await spellPack.getDocuments();
    const cores = [];
    const augments = [];

    for (const item of documents) {
      const folderName = String(getDocumentFolderName(item) || "").trim().toLowerCase();
      if (folderName === "cores") {
        cores.push(item);
        continue;
      }
      if (folderName === "augments") {
        augments.push(item);
        continue;
      }

      if (isAugmentSpell(item)) {
        augments.push(item);
      } else {
        cores.push(item);
      }
    }

    const sortedCores = sortItemsByDisplayName(cores);
    const sortedAugments = sortItemsByDisplayName(augments);
    preparedSpellDataCache = {
      cores: sortedCores,
      augments: sortedAugments,
      coreIndex: new Map(sortedCores.map((item) => [normalizeSpellReferenceName(item.name), item])),
      augmentIndex: new Map(sortedAugments.map((item) => [normalizeSpellReferenceName(item.name), item])),
    };
    return preparedSpellDataCache;
  }

  async function loadLegacyPreparedCoreData() {
    if (legacyPreparedCoreDataCache) return legacyPreparedCoreDataCache;

    const spellPack = findCompendiumPack("Spells");
    if (!spellPack) {
      throw new Error("Could not find the Pathfinder 'Spells' compendium.");
    }

    const spells = await spellPack.getDocuments();
    const sortedSpells = sortItemsByDisplayName(spells);
    legacyPreparedCoreDataCache = {
      cores: sortedSpells,
      coreIndex: new Map(sortedSpells.map((item) => [normalizeSpellReferenceName(item.name), item])),
    };
    return legacyPreparedCoreDataCache;
  }

  function normalizeLegacyCasterText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\bspellbook\b/g, " ")
      .replace(/[^a-z0-9/+&,\-()\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildLegacyCasterNameVariants(value) {
    const normalized = normalizeLegacyCasterText(value);
    if (!normalized) return [];

    const variants = new Set([normalized]);
    const separators = /\s*(?:\/|,|&|\band\b|\bor\b|\(|\)|-)\s*/i;
    normalized
      .split(separators)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => variants.add(part));

    return Array.from(variants);
  }

  function collectLegacyCasterNamesFromValue(value, names) {
    if (value == null || value === "") return;
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) names.add(text);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (Array.isArray(entry)) {
          collectLegacyCasterNamesFromValue(entry[0], names);
          continue;
        }
        if (entry && typeof entry === "object") {
          collectLegacyCasterNamesFromValue(entry.class || entry.name || entry.tag || entry.value || entry[0], names);
          continue;
        }
        collectLegacyCasterNamesFromValue(entry, names);
      }
      return;
    }
    if (typeof value === "object") {
      const objectValues = Object.values(value);
      const hasStructuredValues = objectValues.some((entry) => Array.isArray(entry) || (entry && typeof entry === "object"));
      if (!hasStructuredValues) {
        for (const key of Object.keys(value)) {
          if (key) names.add(key);
        }
      }
      for (const [key, entry] of Object.entries(value)) {
        if (entry && typeof entry === "object" && ("class" in entry || "name" in entry || "tag" in entry || "value" in entry)) {
          collectLegacyCasterNamesFromValue(entry.class || entry.name || entry.tag || entry.value, names);
          continue;
        }
        if (Array.isArray(entry) || (entry && typeof entry === "object")) {
          collectLegacyCasterNamesFromValue(entry, names);
          continue;
        }
        if (key && typeof entry !== "string") names.add(key);
      }
    }
  }

  function parseLegacySpellLevelValue(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
    }
    if (typeof value === "string") {
      const match = value.trim().match(/^\d+/);
      if (!match) return null;
      const numeric = Number(match[0]);
      return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const parsed = parseLegacySpellLevelValue(entry);
        if (parsed != null) return parsed;
      }
      return null;
    }
    if (typeof value === "object") {
      const explicitLevel = parseLegacySpellLevelValue(
        value.level
        ?? value.lvl
        ?? value.spellLevel
        ?? value.value,
      );
      if (explicitLevel != null) return explicitLevel;
    }
    return null;
  }

  function pushLegacyCastingEntry(entries, name, level) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) return;
    entries.push({
      name: normalizedName,
      level: level == null ? null : Math.max(0, Math.floor(Number(level) || 0)),
    });
  }

  function collectLegacyCastingEntriesFromValue(value, entries, fallbackName = "") {
    if (value == null || value === "") return;

    if (typeof value === "number") {
      if (fallbackName) pushLegacyCastingEntry(entries, fallbackName, value);
      return;
    }

    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return;
      const parsedLevel = parseLegacySpellLevelValue(text);
      if (fallbackName && parsedLevel != null) {
        pushLegacyCastingEntry(entries, fallbackName, parsedLevel);
      } else if (parsedLevel == null) {
        pushLegacyCastingEntry(entries, text, null);
      }
      return;
    }

    if (Array.isArray(value)) {
      if (fallbackName) {
        const parsedLevel = parseLegacySpellLevelValue(value);
        if (parsedLevel != null) {
          pushLegacyCastingEntry(entries, fallbackName, parsedLevel);
          return;
        }
      }

      for (const entry of value) {
        if (Array.isArray(entry)) {
          const candidateName = entry.find((part) => typeof part === "string" && parseLegacySpellLevelValue(part) == null);
          const candidateLevel = entry.find((part) => parseLegacySpellLevelValue(part) != null);
          if (candidateName && candidateLevel != null) {
            pushLegacyCastingEntry(entries, candidateName, parseLegacySpellLevelValue(candidateLevel));
            continue;
          }
        }
        collectLegacyCastingEntriesFromValue(entry, entries, fallbackName);
      }
      return;
    }

    if (typeof value !== "object") return;

    const explicitName = value.class || value.name || value.tag || value.label || value.key || fallbackName;
    const explicitLevel = parseLegacySpellLevelValue(
      value.level
      ?? value.lvl
      ?? value.spellLevel
      ?? value.value,
    );
    if (explicitName && explicitLevel != null) {
      pushLegacyCastingEntry(entries, explicitName, explicitLevel);
      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      if (entry == null || entry === "") continue;
      if (typeof entry === "number") {
        pushLegacyCastingEntry(entries, key, entry);
        continue;
      }
      if (typeof entry === "string") {
        const level = parseLegacySpellLevelValue(entry);
        if (level != null) {
          pushLegacyCastingEntry(entries, key, level);
        } else {
          pushLegacyCastingEntry(entries, entry, null);
        }
        continue;
      }
      collectLegacyCastingEntriesFromValue(entry, entries, key);
    }
  }

  function getLegacySpellCastingEntries(spell) {
    const entries = [];
    const learnedAtSources = [
      getObjectPath(spell, ["system", "learnedAt", "class"]),
      getObjectPath(spell, ["system", "learnedAt", "classes"]),
      getObjectPath(spell, ["system", "learnedAt"]),
      getObjectPath(spell, ["data", "learnedAt", "class"]),
      getObjectPath(spell, ["data", "learnedAt", "classes"]),
      getObjectPath(spell, ["data", "learnedAt"]),
      getObjectPath(spell, ["data", "data", "learnedAt", "class"]),
      getObjectPath(spell, ["data", "data", "learnedAt", "classes"]),
      getObjectPath(spell, ["data", "data", "learnedAt"]),
    ];

    for (const source of learnedAtSources) {
      collectLegacyCastingEntriesFromValue(source, entries);
    }

    const deduped = new Map();
    for (const entry of entries) {
      const normalizedName = normalizeLegacyCasterText(entry.name);
      if (!normalizedName) continue;
      const existing = deduped.get(normalizedName);
      if (!existing) {
        deduped.set(normalizedName, { name: entry.name, level: entry.level });
        continue;
      }
      if (existing.level == null && entry.level != null) {
        existing.level = entry.level;
        continue;
      }
      if (existing.level != null && entry.level != null) {
        existing.level = Math.min(existing.level, entry.level);
      }
    }

    return Array.from(deduped.values());
  }

  function getLegacySpellCasterClassNames(spell) {
    const entryNames = getLegacySpellCastingEntries(spell).map((entry) => entry.name).filter(Boolean);
    if (entryNames.length) return entryNames;

    const names = new Set();
    const learnedAtSources = [
      getObjectPath(spell, ["system", "learnedAt", "class"]),
      getObjectPath(spell, ["system", "learnedAt", "classes"]),
      getObjectPath(spell, ["system", "learnedAt"]),
      getObjectPath(spell, ["data", "learnedAt", "class"]),
      getObjectPath(spell, ["data", "learnedAt", "classes"]),
      getObjectPath(spell, ["data", "learnedAt"]),
      getObjectPath(spell, ["data", "data", "learnedAt", "class"]),
      getObjectPath(spell, ["data", "data", "learnedAt", "classes"]),
      getObjectPath(spell, ["data", "data", "learnedAt"]),
    ];

    for (const source of learnedAtSources) {
      collectLegacyCasterNamesFromValue(source, names);
    }

    return Array.from(names).filter(Boolean);
  }

  function getSelectedSpellbookDisplayName(actor, spellbookId, spellbooks) {
    return spellbooks.find((book) => String(book?.id) === String(spellbookId))?.name
      || getSpellbookNameFromAttributes(actor, spellbookId)
      || String(spellbookId || "");
  }

  function doesLegacySpellMatchSpellbookName(spell, spellbookName) {
    const spellbookVariants = buildLegacyCasterNameVariants(spellbookName);
    if (!spellbookVariants.length) return true;

    const classNames = getLegacySpellCasterClassNames(spell);
    if (!classNames.length) return true;

    const classVariants = classNames.flatMap((name) => buildLegacyCasterNameVariants(name));
    return spellbookVariants.some((bookName) => (
      classVariants.some((className) => (
        className === bookName
        || className.includes(bookName)
        || bookName.includes(className)
      ))
    ));
  }

  function getLegacySpellLevelForSpellbookName(spell, spellbookName) {
    const spellbookVariants = buildLegacyCasterNameVariants(spellbookName);
    if (!spellbookVariants.length) return null;

    const matchingLevels = [];
    for (const entry of getLegacySpellCastingEntries(spell)) {
      if (entry.level == null) continue;
      const classVariants = buildLegacyCasterNameVariants(entry.name);
      const isMatch = spellbookVariants.some((bookName) => (
        classVariants.some((className) => (
          className === bookName
          || className.includes(bookName)
          || bookName.includes(className)
        ))
      ));
      if (isMatch) matchingLevels.push(entry.level);
    }

    if (!matchingLevels.length) return null;
    return Math.min(...matchingLevels);
  }

  function getLegacySpellLevelForState(spell, state) {
    if (!spell || !state?.spellbookId) return null;
    const spellbookName = getSelectedSpellbookDisplayName(actor, state.spellbookId, spellbooks);
    return getLegacySpellLevelForSpellbookName(spell, spellbookName);
  }

  async function ensureSpellDataLoaded(actor, state) {
    if (!state.hasSanitizedSpellItems) {
      try {
        await sanitizeActorSpellbookReferences(actor, spellbooks);
        await repairActorSpellActionArrays(actor);
      } catch (err) {
        console.warn("Spellcrafting macro could not sanitize actor spell items.", err);
      }
      state.hasSanitizedSpellItems = true;
    }

    state.preparationMode = getSpellbookPreparationType(actor, state.spellbookId);
    const normalizedPreparationMode = state.preparationMode || "spontaneous";
    const cacheKey = JSON.stringify({
      spellbookId: String(state.spellbookId || ""),
      preparationMode: normalizedPreparationMode,
      useLegacyPreparedCores: normalizedPreparationMode === "prepared" ? !!state.useLegacyPreparedCores : false,
      classOnlyLegacyPreparedCores: normalizedPreparationMode === "prepared" && state.useLegacyPreparedCores
        ? !!state.classOnlyLegacyPreparedCores
        : false,
    });

    if (!state.spellbookId) {
      clearLoadedSpellData(state);
      return;
    }

    if (state.preparationMode === "hybrid") {
      if (state.warnedHybridSpellbookId !== state.spellbookId) {
        ui.notifications.error("This Hybrid caster needs to choose Prepared or Spontaneous on the spellbook before using Spellcrafting.");
        state.warnedHybridSpellbookId = state.spellbookId;
      }
      clearLoadedSpellData(state, cacheKey);
      return;
    }

    state.warnedHybridSpellbookId = null;

    if (state.spellDataCacheKey === cacheKey && Object.keys(state.itemLookup || {}).length) {
      return;
    }

    if (state.preparationMode === "prepared") {
      try {
        if (state.useLegacyPreparedCores) {
          const legacyPreparedData = await loadLegacyPreparedCoreData();
          const preparedData = await loadPreparedSpellData();
          const spellbookName = getSelectedSpellbookDisplayName(actor, state.spellbookId, spellbooks);
          setLoadedSpellData(
            state,
            cacheKey,
            state.classOnlyLegacyPreparedCores
              ? legacyPreparedData.cores.filter((item) => doesLegacySpellMatchSpellbookName(item, spellbookName))
              : legacyPreparedData.cores,
            preparedData.augments.filter((item) => isAugmentSpell(item)),
          );
        } else {
          const preparedData = await loadPreparedSpellData();
          setLoadedSpellData(
            state,
            cacheKey,
            preparedData.cores.filter((item) => isCoreSpell(item)),
            preparedData.augments.filter((item) => isAugmentSpell(item)),
          );
        }
      } catch (err) {
        console.warn("Spellcrafting macro could not load prepared spell data.", err);
        clearLoadedSpellData(state);
        ui.notifications.error(err?.message || "Prepared spell data could not be loaded from the configured compendiums.");
      }
      return;
    }

    state.preparationMode = "spontaneous";

    try {
      const preparedData = await loadPreparedSpellData();
      const actorCores = getCoreSpells(actor, state.spellbookId);
      const actorAugments = getAugmentItems(actor, state.spellbookId);
      setLoadedSpellData(
        state,
        cacheKey,
        mapSpontaneousItemsToBestSource(actorCores, preparedData.coreIndex),
        mapSpontaneousItemsToBestSource(actorAugments, preparedData.augmentIndex),
      );
      return;
    } catch (err) {
      console.warn("Spellcrafting macro could not map spontaneous spell items to compendium data.", err);
    }

    clearLoadedSpellData(state, cacheKey);
    loadLegacySpontaneousSpellData(actor, state.spellbookId, state);
    state.spellDataCacheKey = cacheKey;
  }

  function getSpellType(item) {
    const name = String(item?.name || "");
    if (/\(augment\)\s*$/i.test(name) || /\baugment\s*$/i.test(name) || /\(augment\)/i.test(name) || /\baugment\b/i.test(name)) {
      return "augment";
    }
    const description = getSpellDescription(item);
    const descriptionType = parseDescriptionType(description);
    if (descriptionType === "augment") return "augment";
    return "core";
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
    const match = plaintext.match(/Type:\s*([^\n\r]+)/i);
    return match?.[1]?.trim()?.toLowerCase?.() || null;
  }

  function parseSPCost(description) {
    if (!description) return 0;
    const match = description.match(/SP Cost:\s*(\d+)/i);
    return match ? Number(match[1]) : 0;
  }

  function getSpellPointCostFromSpellLevel(item) {
    if (!isCoreSpell(item)) return 0;
    const spellLevel = Math.max(0, getSpellLevelValue(item));
    return spellLevel > 0 ? (spellLevel * 2) - 1 : 0;
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

  function findNumericFieldByKeyPatterns(object, patterns) {
    if (!object || typeof object !== "object") return null;
    for (const [key, value] of Object.entries(object)) {
      if (patterns.some((pattern) => pattern.test(key))) {
        const numeric = Number(value);
        if (!Number.isNaN(numeric)) return numeric;
      }
      if (value && typeof value === "object") {
        const nested = findNumericFieldByKeyPatterns(value, patterns);
        if (nested != null) return nested;
      }
    }
    return null;
  }

  function getSpellDescription(item) {
    return item?.system?.description?.value || item?.data?.description || item?.data?.data?.description?.value || item?.data?.system?.description?.value || "";
  }

  function normalizeDisplayedSpellText(value) {
    const protectedMatches = [];
    const protect = (match) => {
      const token = `__SPELLCRAFTING_PROTECTED_${protectedMatches.length}__`;
      protectedMatches.push({ token, match });
      return token;
    };

    let normalized = String(value || "")
      .replace(/\bthis(?=\s+(?:ranged|melee)\s+touch\s+attacks?\b)/gi, "these")
      .replace(/\b(?:a\s+)?(?:ranged|melee)\s+touch\s+attacks?\b/gi, "vibes")
      .replace(/@cl/gi, "SP spent")
      .replace(/caster level checks?\b/gi, protect)
      .replace(/negative levels?\b/gi, protect)
      .replace(/lost levels?\b/gi, protect)
      .replace(/caster levels?\s+you\s+possess\b/gi, "SP spent")
      .replace(/levels?\s+you\s+possess\b/gi, "SP spent")
      .replace(/caster levels/gi, "SP spent")
      .replace(/caster level(?!\s+checks?\b)/gi, "SP spent")
      .replace(/\/levels\b/gi, "/SP spent")
      .replace(/\/level\b/gi, "/SP spent")
      .replace(/\blevels\b/gi, "SP spent")
      .replace(/\blevel\b/gi, "SP spent");

    for (const { token, match } of protectedMatches) {
      normalized = normalized.replace(token, match);
    }

    return normalized;
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
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function stripHtmlTagsPreservingLinks(html) {
    if (!html) return "";
    const withLinkMarkup = String(html).replace(
      /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, _quote, url, labelHtml) => `[${stripHtmlTags(labelHtml)}](${String(url || "").trim()})`,
    );
    return stripHtmlTags(withLinkMarkup);
  }

  function renderInlineSpellMarkup(text) {
    const source = String(text || "");
    const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let cursor = 0;
    let rendered = "";

    for (const match of source.matchAll(linkPattern)) {
      const [fullMatch, label, url] = match;
      const start = match.index ?? 0;
      rendered += escapeHtml(source.slice(cursor, start));
      rendered += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
      cursor = start + fullMatch.length;
    }

    rendered += escapeHtml(source.slice(cursor));
    return rendered;
  }

  function removeCoreAugmentsSection(text) {
    return String(text || "")
      .replace(/(?:^|\n)\s*Core Augments?:[\s\S]*$/i, "")
      .trim();
  }

  function getCoreDescriptionWithoutAugments(core) {
    const plaintext = stripHtmlTags(getSpellDescription(core));
    return normalizeDisplayedSpellText(removeCoreAugmentsSection(plaintext));
  }

  function descriptionHasStructuredSpellAttributes(description) {
    const text = stripHtmlTags(description);
    if (!text) return false;
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
    const matchCount = attributePatterns.filter((pattern) => pattern.test(text)).length;
    return matchCount >= 4;
  }

  function getCoreHoverSpellPointCost(core, state) {
    if (state?.preparationMode === "prepared" && state?.useLegacyPreparedCores) {
      const spellLevel = Math.max(0, getLegacySpellLevelForState(core, state) ?? getSpellLevelValue(core));
      return spellLevel > 0 ? (spellLevel * 2) - 1 : 0;
    }
    return getSpellPointCost(core);
  }

  function buildCoreHoverDescription(core, state) {
    const hoverSpellPointCost = getCoreHoverSpellPointCost(core, state);
    const rawDescription = normalizeDisplayedSpellText(stripHtmlTags(getSpellDescription(core)));
    if (descriptionHasStructuredSpellAttributes(rawDescription)) {
      return rawDescription.replace(
        /((?:^|\n)\s*Duration:\s*)([^\n\r]+)/i,
        (_, prefix, durationValue) => `${prefix}${normalizeSpellAttributeDuration(durationValue, hoverSpellPointCost) || durationValue}`,
      );
    }

    const lines = [
      getDisplaySpellName(core?.name || "") || "Unnamed Core",
      "Type: Core",
      `SP Cost: ${hoverSpellPointCost}`,
      `School: ${getSpellSchool(core) || "None"}`,
      `Casting Time: ${getSpellCastingTime(core) || "None"}`,
      `Range: ${getSpellRange(core) || "None"}`,
      `Target: ${getSpellTarget(core) || "None"}`,
      `Duration: ${normalizeSpellAttributeDuration(getSpellDuration(core) || "None", hoverSpellPointCost) || "None"}`,
      `Saving Throw: ${getSpellSavingThrow(core) || "None"}`,
      "Description:",
      rawDescription || "None",
    ];

    return normalizeDisplayedSpellText(lines.join("\n"));
  }

  function parseSpellDescriptionAttributes(core) {
    const text = getCoreDescriptionWithoutAugments(core);
    if (!text) return {};

    const descriptionIndex = text.search(/(?:^|\n)\s*Description:\s*/i);
    const attributeText = descriptionIndex >= 0 ? text.slice(0, descriptionIndex).trim() : text;
    const attributes = {};
    const patterns = {
      name: /(?:^|\n)\s*Name:\s*([^\n\r]+)/i,
      spCost: /(?:^|\n)\s*SP Cost:\s*([^\n\r]+)/i,
      school: /(?:^|\n)\s*School:\s*([^\n\r]+)/i,
      castingTime: /(?:^|\n)\s*Casting Time:\s*([^\n\r]+)/i,
      range: /(?:^|\n)\s*Range:\s*([^\n\r]+)/i,
      target: /(?:^|\n)\s*Target:\s*([^\n\r]+)/i,
      duration: /(?:^|\n)\s*Duration:\s*([^\n\r]+)/i,
      savingThrow: /(?:^|\n)\s*Saving Throw:\s*([^\n\r]+)/i,
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const match = attributeText.match(pattern);
      const value = match?.[1]?.trim();
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
    if (!description) return "";
    const plaintext = stripHtmlTags(description);
    const match = plaintext.match(/(?:^|\n)\s*Limitation:\s*([^\n\r]+)/i);
    return match?.[1] ? normalizeDisplayedSpellText(match[1].trim()) : "";
  }

  function getSpellbookOptionHtml(book, selectedId) {
    const selected = book.id === selectedId ? "selected" : "";
    return `<option value="${book.id}" ${selected}>${escapeHtml(book.name)}</option>`;
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

  function getSpellAttributeValue(item, searchPaths, keyPatterns) {
    for (const path of searchPaths || []) {
      const value = getObjectPath(item, path);
      const normalized = normalizeAttributeValue(value);
      if (normalized) return normalizeDisplayedSpellText(normalized);
    }
    const recursiveValue = findFieldByKeyPatterns(item, keyPatterns || []);
    return normalizeDisplayedSpellText(normalizeAttributeValue(recursiveValue) || "None");
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
    if (!typeLabel) {
      return normalizedCost == null ? "" : String(cost).trim();
    }

    if (normalizedCost == null || Number.isNaN(normalizedCost)) return typeLabel;
    if (normalizedCost === 1 && ["standard", "move", "swift", "immediate", "free", "full"].includes(normalizedType)) {
      return typeLabel;
    }
    if (normalizedCost === 1) return `1 ${typeLabel}`;
    return `${normalizedCost} ${typeLabel}s`;
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

  function formatDurationDisplay(durationData) {
    if (durationData == null || durationData === "") return "";
    if (typeof durationData === "string" || typeof durationData === "number") {
      return String(durationData).trim();
    }
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

  function normalizeSpellAttributeDuration(durationText, totalSP) {
    const rawDuration = normalizeDisplayedSpellText(String(durationText || "").trim());
    if (!rawDuration) return rawDuration;

    const normalizedDuration = rawDuration.toLowerCase();
    const hasVariableRounds = /\brounds?\b/.test(normalizedDuration)
      && (
        /@cl|sp spent|\/level\b|per level\b|\/cl\b|caster level\b|level-dependent\b/.test(normalizedDuration)
        || /(?:^|[^\d])level(?:[^\w]|$)/.test(normalizedDuration)
      );

    if (hasVariableRounds) return "Combat";
    if (/^(?!1\b)(?:\d+|SP spent)\s+round$/i.test(rawDuration)) {
      return rawDuration.replace(/\bround$/i, "rounds");
    }
    if (/\bminutes?\b/i.test(rawDuration) || /\bhours?\b/i.test(rawDuration)) {
      return "Concentration";
    }
    if (/\bdays?\b/i.test(rawDuration)) {
      return "All Day";
    }
    if (/^(?!1\b)(?:\d+|SP spent)\s+round$/i.test(rawDuration)) {
      return rawDuration.replace(/\bround$/i, "rounds");
    }
    return rawDuration;
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
      return { value: "Concentration", units: "spec", concentration: true, dismiss: false };
    }

    const dismiss = /\(d\)\s*$/i.test(normalized);
    const withoutDismiss = normalized.replace(/\s*\(d\)\s*$/i, "").trim();
    const match = withoutDismiss.match(/^(\d+)\s+(round|rounds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)$/i);
    if (match) {
      const [, value, units] = match;
      return {
        value,
        units: units.toLowerCase(),
        concentration: false,
        dismiss,
      };
    }

    return {
      value: withoutDismiss || "None",
      units: "spec",
      concentration: false,
      dismiss,
    };
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

  function actionHasAttackRoll(action) {
    if (!action || typeof action !== "object") return false;

    const actionType = String(action.actionType || "").trim().toLowerCase();
    if (["attack", "mattack", "rattack", "msak", "rsak"].includes(actionType)) return true;

    const attackFields = [
      action.attackBonus,
      action.attackName,
      getObjectPath(action, ["formula"]),
      getObjectPath(action, ["attack", "formula"]),
      getObjectPath(action, ["attack", "bonus"]),
    ];
    if (attackFields.some((value) => String(value || "").trim() !== "")) return true;

    return getObjectPath(action, ["touch"]) === true
      || getObjectPath(action, ["ability", "attack"]) != null && String(getObjectPath(action, ["ability", "attack"]) || "").trim() !== ""
      || getObjectPath(action, ["bab"]) != null && String(getObjectPath(action, ["bab"]) || "").trim() !== "";
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

  function floorHalf(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return 0;
    return Math.floor(numeric / 2);
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
    if (genericEntryBonus) {
      terms.push({ bonus: genericEntryBonus, label: "Spell DC" });
    }

    const genericActorBonus = getGenericSpellDcBonusFromActor(actor);
    if (genericActorBonus) {
      terms.push({ bonus: genericActorBonus, label: "Spell DC" });
    }

    const genericItemBonus = getGenericSpellDcBonusFromItems(actor);
    if (genericItemBonus) {
      terms.push({ bonus: genericItemBonus, label: "Spell DC" });
    }

    if (schoolKey) {
      const entryBonus = getSchoolSpecificSpellDcBonusFromEntry(spellbookEntry, schoolKey);
      if (entryBonus) {
        terms.push({ bonus: entryBonus, label: `${getSpellSchoolDisplayName(schoolKey)} Spell DC` });
      }

      const actorBonus = getSchoolSpecificSpellDcBonusFromActor(actor, schoolKey);
      if (actorBonus) {
        terms.push({ bonus: actorBonus, label: `${getSpellSchoolDisplayName(schoolKey)} Spell DC` });
      }

      const itemBonus = getSchoolSpecificSpellDcBonusFromItems(actor, schoolKey);
      if (itemBonus) {
        terms.push({ bonus: itemBonus, label: `${getSpellSchoolDisplayName(schoolKey)} Spell DC` });
      }
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
    return {
      casterLevel,
      casterLevelHalf,
      abilityMod,
      abilityLabel,
      dcBonusTerms,
      dcBonusTotal,
      totalBonus: casterLevelHalf + abilityMod + dcBonusTotal,
      formulaText: `1d20 + ${casterLevelHalf} + ${abilityMod}${dcBonusTotal ? ` + ${dcBonusTotal}` : ""}`,
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
    const macro = getSpellAttackMacro();
    if (!macro?.uuid) {
      return `
        <div class="spellcrafting-spell-attack-row" style="margin:0.05rem 0 0.95rem;">
          <span
            class="spellcrafting-spell-attack-button"
            title="The Spell Attack macro could not be found."
            aria-disabled="true"
            style="display:inline-flex;align-items:center;justify-content:center;padding:0.56rem 1rem;border:1px solid #8f8674;border-radius:5px;background:linear-gradient(to bottom, #cfc5ac, #b4aa90);color:#574d3c;font-weight:700;font-size:1.15rem;line-height:1;cursor:not-allowed;text-decoration:none;opacity:0.8;"
          >Spell Attack</span>
        </div>
      `;
    }
    return `
      <div class="spellcrafting-spell-attack-row" style="margin:0.05rem 0 0.95rem;">
        <a
          class="content-link spellcrafting-spell-attack-button"
          draggable="true"
          data-link
          data-type="Macro"
          data-uuid="${escapeHtml(macro.uuid)}"
          data-id="${escapeHtml(String(macro.id || ""))}"
          data-spellcrafting-spell-attack="true"
          data-actor-uuid="${escapeHtml(actor.uuid || "")}"
          data-spellbook-id="${escapeHtml(String(spellbookId || ""))}"
          data-spell-school="${escapeHtml(getSpellSchool(core) || "")}"
          data-saving-throw="${escapeHtml(savingThrow)}"
          data-spell-name="${escapeHtml(spellName || getDisplaySpellName(core?.name || ""))}"
          style="display:inline-flex;align-items:center;justify-content:center;padding:0.56rem 1rem;border:1px solid #8f8674;border-radius:5px;background:linear-gradient(to bottom, #ddd4b8, #c9bea0);color:#1c1914;font-weight:700;font-size:1.15rem;line-height:1;cursor:pointer;text-decoration:none;"
        ><i class="fas fa-bolt" style="margin-right:0.45rem;"></i>Spell Attack</a>
      </div>
    `;
  }

  function getSpellAttackMacro() {
    return game.macros?.find((macro) => String(macro?.name || "").trim().toLowerCase() === "spell attack") || null;
  }

  function getSelectedCoreBaseSP(actor, state) {
    const core = getActiveItemById(state, state.selectedCoreId);
    if (!core) return 0;
    if (state.preparationMode === "prepared" && state.useLegacyPreparedCores) {
      const spellLevel = Math.max(0, getLegacySpellLevelForState(core, state) ?? getSpellLevelValue(core));
      return spellLevel > 0 ? (spellLevel * 2) - 1 : 0;
    }
    return getSpellPointCost(core);
  }

  function getDisplaySpellName(name) {
    return String(name || "")
      .replace(/\s*\((?:core|augment)\)\s*/gi, " ")
      .replace(/\b(?:core|augment)\b\s*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function buildPreparedAttributeText(core, totalSP, resolvedAttributesOverride = null) {
    const resolvedAttributes = resolvedAttributesOverride || getResolvedSpellAttributes(core, totalSP);
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

  function getResolvedSpellAttributes(core, totalSP) {
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

  function applyMechanicalAugmentOverrides(resolvedAttributes, augmentDetails) {
    if (!resolvedAttributes || !Array.isArray(augmentDetails)) return resolvedAttributes;

    const isDurationAugment = (detail) => {
      const title = String(detail?.augment?.title || "").trim().replace(/\s*\([^)]+\)\s*$/, "").trim();
      const itemName = getDisplaySpellName(detail?.item?.name || "");
      return /^duration$/i.test(title) || /^duration$/i.test(itemName);
    };

    const applyDurationAugmentOverride = (currentDuration, detail) => {
      if (!isDurationAugment(detail)) return currentDuration;

      const durationText = String(currentDuration || "").trim() || "None";
      const text = normalizeDisplayedSpellText(`${detail?.augment?.title || ""} ${detail?.augment?.description || ""}`).toLowerCase();
      const hasPhrase = (pattern) => pattern.test(text);

      if (hasPhrase(/\bfrom\s+["']?concentration["']?\s+to\s+["']?combat["']?(?=$|[\s.,;:!?])/i)) {
        return /^concentration$/i.test(durationText) ? "Combat" : durationText;
      }
      if (hasPhrase(/\bfrom\s+non-["']?concentration["']?\s+to\s+["']?combat["']?(?=$|[\s.,;:!?])/i)) {
        return /^concentration$/i.test(durationText) ? durationText : "Combat";
      }
      if (hasPhrase(/\bfrom\s+["']?combat["']?\s+to\s+["']?concentration["']?(?=$|[\s.,;:!?])/i)) {
        return /^combat$/i.test(durationText) ? "Concentration" : durationText;
      }
      if (hasPhrase(/\bfrom\s+non-["']?instantaneous["']?\s+to\s+["']?concentration["']?(?=$|[\s.,;:!?])/i)) {
        return /^instantaneous$/i.test(durationText) ? durationText : "Concentration";
      }
      if (hasPhrase(/\bfrom\s+["']?concentration["']?\s+to\s+["']?all day["']?(?=$|[\s.,;:!?])/i)) {
        return /^concentration$/i.test(durationText) ? "All Day" : durationText;
      }

      return durationText;
    };

    let nextDuration = resolvedAttributes.duration;
    for (const detail of augmentDetails) {
      nextDuration = applyDurationAugmentOverride(nextDuration, detail);
    }

    resolvedAttributes.duration = nextDuration;
    return resolvedAttributes;
  }

  function getButtonState(state) {
    const hasSpellbook = !!state.spellbookId;
    const hasCore = !!state.selectedCoreId;
    const canAct = hasSpellbook && hasCore && state.preparationMode !== "hybrid";
    return {
      canCast: canAct && state.preparationMode === "spontaneous",
      canAdd: canAct && state.preparationMode === "prepared",
    };
  }

  function getSignedCostLabel(cost) {
    return `${cost >= 0 ? "+" : ""}${cost}`;
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
      const description = getSpellDescription(item);
      const parsed = parseAugmentLines(description, type === "core" ? /Core Augments?:/i : /Augment|Description:/i);
      const augment = parsed[entryIndex];
      if (!augment) continue;
      const count = Math.max(1, collection[key].count || 1);
      entries.push({ item, augment, count, type, key });
    }
    return entries;
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
    const titleText = isCostOnlyTitle ? "" : `${baseTitle}: `;
    return normalizeDisplayedSpellText(`${titleText}${detail.augment.description}`).trim();
  }

  function buildAppliedAugmentHtml(details) {
    if (!details.length) {
      return `
        <div class="spellcrafting-chat-augment-block" style="display:block;">
          <strong>Applied Augments:</strong><br>
          <span>None</span>
        </div>
      `;
    }

    const lines = details.map((detail) => {
      const costText = escapeHtml(formatAppliedAugmentLabel(detail));
      const descriptionText = escapeHtml(getAppliedAugmentDisplayText(detail));
      return `
        <div class="spellcrafting-chat-augment-row" style="display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:start;column-gap:0.5rem;">
          <span class="spellcrafting-chat-augment-cost" style="white-space:nowrap;font-weight:700;">${costText}</span>
          <span class="spellcrafting-chat-augment-text" style="min-width:0;overflow-wrap:anywhere;">${descriptionText}</span>
        </div>
      `;
    }).join("");

    return `
      <div class="spellcrafting-chat-augment-block" style="display:block;">
        <strong>Applied Augments:</strong>
        <div class="spellcrafting-chat-augment-list" style="display:grid;gap:0.35rem;margin-top:0.35rem;">${lines}</div>
      </div>
    `;
  }

  function buildCastDescriptionText(core) {
    const rawDescription = stripHtmlTagsPreservingLinks(getSpellDescription(core));
    let trimmed = normalizeDisplayedSpellText(removeCoreAugmentsSection(rawDescription));
    const descriptionMatch = trimmed.match(/(?:^|\n)\s*Description:\s*/i);
    if (descriptionMatch) {
      const start = (descriptionMatch.index || 0) + descriptionMatch[0].length;
      return removeCoreAugmentsSection(trimmed.slice(start));
    }

    const strippedLines = trimmed
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^(Name|SP Cost|School|Casting Time|Range|Target|Duration|Saving Throw)\s*:/i.test(line));
    return removeCoreAugmentsSection(strippedLines.join("\n"));
  }

  function buildPreparedSpellDescriptionHtml(actor, spellbookId, core, totalSP, details, spellName, options = {}) {
    const resolvedAttributes = options.resolvedAttributes || applyMechanicalAugmentOverrides(getResolvedSpellAttributes(core, totalSP), details);
    const attributeText = buildPreparedAttributeText(core, totalSP, resolvedAttributes);
    const descriptionBody = buildCastDescriptionText(core);
    const spellAttackButtonHtml = options.includeSpellAttackButton === false
      ? ""
      : buildSpellAttackButtonHtml(actor, spellbookId, core, spellName || resolvedAttributes.name, resolvedAttributes.savingThrow);
    const spellAttackSpacerHtml = spellAttackButtonHtml ? spellAttackButtonHtml : `<div class="spellcrafting-spell-attack-spacer" style="height:0.45rem;"></div>`;
    const appliedAugmentsHtml = buildAppliedAugmentHtml(details);
    const attributeHtml = attributeText.replace(/\n/g, "<br>");
    const descriptionHtml = descriptionBody
      ? `<strong>Description:</strong><br>${renderInlineSpellMarkup(descriptionBody).replace(/\n/g, "<br>")}`
      : "";

    return `
      <div class="spellcrafting-prepared-description">
        <strong>${escapeHtml(resolvedAttributes.name)}</strong>
        <br>
        ${attributeHtml}
        ${spellAttackSpacerHtml}
        ${appliedAugmentsHtml}
        ${descriptionHtml ? `<br>${descriptionHtml}` : ""}
      </div>
    `;
  }

  function buildLegacySpellPreviewHtml(actor, state) {
    const core = getActiveItemById(state, state.selectedCoreId);
    if (!core) {
      return "<div class=\"spellcrafting-empty\">Select a legacy spell to preview the generated description.</div>";
    }

    const totalSP = calculateTotalSP(actor, state);
    const details = getSelectedAugmentDetails(actor, state, "spell");
    const resolvedAttributes = applyMechanicalAugmentOverrides(getResolvedSpellAttributes(core, totalSP), details);
    return buildPreparedSpellDescriptionHtml(
      actor,
      state.spellbookId,
      core,
      totalSP,
      details,
      resolvedAttributes.name,
      { includeSpellAttackButton: false },
    );
  }

  function buildSpellItemData(actor, state, options = {}) {
    const core = getActiveItemById(state, state.selectedCoreId);
    if (!core) {
      throw new Error("Select a Core before building a spell.");
    }

    const totalSP = calculateTotalSP(actor, state);
    const augmentDetails = [
      ...getSelectedAugmentDetails(actor, state, "core"),
      ...getSelectedAugmentDetails(actor, state, "spell"),
    ];
    const canonicalSpellbookKey = getCanonicalSpellbookKey(actor, state.spellbookId, spellbooks);
    if (!canonicalSpellbookKey) {
      throw new Error("The selected spellbook could not be matched to a valid PF1 spellbook entry.");
    }

    const resolvedAttributes = applyMechanicalAugmentOverrides(getResolvedSpellAttributes(core, totalSP), augmentDetails);
    resolvedAttributes.name = String(options.customName || "").trim() || resolvedAttributes.name;
    const spellbookName = spellbooks.find((book) => String(book.id) === String(canonicalSpellbookKey))?.name
      || getSpellbookNameFromAttributes(actor, canonicalSpellbookKey)
      || canonicalSpellbookKey;
    const coreSource = typeof core?.toObject === "function"
      ? core.toObject()
      : (foundry?.utils?.deepClone ? foundry.utils.deepClone(core) : JSON.parse(JSON.stringify(core)));
    const templateSpell = getTemplateSpellItem(actor, canonicalSpellbookKey);
    const templateSource = typeof templateSpell?.toObject === "function"
      ? templateSpell.toObject()
      : (templateSpell
        ? (foundry?.utils?.deepClone ? foundry.utils.deepClone(templateSpell) : JSON.parse(JSON.stringify(templateSpell)))
        : null);
    const sourceHasActions = (data) => {
      const actions = getObjectPath(data, ["system", "actions"]);
      return !!actions && typeof actions === "object" && Object.keys(actions).length > 0;
    };
    const preferTemplateSource = options.preferTemplateSource === true;
    const baseSource = preferTemplateSource
      ? (templateSource || (sourceHasActions(coreSource) ? coreSource : null))
      : (sourceHasActions(coreSource) ? coreSource : templateSource);
    const usingTemplateActionShell = !sourceHasActions(coreSource) && !!templateSource && baseSource === templateSource;
    const itemData = baseSource
      ? (foundry?.utils?.deepClone ? foundry.utils.deepClone(baseSource) : JSON.parse(JSON.stringify(baseSource)))
      : templateSource
      ? (foundry?.utils?.deepClone ? foundry.utils.deepClone(templateSource) : JSON.parse(JSON.stringify(templateSource)))
      : {
          name: resolvedAttributes.name,
          type: "spell",
          img: coreSource?.img || "icons/svg/book.svg",
          system: {
            description: {},
            uses: {},
            spellPoints: {},
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

    itemData.name = resolvedAttributes.name;
    itemData.type = "spell";
    itemData.img = coreSource?.img || itemData.img || "icons/svg/book.svg";
    itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};
    itemData.system = itemData.system && typeof itemData.system === "object" ? itemData.system : {};
    const sourceActionEntries = sourceHasActions(coreSource)
      ? getItemActionEntries(coreSource).map((action) => deepCloneGeneratedData(action))
      : [];
    if (usingTemplateActionShell) {
      stripInheritedTemplateActionRollData(itemData);
    }
    if (core?.uuid) {
      setObjectPathValue(itemData, ["flags", FLAG_SCOPE, "sourceUuid"], String(core.uuid));
    }
    sanitizeGeneratedSpellTemplate(itemData, totalSP);
    ensureGeneratedPrimaryAction(itemData);
    setObjectPathValue(itemData, ["system", "description", "value"], buildPreparedSpellDescriptionHtml(actor, canonicalSpellbookKey, core, totalSP, augmentDetails, resolvedAttributes.name, { resolvedAttributes }));
    populateSpellItemAttributes(itemData, resolvedAttributes, totalSP, sourceActionEntries);
    assignSpellbookReference(actor, itemData, canonicalSpellbookKey, spellbookName);

    return {
      core,
      totalSP,
      augmentDetails,
      canonicalSpellbookKey,
      spellbookName,
      resolvedAttributes,
      itemData,
    };
  }

  async function createSpellChatFromTemporaryItem(actor, itemData) {
    let createdSpell = null;
    try {
      [createdSpell] = await actor.createEmbeddedDocuments("Item", [itemData]);
      if (!createdSpell) {
        throw new Error("Temporary spell item could not be created.");
      }

      const token = canvas.tokens.controlled[0] || actor?.getActiveTokens?.()?.[0] || actor?.token || null;
      const defaultAction = createdSpell.defaultAction || getItemActionEntries(createdSpell)?.[0] || null;
      const actionId = defaultAction?.id || defaultAction?._id || null;

      if (typeof createdSpell.use === "function" && actionId) {
        await createdSpell.use({ actionId, token, skipDialog: true });
        return true;
      }

      if (typeof createdSpell.use === "function") {
        await createdSpell.use({ token, skipDialog: true });
        return true;
      }

      if (defaultAction?.use && typeof defaultAction.use === "function") {
        await defaultAction.use({ token, skipDialog: true });
        return true;
      }

      if (typeof createdSpell.displayCard === "function") {
        console.warn("Spellcrafting macro fell back to displayCard() for spontaneous casting.", {
          actorId: actor?.id || null,
          spellId: createdSpell?.id || null,
          spellName: createdSpell?.name || itemData?.name || null,
          actionId,
          actionCount: getItemActionEntries(createdSpell).length,
        });
        await createdSpell.displayCard(undefined, { token });
        return true;
      }

      throw new Error(
        [
          "The temporary spell was created, but PF1 did not expose a usable native cast action.",
          `Spell: ${createdSpell?.name || itemData?.name || "Unknown"}`,
          `Action count: ${getItemActionEntries(createdSpell).length}`,
          `Item.use: ${typeof createdSpell?.use === "function" ? "yes" : "no"}`,
          `Default action use: ${typeof defaultAction?.use === "function" ? "yes" : "no"}`,
          `displayCard: ${typeof createdSpell?.displayCard === "function" ? "yes" : "no"}`,
        ].join(" "),
      );
    } finally {
      if (createdSpell?.id) {
        try {
          await actor.deleteEmbeddedDocuments("Item", [createdSpell.id]);
        } catch (err) {
          console.warn("Spellcrafting macro could not clean up temporary cast spell.", err);
        }
      }
    }
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
      return { cost: null, type: "passive", actionType: "other" };
    }
    if (normalized.includes("free")) {
      return { cost: 1, type: "free", actionType: "spell" };
    }
    if (normalized.includes("swift")) {
      return { cost: 1, type: "swift", actionType: "spell" };
    }
    if (normalized.includes("immediate")) {
      return { cost: 1, type: "immediate", actionType: "spell" };
    }
    if (normalized.includes("move")) {
      return { cost: 1, type: "move", actionType: "spell" };
    }
    if (normalized.includes("full round") || normalized.includes("full-round")) {
      return { cost: 1, type: "full", actionType: "spell" };
    }
    if (normalized.includes("round")) {
      return { cost: 1, type: "round", actionType: "spell" };
    }
    if (normalized.includes("standard")) {
      return { cost: 1, type: "standard", actionType: "spell" };
    }
    if (normalized.includes("minute")) {
      return { cost: 1, type: "minute", actionType: "spell" };
    }
    if (normalized.includes("hour")) {
      return { cost: 1, type: "hour", actionType: "spell" };
    }
    if (normalized.includes("day")) {
      return { cost: 1, type: "day", actionType: "spell" };
    }
    return { cost: null, type: "other", actionType: "spell" };
  }

  function getItemActionEntries(itemData) {
    const actions = itemData?.system?.actions;
    if (!actions) return [];
    if (Array.isArray(actions)) return actions.filter((action) => action && typeof action === "object");
    if (typeof actions === "object") return Object.values(actions).filter((action) => action && typeof action === "object");
    return [];
  }

  function deepCloneSpellcraftingData(value) {
    if (value == null) return value;
    if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeArrayLikeValue(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (value instanceof Set) return Array.from(value);
    if (value && typeof value === "object") {
      return Object.values(value).filter((entry) => entry != null);
    }
    if (value == null) return [...fallback];
    return [...fallback];
  }

  function normalizeActionSourceData(action) {
    if (!action || typeof action !== "object") return action;

    const normalized = deepCloneSpellcraftingData(action);
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

    const normalizedActions = actions.map((action) => {
      if (!action || typeof action !== "object") return action;
      return normalizeActionSourceData(action);
    });

    setObjectPathValue(itemData, ["system", "actions"], normalizedActions);
    return normalizedActions;
  }

  function getNormalizedActionArrayForUpdate(item) {
    const actions = getObjectPath(item, ["system", "actions"]);
    if (actions == null) return null;
    return getItemActionEntries(item)
      .map((action) => normalizeActionSourceData(action))
      .filter((action) => action && typeof action === "object");
  }

  async function repairActorSpellActionArrays(actor) {
    if (!actor?.items?.length) return 0;

    const updates = [];
    for (const item of actor.items) {
      if (item?.type !== "spell") continue;
      const normalizedActions = getNormalizedActionArrayForUpdate(item);
      if (normalizedActions == null) continue;
      updates.push({
        _id: item.id,
        "system.actions": normalizedActions,
      });
    }

    if (!updates.length) return 0;
    await actor.updateEmbeddedDocuments("Item", updates);
    return updates.length;
  }

  function replaceStructuredDurationLine(description, durationText) {
    const source = String(description || "");
    if (!source) return source;
    return source.replace(
      /(Duration:\s*)([^<\n\r]+)(?=(?:<br\s*\/?>|\n|\r|$))/i,
      (_match, prefix) => `${prefix}${durationText}`,
    );
  }

  function getStructuredDurationLine(description) {
    const source = stripHtmlTags(String(description || ""));
    const match = source.match(/(?:^|\n)\s*Duration:\s*([^\n\r]+)/i);
    return match?.[1]?.trim() || "";
  }

  function durationObjectNeedsConcentrationRepair(durationData) {
    if (!durationData || typeof durationData !== "object") return false;
    if (durationData.concentration !== true) return false;
    const currentValue = normalizeAttributeValue(
      durationData.value
      ?? durationData.amount
      ?? durationData.current
      ?? durationData.text,
    );
    return !/^concentration$/i.test(String(currentValue || "").trim());
  }

  async function normalizeActorNonAugmentSpellDurations(actor) {
    const spellItems = Array.from(actor?.items?.contents ?? actor?.items ?? [])
      .filter((item) => item?.type === "spell" && !isAugmentSpell(item));
    if (!spellItems.length) return 0;

    const updates = [];
    for (const item of spellItems) {
      const description = getSpellDescription(item);
      const spellPointCost = getSpellPointCost(item);
      const sourceDuration = getStructuredDurationLine(description) || getSpellDuration(item) || "None";
      const normalizedDuration = normalizeSpellAttributeDuration(sourceDuration, spellPointCost) || sourceDuration;
      const durationData = getDurationDataFromDisplay(normalizedDuration);
      const currentStructuredDuration = getStructuredDurationLine(description);
      const currentSystemDuration = formatDurationDisplay(getObjectPath(item, ["system", "duration"])) || "";
      const nextDescription = description ? replaceStructuredDurationLine(description, normalizedDuration) : "";
      const descriptionNeedsUpdate = !!description && nextDescription !== description;
      const systemDurationNeedsUpdate = currentSystemDuration !== normalizedDuration
        || (normalizedDuration === "Concentration" && durationObjectNeedsConcentrationRepair(getObjectPath(item, ["system", "duration"])));
      const normalizedActions = getNormalizedActionArrayForUpdate(item);
      let actionsNeedUpdate = false;

      if (Array.isArray(normalizedActions)) {
        actionsNeedUpdate = normalizedActions.some((action) => {
          if (!action || typeof action !== "object") return false;
          const currentActionDuration = formatDurationDisplay(getObjectPath(action, ["duration"])) || "";
          return currentActionDuration !== normalizedDuration
            || (normalizedDuration === "Concentration" && durationObjectNeedsConcentrationRepair(getObjectPath(action, ["duration"])));
        });
      }

      if (!descriptionNeedsUpdate && !systemDurationNeedsUpdate && !actionsNeedUpdate && currentStructuredDuration === normalizedDuration) {
        continue;
      }

      const update = { _id: item.id };

      if (item.system?.duration && typeof item.system.duration === "object") {
        update["system.duration"] = {
          value: durationData.value,
          units: durationData.units,
          concentration: durationData.concentration,
          dismiss: durationData.dismiss,
        };
      } else {
        update["system.duration"] = normalizedDuration;
      }

      if (descriptionNeedsUpdate) {
        update["system.description.value"] = nextDescription;
      }

      if (actionsNeedUpdate && Array.isArray(normalizedActions)) {
        for (const action of normalizedActions) {
          if (!action || typeof action !== "object") continue;
          if (typeof action.duration === "object" && action.duration !== null) {
            setObjectPathValue(action, ["duration"], {
              value: durationData.value,
              units: durationData.units,
              concentration: durationData.concentration,
              dismiss: durationData.dismiss,
            });
          } else {
            setObjectPathValue(action, ["duration"], normalizedDuration);
          }
        }
        update["system.actions"] = normalizedActions;
      }

      updates.push(update);
    }

    await actor.updateEmbeddedDocuments("Item", updates);
    actor.sheet?.render?.(true);
    return updates.length;
  }

  function buildGeneratedUseAction(actionId) {
    return {
      _id: actionId,
      name: "Use",
      sort: 0,
      actionType: "spell",
      activation: {
        cost: null,
        type: "other",
        unchained: {
          cost: null,
          type: "other",
        },
      },
      range: {},
      duration: {},
      target: {},
      save: {},
      uses: {},
    };
  }

  function ensureGeneratedPrimaryAction(itemData) {
    if (!itemData?.system || typeof itemData.system !== "object") return null;

    const existingActions = normalizeGeneratedActionsToArray(itemData);
    if (existingActions.length) {
      const primaryAction = existingActions[0];
      setObjectPathValue(primaryAction, ["name"], String(primaryAction.name || "").trim() || "Use");
      setObjectPathValue(primaryAction, ["actionType"], String(primaryAction.actionType || "").trim() || "spell");
      return primaryAction;
    }

    const actionId = foundry?.utils?.randomID ? foundry.utils.randomID(8) : Math.random().toString(36).slice(2, 10);
    const action = buildGeneratedUseAction(actionId);

    setObjectPathValue(itemData, ["system", "actions"], [action]);
    return action;
  }

  function clearGeneratedActionTemplateData(action) {
    setObjectPathValue(action, ["area"], "");
    setObjectPathValue(action, ["effect"], "");
    setObjectPathValue(action, ["measureTemplate", "type"], "");
    setObjectPathValue(action, ["measureTemplate", "size"], "");
    setObjectPathValue(action, ["measureTemplate", "area"], "");
    setObjectPathValue(action, ["measureTemplate", "count"], "");
    setObjectPathValue(action, ["measureTemplate", "color"], "");
    setObjectPathValue(action, ["measureTemplate", "texture"], "");
    setObjectPathValue(action, ["measureTemplate", "customColor"], "");
    setObjectPathValue(action, ["measureTemplate", "overrideColor"], false);
    setObjectPathValue(action, ["measureTemplate", "overrideTexture"], false);
  }

  function clearGeneratedActionRollData(action) {
    setObjectPathValue(action, ["attackBonus"], "");
    setObjectPathValue(action, ["attackName"], "");
    setObjectPathValue(action, ["bab"], "");
    setObjectPathValue(action, ["formula"], "");
    setObjectPathValue(action, ["damage", "parts"], []);
    setObjectPathValue(action, ["damage", "value"], "");
    setObjectPathValue(action, ["damage", "formula"], "");
    setObjectPathValue(action, ["damage", "critParts"], []);
    setObjectPathValue(action, ["damage", "nonCritParts"], []);
    setObjectPathValue(action, ["damage", "versatile"], "");
    setObjectPathValue(action, ["damage", "multiplier"], "");
    setObjectPathValue(action, ["abilityDamage"], {});
    setObjectPathValue(action, ["abilityDrain"], {});
    setObjectPathValue(action, ["drain"], {});
    setObjectPathValue(action, ["healing", "formula"], "");
    setObjectPathValue(action, ["healing", "value"], "");
    setObjectPathValue(action, ["healing", "parts"], []);
    setObjectPathValue(action, ["powerPointsHealing"], "");
    setObjectPathValue(action, ["rollTable"], "");
    setObjectPathValue(action, ["resourceFormula"], "");
    setObjectPathValue(action, ["save", "dc"], "");
    setObjectPathValue(action, ["save", "formula"], "");
    setObjectPathValue(action, ["dc", "formula"], "");
    setObjectPathValue(action, ["attackNotes"], "");
    setObjectPathValue(action, ["effectNotes"], "");
    setObjectPathValue(action, ["specialActions"], []);
    setObjectPathValue(action, ["conditionals"], []);
  }

  function deepCloneGeneratedData(value) {
    if (value == null) return value;
    if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function rewriteSpellPointFormulaText(value) {
    return String(value || "").replace(/@cl\b/gi, "@item.spellPointCost");
  }

  function evaluateSpellcraftingMathFormula(formula, totalSP) {
    const rewrittenFormula = rewriteSpellPointFormulaText(formula)
      .replace(/@item\.system\.spellPointCost\b/gi, String(totalSP))
      .replace(/@item\.spellPointCost\b/gi, String(totalSP))
      .replace(/@spellPointCost\b/gi, String(totalSP))
      .replace(/@sp\b/gi, String(totalSP));
    const sanitizedFormula = String(rewrittenFormula || "").trim();
    if (!sanitizedFormula) return 0;
    if (!/^[0-9+\-*/%().,\s_a-zA-Z]+$/.test(sanitizedFormula)) return 0;

    try {
      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
      const evaluator = Function(
        "abs",
        "ceil",
        "clamp",
        "floor",
        "max",
        "min",
        "pow",
        "round",
        "sqrt",
        "trunc",
        `"use strict"; return (${sanitizedFormula});`,
      );
      const result = evaluator(
        Math.abs,
        Math.ceil,
        clamp,
        Math.floor,
        Math.max,
        Math.min,
        Math.pow,
        Math.round,
        Math.sqrt,
        Math.trunc,
      );
      const numeric = Number(result);
      return Number.isFinite(numeric) ? numeric : 0;
    } catch (err) {
      console.warn("Spellcrafting macro could not evaluate an extra attack formula.", {
        formula,
        rewrittenFormula: sanitizedFormula,
        totalSP,
        error: err,
      });
      return 0;
    }
  }

  function getExtraAttackCountFromAction(action, totalSP) {
    const rawFormula = getObjectPath(action, ["extraAttacks", "formula", "count"]);
    if (rawFormula == null || rawFormula === "") return 0;
    const numeric = Math.floor(evaluateSpellcraftingMathFormula(rawFormula, totalSP));
    return Math.max(0, numeric);
  }

  function extractActionDamagePartTemplate(action) {
    const damageParts = normalizeArrayLikeValue(getObjectPath(action, ["damage", "parts"]));
    const firstPart = damageParts.find((part) => part != null);
    if (firstPart != null) {
      return deepCloneGeneratedData(firstPart);
    }

    const damage = getObjectPath(action, ["damage"]);
    if (!damage || typeof damage !== "object") return null;

    const formula = String(
      damage.formula
      ?? damage.value
      ?? "",
    ).trim();
    if (!formula) return null;

    const damageType = normalizeArrayLikeValue(
      damage.types
      ?? damage.type
      ?? damage.damageType
      ?? [],
    );

    if (damageType.length <= 1) {
      return [formula, damageType[0] || ""];
    }

    return {
      formula,
      types: damageType,
    };
  }

  function duplicateAttackRollDamageInstances(action, originalAction, totalSP) {
    if (!actionHasAttackRoll(originalAction)) return;

    const extraAttackCount = getExtraAttackCountFromAction(originalAction, totalSP);
    if (!extraAttackCount) return;

    const templatePart = extractActionDamagePartTemplate(originalAction);
    if (templatePart == null) return;

    const existingParts = normalizeArrayLikeValue(getObjectPath(action, ["damage", "parts"]));
    const nextParts = [...existingParts];
    for (let index = 0; index < extraAttackCount; index += 1) {
      nextParts.push(deepCloneGeneratedData(templatePart));
    }
    setObjectPathValue(action, ["damage", "parts"], nextParts);
  }

  function rewriteSpellPointFormulaData(value) {
    if (value == null) return value;
    if (typeof value === "string") return rewriteSpellPointFormulaText(value);
    if (Array.isArray(value)) return value.map((entry) => rewriteSpellPointFormulaData(entry));
    if (typeof value === "object") {
      const result = {};
      for (const [key, entry] of Object.entries(value)) {
        result[key] = rewriteSpellPointFormulaData(entry);
      }
      return result;
    }
    return value;
  }

  function getGeneratedActionDamageSnapshot(action) {
    return {
      damage: deepCloneGeneratedData(getObjectPath(action, ["damage"])),
      healing: deepCloneGeneratedData(getObjectPath(action, ["healing"])),
      resourceFormula: deepCloneGeneratedData(getObjectPath(action, ["resourceFormula"])),
    };
  }

  function restoreGeneratedActionDamageData(action, snapshot) {
    if (!snapshot) return;
    if (snapshot.damage != null) {
      setObjectPathValue(action, ["damage"], rewriteSpellPointFormulaData(snapshot.damage));
    }
    if (snapshot.healing != null) {
      setObjectPathValue(action, ["healing"], rewriteSpellPointFormulaData(snapshot.healing));
    }
    if (snapshot.resourceFormula != null) {
      setObjectPathValue(action, ["resourceFormula"], rewriteSpellPointFormulaData(snapshot.resourceFormula));
    }
  }

  function setGeneratedActionSpellPointAliases(action, totalSP) {
    setObjectPathValue(action, ["sp"], totalSP);
    setObjectPathValue(action, ["spellPointCost"], totalSP);
    setObjectPathValue(action, ["uses", "spellPointCost"], String(totalSP));
  }

  function applyGeneratedActionClassification(action, saveType = "") {
    const normalizedSaveType = String(saveType || "").trim().toLowerCase();
    const actionType = normalizedSaveType ? "save" : "spell";

    setObjectPathValue(action, ["actionType"], actionType);
    setObjectPathValue(action, ["attackBonus"], "");
    setObjectPathValue(action, ["attackName"], "");
    setObjectPathValue(action, ["bab"], "");
    setObjectPathValue(action, ["touch"], false);
    setObjectPathValue(action, ["nonlethal"], false);
    setObjectPathValue(action, ["naturalAttack", "primary"], false);
    setObjectPathValue(action, ["naturalAttack", "secondary", "attackBonus"], "");
    setObjectPathValue(action, ["naturalAttack", "secondary", "damageMult"], 0.5);
    setObjectPathValue(action, ["ability", "attack"], "");
    setObjectPathValue(action, ["ability", "critMult"], 1);
    setObjectPathValue(action, ["ability", "critRange"], 0);
    setObjectPathValue(action, ["extraAttacks", "type"], "");
    setObjectPathValue(action, ["extraAttacks", "formula", "count"], "");
    setObjectPathValue(action, ["extraAttacks", "formula", "bonus"], "");
    setObjectPathValue(action, ["extraAttacks", "formula", "label"], "");
    setObjectPathValue(action, ["extraAttacks", "manual"], []);
    setObjectPathValue(action, ["maneuverType"], null);
  }

  function syncGeneratedActionAttributes(itemData, totalSP) {
    const primaryAction = ensureGeneratedPrimaryAction(itemData);
    const actions = getItemActionEntries(itemData);
    if (!actions.length && !primaryAction) return;

    for (const action of actions) {
      const damageSnapshot = getGeneratedActionDamageSnapshot(action);
      setObjectPathValue(action, ["name"], "Use");
      applyGeneratedActionClassification(action);
      setObjectPathValue(action, ["activation", "cost"], null);
      setObjectPathValue(action, ["activation", "type"], "other");
      setObjectPathValue(action, ["activation", "unchained", "cost"], null);
      setObjectPathValue(action, ["activation", "unchained", "type"], "other");
      setGeneratedActionSpellPointAliases(action, totalSP);
      setObjectPathValue(action, ["target", "value"], "");
      setObjectPathValue(action, ["range", "value"], "");
      setObjectPathValue(action, ["range", "units"], "");
      clearGeneratedActionTemplateData(action);
      clearGeneratedActionRollData(action);
      restoreGeneratedActionDamageData(action, damageSnapshot);
      setObjectPathValue(action, ["duration", "value"], "None");
      setObjectPathValue(action, ["duration", "units"], "spec");
      setObjectPathValue(action, ["duration", "concentration"], false);
      setObjectPathValue(action, ["duration", "dismiss"], false);
      setObjectPathValue(action, ["save", "description"], "");
      setObjectPathValue(action, ["save", "type"], "");
    }
  }

  function stripInheritedTemplateActionRollData(itemData) {
    const actions = normalizeGeneratedActionsToArray(itemData);
    for (const action of actions) {
      clearGeneratedActionTemplateData(action);
      clearGeneratedActionRollData(action);
      setObjectPathValue(action, ["damage"], {});
      setObjectPathValue(action, ["healing"], {});
      setObjectPathValue(action, ["resourceFormula"], "");
    }
  }

  function sanitizeGeneratedSpellTemplate(itemData, totalSP) {
    itemData.system = itemData.system && typeof itemData.system === "object" ? itemData.system : {};
    itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};

    setObjectPathValue(itemData, ["system", "description"], itemData.system.description && typeof itemData.system.description === "object" ? itemData.system.description : {});
    setObjectPathValue(itemData, ["system", "school"], "");
    setObjectPathValue(itemData, ["system", "spellSchool"], "");
    setObjectPathValue(itemData, ["system", "subschool"], "");
    setObjectPathValue(itemData, ["system", "descriptors"], []);
    setObjectPathValue(itemData, ["system", "types"], "");
    setObjectPathValue(itemData, ["system", "learnedAt"], {});
    setObjectPathValue(itemData, ["system", "domain"], false);
    setObjectPathValue(itemData, ["system", "level"], 0);
    setObjectPathValue(itemData, ["system", "castingTime"], "Passive");
    setObjectPathValue(itemData, ["system", "time"], "Passive");
    setObjectPathValue(itemData, ["system", "target"], "");
    setObjectPathValue(itemData, ["system", "targets"], "");
    setObjectPathValue(itemData, ["system", "effect"], "");
    setObjectPathValue(itemData, ["system", "area"], "");
    setObjectPathValue(itemData, ["system", "savingThrow"], "");
    setObjectPathValue(itemData, ["system", "sr"], false);
    setObjectPathValue(itemData, ["system", "pr"], false);
    setObjectPathValue(itemData, ["system", "powerPointsCost"], "");
    setObjectPathValue(itemData, ["system", "components", "value"], "");
    setObjectPathValue(itemData, ["system", "components", "verbal"], false);
    setObjectPathValue(itemData, ["system", "components", "somatic"], false);
    setObjectPathValue(itemData, ["system", "components", "material"], false);
    setObjectPathValue(itemData, ["system", "components", "focus"], false);
    setObjectPathValue(itemData, ["system", "components", "divineFocus"], 0);
    setObjectPathValue(itemData, ["system", "materials", "value"], "");
    setObjectPathValue(itemData, ["system", "materials", "focus"], "");
    setObjectPathValue(itemData, ["system", "materials", "gpValue"], 0);

    if (itemData.system?.range && typeof itemData.system.range === "object") {
      setObjectPathValue(itemData, ["system", "range", "value"], "");
      setObjectPathValue(itemData, ["system", "range", "units"], "");
    } else {
      setObjectPathValue(itemData, ["system", "range"], "");
    }

    if (itemData.system?.duration && typeof itemData.system.duration === "object") {
      setObjectPathValue(itemData, ["system", "duration", "value"], "None");
      setObjectPathValue(itemData, ["system", "duration", "units"], "spec");
      setObjectPathValue(itemData, ["system", "duration", "dismiss"], false);
      setObjectPathValue(itemData, ["system", "duration", "concentration"], false);
    } else {
      setObjectPathValue(itemData, ["system", "duration"], "None");
    }

    setObjectPathValue(itemData, ["system", "activation", "cost"], null);
    setObjectPathValue(itemData, ["system", "activation", "type"], "passive");
    setObjectPathValue(itemData, ["system", "save", "description"], "");
    setObjectPathValue(itemData, ["system", "save", "type"], "");
    setObjectPathValue(itemData, ["system", "spellPointCost"], totalSP);
    setObjectPathValue(itemData, ["system", "spCost"], totalSP);
    setObjectPathValue(itemData, ["system", "slotCost"], totalSP);
    setObjectPathValue(itemData, ["system", "spellPoints", "cost"], totalSP);
    setObjectPathValue(itemData, ["system", "uses", "autoDeductChargesCost"], "");

    syncGeneratedActionAttributes(itemData, totalSP);
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

  function isMacroGeneratedSpellItem(item) {
    return !!getObjectPath(item, ["flags", FLAG_SCOPE, "sourceUuid"]);
  }

  function getWorkingSpellbookTemplate(actor, spellbookId) {
    const targetKey = String(spellbookId);
    const existingSpell = actor.items.find((item) => {
      if (item.type !== "spell") return false;
      return getSpellbookRefs(item).some((ref) => String(ref.id) === targetKey);
    });
    if (!existingSpell) return null;

    return {
      pf1Flag: getObjectPath(existingSpell, ["flags", "pf1", "spellbook"]),
      plainFlag: getObjectPath(existingSpell, ["flags", "spellbook"]),
    };
  }

  function getTemplateSpellItem(actor, spellbookId) {
    const targetKey = String(spellbookId);
    const matchingSpell = actor.items.find((item) => {
      if (item.type !== "spell") return false;
      if (isMacroGeneratedSpellItem(item)) return false;
      return getSpellbookRefs(item).some((ref) => String(ref.id) === targetKey);
    });
    if (matchingSpell) return matchingSpell;

    return actor.items.find((item) => item.type === "spell" && !isMacroGeneratedSpellItem(item)) || null;
  }

  function assignSpellbookReference(actor, itemData, spellbookId, spellbookName) {
    const canonicalKey = getCanonicalSpellbookKey(actor, spellbookId, spellbooks);
    if (!canonicalKey) {
      throw new Error("Could not resolve the selected spellbook to a valid PF1 spellbook key.");
    }

    const template = getWorkingSpellbookTemplate(actor, canonicalKey);
    const fallbackKey = String(canonicalKey);
    const templatePf1Flag = template?.pf1Flag && typeof template.pf1Flag === "object" ? template.pf1Flag : {};
    const templatePlainFlag = template?.plainFlag && typeof template.plainFlag === "object" ? template.plainFlag : {};

    // PF1 validates against the actor's spellbook entry key, so always write the canonical key here.
    setObjectPathValue(itemData, ["system", "spellbook"], fallbackKey);
    setObjectPathValue(itemData, ["system", "spellbookId"], fallbackKey);
    setObjectPathValue(itemData, ["system", "spellbookName"], spellbookName);
    setObjectPathValue(itemData, ["flags", "pf1", "spellbook"], { ...templatePf1Flag, id: fallbackKey, name: spellbookName });
    setObjectPathValue(itemData, ["flags", "spellbook"], { ...templatePlainFlag, id: fallbackKey, name: spellbookName });
  }

  function populateSpellItemAttributes(itemData, resolvedAttributes, totalSP, sourceActionEntries = []) {
    const systemSchoolKey = toSystemSchoolKey(resolvedAttributes.school);
    const saveDescription = String(resolvedAttributes.savingThrow || "").trim();
    const saveType = toSystemSaveType(saveDescription);
    const castingTime = String(resolvedAttributes.castingTime || "").trim() || "Passive";
    const durationData = getDurationDataFromDisplay(resolvedAttributes.duration);
    const activationData = getActivationDataFromCastingTime(castingTime);
    const spellLevel = Math.max(0, Math.ceil(Number(totalSP || 0) / 2));
    setObjectPathValue(itemData, ["system", "spellPointCost"], totalSP);
    setObjectPathValue(itemData, ["system", "spCost"], totalSP);
    setObjectPathValue(itemData, ["system", "sp"], totalSP);
    setObjectPathValue(itemData, ["system", "slotCost"], totalSP);
    setObjectPathValue(itemData, ["system", "spellPoints", "cost"], totalSP);
    setObjectPathValue(itemData, ["system", "level"], spellLevel);
    setObjectPathValue(itemData, ["system", "school"], systemSchoolKey);
    setObjectPathValue(itemData, ["system", "spellSchool"], systemSchoolKey);
    setObjectPathValue(itemData, ["system", "castingTime"], castingTime);
    setObjectPathValue(itemData, ["system", "time"], castingTime);
    setObjectPathValue(itemData, ["system", "duration", "value"], durationData.value);
    setObjectPathValue(itemData, ["system", "duration", "units"], durationData.units);
    setObjectPathValue(itemData, ["system", "duration", "concentration"], durationData.concentration);
    setObjectPathValue(itemData, ["system", "duration", "dismiss"], durationData.dismiss);
    setObjectPathValue(itemData, ["system", "activation", "cost"], activationData.cost);
    setObjectPathValue(itemData, ["system", "activation", "type"], activationData.type);
    setObjectPathValue(itemData, ["system", "savingThrow"], saveDescription);
    setObjectPathValue(itemData, ["system", "save", "description"], saveDescription);
    setObjectPathValue(itemData, ["system", "save", "type"], saveType);
    setObjectPathValue(itemData, ["system", "uses", "autoDeductChargesCost"], "");

    const generatedActions = getItemActionEntries(itemData);
    for (let index = 0; index < generatedActions.length; index += 1) {
      const action = generatedActions[index];
      const originalAction = deepCloneGeneratedData(sourceActionEntries[index] || action);
      const damageSnapshot = getGeneratedActionDamageSnapshot(action);
      setObjectPathValue(action, ["name"], "Use");
      applyGeneratedActionClassification(action, saveType);
      setObjectPathValue(action, ["activation", "cost"], activationData.cost);
      setObjectPathValue(action, ["activation", "type"], activationData.type);
      setObjectPathValue(action, ["activation", "unchained", "cost"], activationData.cost);
      setObjectPathValue(action, ["activation", "unchained", "type"], activationData.type);
      clearGeneratedActionTemplateData(action);
      clearGeneratedActionRollData(action);
      restoreGeneratedActionDamageData(action, damageSnapshot);
      duplicateAttackRollDamageInstances(action, originalAction, totalSP);
      setGeneratedActionSpellPointAliases(action, totalSP);
      setObjectPathValue(action, ["duration", "value"], durationData.value);
      setObjectPathValue(action, ["duration", "units"], durationData.units);
      setObjectPathValue(action, ["duration", "concentration"], durationData.concentration);
      setObjectPathValue(action, ["duration", "dismiss"], durationData.dismiss);
      setObjectPathValue(action, ["save", "description"], saveDescription);
      setObjectPathValue(action, ["save", "type"], saveType);
    }
  }

  async function promptForPreparedSpellName(actor, state) {
    const core = getActiveItemById(state, state.selectedCoreId);
    if (!core) return null;
    const defaultName = getDisplaySpellName(core.name) || "";

    const content = `
      <div style="display:grid; gap:0.8rem;">
        <div style="padding-bottom:0.35rem;">
          <input
            id="spellcrafting-custom-name"
            type="text"
            placeholder="${escapeHtml(defaultName)}"
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
        title: "Name New Spell",
        content,
        buttons: {
          accept: {
            label: "Accept",
            callback: (html) => {
              const input = html.find("#spellcrafting-custom-name");
              const chosenName = String(input.val() || "").trim();
              settle(chosenName || defaultName || null);
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
          const input = html.find("#spellcrafting-custom-name");
          setTimeout(() => {
            input.trigger("focus");
          }, 0);
        },
      }).render(true);
    });
  }

  async function addBuiltSpellToSpellbook(actor, state, customName) {
    const { itemData, resolvedAttributes } = buildSpellItemData(actor, state, { customName });
    const [createdSpell] = await actor.createEmbeddedDocuments("Item", [itemData]);
    await normalizeActorNonAugmentSpellDurations(actor);
    if (createdSpell) {
      createdSpell.sheet?.render?.(true);
    }
    ui.notifications.info(`You have added ${resolvedAttributes.name} to your spellbook`);
    return true;
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
      entry,
      relativePath,
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

  async function castBuiltSpell(actor, state) {
    const core = getActiveItemById(state, state.selectedCoreId);
    if (!core) {
      ui.notifications.warn("Select a Core before casting.");
      return false;
    }
  
    const { itemData } = buildSpellItemData(actor, state, {
      preferTemplateSource: state.preparationMode === "spontaneous",
    });

    const castSucceeded = await createSpellChatFromTemporaryItem(actor, itemData);
    if (castSucceeded && state.preparationMode === "spontaneous") {
      try {
        await normalizeActorNonAugmentSpellDurations(actor);
      } catch (err) {
        console.warn("Spellcrafting macro could not retroactively normalize spontaneous core durations.", err);
      }
    }

    return castSucceeded;
  }

  function buildDialogContent(spellbooks, state, actor) {
    const spellbookOptions = spellbooks.map((book) => getSpellbookOptionHtml(book, state.spellbookId)).join("");
    const coreListItems = "<div class=\"spellcrafting-empty\">Select a spellbook to see cores.</div>";
    const coreAugmentsHtml = "<div class=\"spellcrafting-empty\">Select a core to view core augments.</div>";
    const spellAugmentsHtml = "<div class=\"spellcrafting-empty\">Select a spellbook to view spell augments.</div>";

    return `
      <style>
        .spellcrafting-root { width: 100%; min-width: 1700px; display: grid; grid-template-rows: auto minmax(0, 1fr); row-gap: 1.5rem; flex: 1 1 auto; overflow: hidden; min-height: 0; box-sizing: border-box; background: #58544d; padding: 0.9rem; border-radius: 10px; }
        .spellcrafting-static-top { min-height: 0; }
        .spellcrafting-body { min-height: 0; overflow: hidden; display: flex; align-items: stretch; }
        .spellcrafting-grid { display: grid; grid-template-columns: 2fr 3fr 5fr; gap: 1.5rem; width: 100%; height: 100%; min-height: 0; flex: 1 1 auto; align-items: stretch; }
        .spellcrafting-panel { border: 1px solid #7d7668; background: rgba(201, 196, 184, 0.94); padding: 1rem 1.1rem; border-radius: 8px; overflow: hidden; color: #151412; width: 100%; box-sizing: border-box; min-width: 0; min-height: 0; box-shadow: 0 1px 0 rgba(255, 255, 255, 0.18) inset; }
        .spellcrafting-panel h3 { margin: 0 0 0.8rem; padding-bottom: 0.35rem; border-bottom: 1px solid #b85b4d; font-size: 1.05rem; font-weight: 700; color: #2c2a25; }
        .spellcrafting-panel-header { display:flex; align-items:flex-start; justify-content:space-between; gap:0.6rem; margin-bottom:0.8rem; }
        .spellcrafting-panel-header h3 { margin: 0; flex: 1 1 auto; min-width: 0; }
        .spellcrafting-panel-header-controls { display:flex; align-items:center; gap:0.5rem; flex: 0 0 auto; }
        .spellcrafting-inline-toggle { display:inline-flex; align-items:center; gap:0.3rem; font-size:0.74rem; font-weight:700; color:#2f2c25; white-space:nowrap; flex: 0 0 auto; }
        .spellcrafting-inline-toggle input[type="checkbox"] { margin:0; transform: scale(0.85); transform-origin: center; }
        .spellcrafting-inline-toggle.disabled { opacity:0.6; }
        .spellcrafting-inline-toggle.hidden { display:none; }
        .spellcrafting-core-filter { margin-bottom: 0.8rem; }
        .spellcrafting-core-filter input { width: 100%; min-height: 2rem; padding: 0.35rem 0.5rem; border: 1px solid #8f8673; border-radius: 4px; background: #e4dfd3; color: #161616; font-size: 0.92rem; box-sizing: border-box; }
        .spellcrafting-scrollable-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; height: 100%; }
        .spellcrafting-top-panel { padding: 0.9rem 1.1rem; }
        .spellcrafting-toolbar { display: grid; grid-template-columns: minmax(290px, 380px) auto auto; align-items: end; gap: 1.25rem; }
        .spellcrafting-field { min-width: 0; }
        .spellcrafting-field label { font-weight: 700; display: block; margin-bottom: 0.45rem; font-size: 0.95rem; color: #26231d; }
        .spellcrafting-field select { width: 100%; min-height: 2.35rem; line-height: 1.4; color: #161616; background: #e4dfd3; border: 1px solid #8f8673; border-radius: 4px; padding: 0.4rem 0.55rem; font-size: 0.96rem; box-shadow: 0 1px 0 rgba(255, 255, 255, 0.28) inset; }
        .spellcrafting-actions { display: inline-grid; grid-template-columns: repeat(3, minmax(120px, 150px)); gap: 1.1rem; justify-content: flex-start; width: auto; }
        .spellcrafting-actions button { width: 100%; min-width: 0; padding: 0.5rem 0.75rem; font-size: 0.92rem; font-weight: 600; white-space: nowrap; border: 1px solid #9e916d; border-radius: 4px; background: linear-gradient(to bottom, #ddd4b8, #c9bea0); color: #1c1914; }
        .spellcrafting-actions button:hover { background: linear-gradient(to bottom, #e4dbc0, #d0c4a6); }
        .spellcrafting-actions button:disabled { background: linear-gradient(to bottom, #b9b19d, #9d9583); border-color: #857d6d; color: #5d564c; cursor: default; opacity: 0.85; }
        .spellcrafting-costs { display: grid; grid-template-columns: auto auto auto; column-gap: 1.25rem; row-gap: 0.2rem; align-items: center; padding: 0.65rem 0.85rem; background: rgba(223, 218, 205, 0.95); border: 1px solid #8f8674; border-radius: 6px; color: #111; font-size: 0.98rem; width: 41rem; max-width: 41rem; min-width: 41rem; min-height: 2.35rem; box-sizing: border-box; }
        .spellcrafting-costs div { margin-bottom: 0; display: flex; align-items: baseline; gap: 0.5rem; }
        .spellcrafting-costs strong { font-size: 0.95rem; margin: 0; color: #333029; }
        .spellcrafting-costs span { font-size: 1.85rem; font-weight: 700; line-height: 1; display: inline-block; color: #191816; }
        .spellcrafting-costs .spellcrafting-school-value { width: 13ch; min-width: 13ch; text-align: left; font-size: 1.25rem; }
        .ui-dialog-buttonpane { display: none !important; }
        .spellcrafting-core-list { flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; min-height: 0; padding-right: 0.2rem; }
        .spellcrafting-core-item { display: grid; grid-template-columns: auto minmax(0, 1fr) max-content; align-items: center; gap: 0.65rem; background: rgba(236, 233, 225, 0.82); padding: 0.45rem 0.65rem; border-radius: 4px; color: #111; border: 1px solid #9f9787; font-size: 0.96rem; transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease; cursor: pointer; }
        .spellcrafting-core-item:hover { background: rgba(244, 240, 232, 0.9); border-color: #887d63; }
        .spellcrafting-core-item.selected { background: rgba(173, 220, 182, 0.98); border-color: #1f7a3d; box-shadow: inset 0 0 0 1px rgba(21, 100, 46, 0.34), 0 0 0 1px rgba(31, 122, 61, 0.28), 0 2px 6px rgba(24, 92, 44, 0.18); }
        .spellcrafting-core-item input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; margin: 0; }
        .spellcrafting-core-icon { width: 2rem; height: 2rem; object-fit: cover; border-radius: 4px; border: 1px solid rgba(89, 82, 66, 0.35); background: rgba(255, 255, 255, 0.75); box-shadow: 0 1px 2px rgba(0,0,0,0.12); }
        .spellcrafting-core-name { min-width: 0; overflow-wrap: anywhere; word-break: break-word; font-weight: 700; }
        .spellcrafting-core-meta { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 0.12rem; text-align: right; min-width: max-content; }
        .spellcrafting-core-school { width: auto; text-align: right; justify-self: end; color: #5a554a; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; }
        .spellcrafting-core-cost { color: #6b4225; font-size: 0.8rem; font-weight: 700; white-space: nowrap; }
        .spellcrafting-augment-list { flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; gap: 0.65rem; min-height: 0; padding-right: 0.2rem; }
        .spellcrafting-augment-group { display: grid; gap: 0.45rem; }
        .spellcrafting-augment-group + .spellcrafting-augment-group { margin-top: 0.35rem; padding-top: 0.55rem; border-top: 1px solid rgba(159, 154, 140, 0.5); }
        .spellcrafting-augment-group-title { font-size: 1rem; font-weight: 800; color: #2f2b24; letter-spacing: 0.01em; line-height: 1.2; }
        .spellcrafting-augment-group-limitation { margin-top: -0.1rem; font-size: 0.86rem; line-height: 1.28; color: #4a4438; }
        .spellcrafting-augment-group-limitation strong { color: #2f2c25; }
        .spellcrafting-augment-entry { padding: 0.65rem 0.8rem; border: 1px solid #9c9485; border-radius: 4px; background: rgba(236, 233, 225, 0.78); color: #111; font-size: 0.91rem; }
        .spellcrafting-augment-entry label { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: start; gap: 0.8rem; }
        .spellcrafting-augment-entry strong { min-width: 2.25rem; padding-top: 0.05rem; color: #171614; }
        .spellcrafting-augment-entry .augment-description { color: #2f2d28; flex: 1; font-size: 0.91rem; line-height: 1.28; }
        .spellcrafting-repeat-control { display: inline-grid; grid-template-columns: auto auto auto; align-items: center; gap: 0.25rem; }
        .spellcrafting-repeat-control button { width: 1.8rem; min-width: 1.8rem; height: 1.8rem; padding: 0; border: 1px solid #978d79; border-radius: 4px; background: #d8cfb4; color: #2b2924; font-size: 1rem; font-weight: 700; line-height: 1; }
        .spellcrafting-repeat-control button:hover { background: #e1d8bc; }
        .spellcrafting-repeat-control button:disabled { background: #cfc8b7; border-color: #b4ac98; color: #8d877c; cursor: default; opacity: 0.75; }
        .spellcrafting-augment-entry .repeat-count { width: 2.6rem; min-width: 2.6rem; text-align: center; min-height: 1.8rem; padding: 0.2rem 0.25rem; font-size: 0.86rem; border: 1px solid #978d79; border-radius: 4px; background: #e3ddd1; }
        .spellcrafting-augment-entry .repeat-count:disabled { background: #d7d1c5; border-color: #b4ac98; color: #8e897f; }
        .spellcrafting-augment-entry input[type="checkbox"] { margin-top: 0.15rem; }
        .spellcrafting-empty { color: #555; font-style: italic; font-size: 0.92rem; }
        @media (max-width: 1550px) {
          .spellcrafting-toolbar { grid-template-columns: minmax(250px, 1fr); align-items: start; }
          .spellcrafting-costs { max-width: none; }
          .spellcrafting-actions { justify-content: start; }
        }
      </style>
      <div id="spellcrafting-root" class="spellcrafting-root">
        <div class="spellcrafting-static-top">
          <div class="spellcrafting-panel spellcrafting-top-panel">
            <div class="spellcrafting-toolbar">
              <div class="spellcrafting-field">
                <label for="selectedSpellbook">Spellbook</label>
                <select id="selectedSpellbook">${spellbookOptions}</select>
              </div>
              <div class="spellcrafting-costs">
                <div><strong>Total SP Cost:</strong> <span id="totalSP">0</span></div>
                <div><strong>Spell Level:</strong> <span id="spellLevel">0</span></div>
                <div><strong>School:</strong> <span id="spellSchool" class="spellcrafting-school-value">None</span></div>
              </div>
              <div class="spellcrafting-actions">
                <button type="button" class="spellcrafting-cast" disabled>Cast</button>
                <button type="button" class="spellcrafting-add" disabled>Add to Spellbook</button>
                <button type="button" class="spellcrafting-cancel">Cancel</button>
              </div>
            </div>
          </div>
        </div>
        <div class="spellcrafting-body">
          <div class="spellcrafting-grid">
            <div class="spellcrafting-panel spellcrafting-scrollable-panel">
            <div class="spellcrafting-panel-header">
              <h3>Spell Cores</h3>
              <div class="spellcrafting-panel-header-controls">
                <label class="spellcrafting-inline-toggle ${state.useLegacyPreparedCores ? "" : "hidden"}" id="classOnlyLegacyPreparedCoresLabel">
                  <input type="checkbox" id="classOnlyLegacyPreparedCores" ${state.classOnlyLegacyPreparedCores ? "checked" : ""} />
                  <span>Class Only</span>
                </label>
                <label class="spellcrafting-inline-toggle">
                  <input type="checkbox" id="legacyPreparedCores" ${state.useLegacyPreparedCores ? "checked" : ""} />
                  <span>Legacy</span>
                </label>
              </div>
            </div>
              <div class="spellcrafting-core-filter">
                <input type="text" id="coreFilterInput" value="${escapeHtml(state.coreFilterText || "")}" placeholder="Filter cores by name" autocomplete="off" />
              </div>
              <div class="spellcrafting-core-list">${coreListItems}</div>
            </div>
            <div class="spellcrafting-panel spellcrafting-scrollable-panel">
              <h3 id="coreAugmentsPanelTitle">Core Augments</h3>
              <div id="coreAugmentsContainer" class="spellcrafting-augment-list">${coreAugmentsHtml}</div>
            </div>
            <div class="spellcrafting-panel spellcrafting-scrollable-panel">
              <h3>Spell Augments</h3>
              <div id="spellAugmentsContainer" class="spellcrafting-augment-list">${spellAugmentsHtml}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function buildCoreAugmentsHtml(actor, state) {
    if (state.preparationMode === "prepared" && state.useLegacyPreparedCores) {
      return buildLegacySpellPreviewHtml(actor, state);
    }

    const core = getActiveItemById(state, state.selectedCoreId);
    if (!core) return "<div class=\"spellcrafting-empty\">Select a core to view core augments.</div>";
    const description = getSpellDescription(core);
    const augmentEntries = parseAugmentLines(description, /Core Augments?:/i);
    if (!augmentEntries.length) {
      return "<div class=\"spellcrafting-empty\">No core augments were detected for this core.</div>";
    }
    return augmentEntries.map((entry, index) => {
      const key = `core-${getItemSourceKey(core)}-${index}`;
      const checked = state.selectedCoreAugments[key] ? "checked" : "";
      const isSelected = !!state.selectedCoreAugments[key];
      const count = isSelected ? state.selectedCoreAugments[key].count : 0;
      const repeatableHtml = entry.repeatable
        ? `
          <div class="spellcrafting-repeat-control">
            <button type="button" class="repeat-adjust" data-direction="-1" data-augment-key="${key}" data-augment-type="core" ${checked ? "" : "disabled"}>-</button>
            <input class="repeat-count" type="number" min="0" max="99" value="${count}" data-augment-key="${key}" data-augment-type="core" ${checked ? "" : "disabled"} />
            <button type="button" class="repeat-adjust" data-direction="1" data-augment-key="${key}" data-augment-type="core" ${checked ? "" : "disabled"}>+</button>
          </div>
        `
        : "";
      return `
        <div class="spellcrafting-augment-entry">
          <label>
            <input type="checkbox" data-augment-key="${key}" data-augment-type="core" ${checked} />
            <strong>${escapeHtml(normalizeDisplayedSpellText(entry.title))}</strong>
            <span class="augment-description">${escapeHtml(normalizeDisplayedSpellText(entry.description))}</span>
            ${repeatableHtml}
          </label>
        </div>
      `;
    }).join("");
  }

  function buildSpellAugmentsHtml(actor, state) {
    const augments = state.availableSpellAugments;
    if (!augments.length) {
      if (state.preparationMode === "hybrid") {
        return "<div class=\"spellcrafting-empty\">Hybrid spellbooks are not supported until the spellbook is set to Prepared or Spontaneous.</div>";
      }
      return `<div class="spellcrafting-empty">${state.preparationMode === "prepared" ? "No spell augments were found in the Darkfinder 'Spell Augments' compendium." : "No spell augments were detected in the selected spellbook."}</div>`;
    }
    const entries = augments.flatMap((augmentItem) => {
      const description = getSpellDescription(augmentItem);
      const lines = parseAugmentLines(description, /Augment|Description:/i);
      return lines.map((entry, index) => ({ augmentItem, entry, index }));
    });
    if (!entries.length) {
      return "<div class=\"spellcrafting-empty\">No augment options were detected in the available augment spells.</div>";
    }
    const groupedEntries = entries.reduce((groups, entryData) => {
      const groupKey = entryData.augmentItem.id;
      if (!groups.has(groupKey)) groups.set(groupKey, { augmentItem: entryData.augmentItem, entries: [] });
      groups.get(groupKey).entries.push(entryData);
      return groups;
    }, new Map());

    return Array.from(groupedEntries.values()).map(({ augmentItem, entries: groupEntries }) => {
      const limitationText = getSpellAugmentLimitation(getSpellDescription(augmentItem));
      const limitationHtml = limitationText
        ? `<div class="spellcrafting-augment-group-limitation"><strong>Limitation:</strong> ${escapeHtml(limitationText)}</div>`
        : "";
      const entryHtml = groupEntries.map(({ entry, index }) => {
        const key = `spell-${getItemSourceKey(augmentItem)}-${index}`;
        const isSelected = !!state.selectedSpellAugments[key];
        const checked = isSelected ? "checked" : "";
        const count = isSelected ? state.selectedSpellAugments[key].count : 0;
        const repeatableHtml = entry.repeatable
          ? `
            <div class="spellcrafting-repeat-control">
              <button type="button" class="repeat-adjust" data-direction="-1" data-augment-key="${key}" data-augment-type="spell" ${checked ? "" : "disabled"}>-</button>
              <input class="repeat-count" type="number" min="0" max="99" value="${count}" data-augment-key="${key}" data-augment-type="spell" ${checked ? "" : "disabled"} />
              <button type="button" class="repeat-adjust" data-direction="1" data-augment-key="${key}" data-augment-type="spell" ${checked ? "" : "disabled"}>+</button>
            </div>
          `
          : "";
        const title = normalizeDisplayedSpellText(entry.title || `${getDisplaySpellName(augmentItem.name)} (${entry.cost >= 0 ? "+" : ""}${entry.cost})`);
        return `
          <div class="spellcrafting-augment-entry">
            <label>
              <input type="checkbox" data-augment-key="${key}" data-augment-type="spell" ${checked} />
              <strong>${escapeHtml(title)}</strong>
              <span class="augment-description">${escapeHtml(normalizeDisplayedSpellText(entry.description))}</span>
              ${repeatableHtml}
            </label>
          </div>
        `;
      }).join("");

      return `
        <div class="spellcrafting-augment-group">
          <div class="spellcrafting-augment-group-title">${escapeHtml(getDisplaySpellName(augmentItem.name))}</div>
          ${limitationHtml}
          ${entryHtml}
        </div>
      `;
    }).join("");
  }

  function renderLegacyLoadingState(html) {
    const loadingHtml = "<div class=\"spellcrafting-empty\">Loading Legacy spells...</div>";
    html.find(".spellcrafting-core-list").html(loadingHtml);
    html.find("#coreAugmentsContainer").html(loadingHtml);
  }

  function filterCoresByName(cores, filterText, state) {
    const normalizedFilter = String(filterText || "").trim().toLowerCase();
    if (!normalizedFilter) return cores;
    return (cores || []).filter((core) => getCachedDisplaySpellNameSearch(state, core).includes(normalizedFilter));
  }

  function bindDialogEvents(html, spellbooks, state, actor) {
    const dialogRoot = html.closest(".dialog");
    const eventRoot = dialogRoot.length ? dialogRoot : html;

    eventRoot.off("change", "#selectedSpellbook").on("change", "#selectedSpellbook", async (event) => {
      state.spellbookId = event.target.value;
      clearSelectedSpellData(state);
      await updateDialog(html, spellbooks, state, actor);
    });

    eventRoot.off("change", "#legacyPreparedCores").on("change", "#legacyPreparedCores", async (event) => {
      state.useLegacyPreparedCores = event.target.checked;
      state.classOnlyLegacyPreparedCores = state.useLegacyPreparedCores ? true : false;
      clearSelectedSpellData(state);
      if (state.useLegacyPreparedCores) {
        renderLegacyLoadingState(html);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await updateDialog(html, spellbooks, state, actor);
    });

    eventRoot.off("change", "#classOnlyLegacyPreparedCores").on("change", "#classOnlyLegacyPreparedCores", async (event) => {
      state.classOnlyLegacyPreparedCores = event.target.checked;
      clearSelectedSpellData(state);
      renderLegacyLoadingState(html);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await updateDialog(html, spellbooks, state, actor);
    });

    eventRoot.off("input", "#coreFilterInput").on("input", "#coreFilterInput", async (event) => {
      state.coreFilterText = String(event.target.value || "");
      const selectedCore = getActiveItemById(state, state.selectedCoreId);
      const matchesFilter = !selectedCore || filterCoresByName([selectedCore], state.coreFilterText, state).length > 0;
      if (coreFilterDebounceHandle) clearTimeout(coreFilterDebounceHandle);
      coreFilterDebounceHandle = setTimeout(() => {
        if (!matchesFilter) {
          clearSelectedSpellData(state);
        }
        renderCoreList(html, state);
        renderAugmentPanels(html, actor, state);
        renderSpellSummary(html, actor, state);
        renderActionButtons(html, state);
      }, FILTER_INPUT_DEBOUNCE_MS);
    });

    eventRoot.off("change", "input[name=selectedCore]").on("change", "input[name=selectedCore]", async (event) => {
      state.selectedCoreId = event.target.value;
      state.selectedCoreAugments = {};
      await updateDialog(html, spellbooks, state, actor);
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
      await updateDialog(html, spellbooks, state, actor);
    });

    eventRoot.off("change", ".repeat-count").on("change", ".repeat-count", async (event) => {
      const key = event.target.dataset.augmentKey;
      const type = event.target.dataset.augmentType;
      const selectedCollection = type === "core" ? state.selectedCoreAugments : state.selectedSpellAugments;
      const isSelected = !!selectedCollection[key];
      const minValue = isSelected ? 1 : 0;
      const fallbackValue = isSelected ? 1 : 0;
      const value = Math.min(99, Math.max(minValue, Number(event.target.value) || fallbackValue));
      event.target.value = value;
      if (isSelected) {
        selectedCollection[key].count = value;
      }
      await updateDialog(html, spellbooks, state, actor);
    });

    eventRoot.off("click", ".repeat-adjust").on("click", ".repeat-adjust", async (event) => {
      event.preventDefault();
      const button = event.currentTarget;
      if (button.disabled) return;
      const key = button.dataset.augmentKey;
      const type = button.dataset.augmentType;
      const direction = Number(button.dataset.direction) || 0;
      const selectedCollection = type === "core" ? state.selectedCoreAugments : state.selectedSpellAugments;
      if (!selectedCollection[key]) return;
      const nextValue = Math.min(99, Math.max(1, (selectedCollection[key].count || 1) + direction));
      selectedCollection[key].count = nextValue;
      await updateDialog(html, spellbooks, state, actor);
    });

    eventRoot.off("click", ".spellcrafting-cancel").on("click", ".spellcrafting-cancel", (event) => {
      event.preventDefault();
      dialog.close();
    });

    eventRoot.off("click", ".spellcrafting-add").on("click", ".spellcrafting-add", async (event) => {
      event.preventDefault();
      if (event.currentTarget.disabled) return;
      try {
        saveLastSelection();
        const customName = await promptForPreparedSpellName(actor, state);
        if (customName == null) return;
        await addBuiltSpellToSpellbook(actor, state, customName);
      } catch (err) {
        console.warn("Spellcrafting macro could not add built spell to spellbook.", err);
        ui.notifications.error(err?.message || "The spell could not be added to the spellbook.");
      }
    });

    eventRoot.off("click", ".spellcrafting-cast").on("click", ".spellcrafting-cast", async (event) => {
      event.preventDefault();
      if (event.currentTarget.disabled) return;
      try {
        saveLastSelection();
        const castSucceeded = await castBuiltSpell(actor, state);
        if (castSucceeded) dialog.close();
      } catch (err) {
        console.warn("Spellcrafting macro could not cast built spell.", err);
        ui.notifications.error(err?.message || "The spell could not be cast.");
      }
    });
  }

  async function updateDialog(html, spellbooks, state, actor) {
    await ensureSpellDataLoaded(actor, state);
    html.find("#selectedSpellbook").val(state.spellbookId);
    html.find("#coreFilterInput").val(state.coreFilterText || "");
    const legacyToggle = html.find("#legacyPreparedCores");
    const legacyToggleLabel = legacyToggle.closest(".spellcrafting-inline-toggle");
    const legacyEnabled = state.preparationMode === "prepared";
    legacyToggle.prop("checked", state.useLegacyPreparedCores);
    legacyToggle.prop("disabled", !legacyEnabled);
    legacyToggleLabel.toggleClass("disabled", !legacyEnabled);
    const classOnlyToggle = html.find("#classOnlyLegacyPreparedCores");
    const classOnlyToggleLabel = classOnlyToggle.closest(".spellcrafting-inline-toggle");
    const classOnlyEnabled = legacyEnabled && state.useLegacyPreparedCores;
    classOnlyToggleLabel.toggleClass("hidden", !state.useLegacyPreparedCores);
    classOnlyToggle.prop("checked", state.classOnlyLegacyPreparedCores);
    classOnlyToggle.prop("disabled", !classOnlyEnabled);
    classOnlyToggleLabel.toggleClass("disabled", !classOnlyEnabled);
    renderCoreList(html, state);
    renderAugmentPanels(html, actor, state);
    renderSpellSummary(html, actor, state);
    renderActionButtons(html, state);
  }

  function renderCoreList(html, state) {
    const coreContainer = html.find(".spellcrafting-core-list");
    const cores = filterCoresByName(state.availableCores, state.coreFilterText, state);
    if (cores.length) {
      coreContainer.html(cores.map((core) => {
        const coreKey = getItemSourceKey(core);
        const checked = coreKey === state.selectedCoreId ? "checked" : "";
        const selectedClass = checked ? " selected" : "";
        const titleText = escapeHtml(getCachedCoreHoverDescription(state, core));
        const schoolText = escapeHtml(getSpellSchool(core));
        const spellPointCost = getCoreHoverSpellPointCost(core, state);
        const iconSrc = escapeHtml(core?.img || "icons/svg/mystery-man.svg");
        return `<label class="spellcrafting-core-item${selectedClass}" title="${titleText}"><input type="radio" name="selectedCore" value="${coreKey}" ${checked} /><img class="spellcrafting-core-icon" src="${iconSrc}" alt="" loading="lazy" /><span class="spellcrafting-core-name">${escapeHtml(getCachedDisplaySpellName(state, core))}</span><span class="spellcrafting-core-meta"><span class="spellcrafting-core-school">${schoolText}</span><span class="spellcrafting-core-cost">${spellPointCost} SP</span></span></label>`;
      }).join(""));
      return;
    }

    const coreMessage = state.coreFilterText
      ? `No cores start with "${escapeHtml(state.coreFilterText.trim())}".`
      : state.preparationMode === "hybrid"
        ? "Hybrid spellbooks are not supported until the spellbook is set to Prepared or Spontaneous."
        : state.preparationMode === "prepared"
          ? state.useLegacyPreparedCores
            ? "No spells were found in the Pathfinder 'Spells' compendium."
            : "No cores were found in the Darkfinder 'Spell Cores' compendium."
          : "No cores found in the selected spellbook.";
    coreContainer.html(`<div class='spellcrafting-empty'>${coreMessage}</div>`);
  }

  function renderAugmentPanels(html, actor, state) {
    html.find("#coreAugmentsPanelTitle").text(
      state.preparationMode === "prepared" && state.useLegacyPreparedCores
        ? "Spell Preview"
        : "Core Augments",
    );
    html.find("#coreAugmentsContainer").html(buildCoreAugmentsHtml(actor, state));
    html.find("#spellAugmentsContainer").html(buildSpellAugmentsHtml(actor, state));
  }

  function renderSpellSummary(html, actor, state) {
    const totalSP = calculateTotalSP(actor, state);
    html.find("#totalSP").text(totalSP);
    html.find("#spellLevel").text(Math.max(0, Math.ceil(totalSP / 2)));
    const selectedCore = getActiveItemById(state, state.selectedCoreId);
    html.find("#spellSchool").text(selectedCore ? getSpellSchool(selectedCore) || "None" : "None");
  }

  function renderActionButtons(html, state) {
    const buttonState = getButtonState(state);
    html.find(".spellcrafting-cast").prop("disabled", !buttonState.canCast);
    html.find(".spellcrafting-add").prop("disabled", !buttonState.canAdd);
  }

  function calculateTotalSP(actor, state) {
    let total = getSelectedCoreBaseSP(actor, state);
    const coreEntries = getSelectedAugmentEntries(actor, state, "core");
    const spellEntries = getSelectedAugmentEntries(actor, state, "spell");
    for (const entry of [...coreEntries, ...spellEntries]) {
      total += entry.cost * entry.count;
    }
    return total;
  }

  function getSelectedAugmentEntries(actor, state, type) {
    return getSelectedAugmentDetails(actor, state, type).map((detail) => ({
      cost: detail.augment.cost,
      count: detail.count,
    }));
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
})();
