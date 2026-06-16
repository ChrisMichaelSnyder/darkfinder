(async () => {
  const invocationScope = typeof scope !== "undefined" && scope ? scope : {};
  const clickEvent = typeof event !== "undefined" ? event : globalThis.event;
  const clickedLink = clickEvent?.currentTarget instanceof HTMLElement
    ? clickEvent.currentTarget
    : clickEvent?.target?.closest?.("[data-spellcrafting-spell-attack='true']");
  const linkDataset = clickedLink?.dataset || {};

  const actor = await resolveInvocationActor(invocationScope, linkDataset)
    || canvas.tokens.controlled[0]?.actor
    || game.user.character;
  if (!actor) {
    return ui.notifications.warn("Please select a token or set an active character before using Spell Attack.");
  }

  const SESSION_KEY = `pf1-spellcrafting-spell-attack-${actor.id}`;
  const spellbooks = getSpellbooks(actor);
  if (!spellbooks.length) {
    return ui.notifications.warn("No spellbooks found on this actor.");
  }

  const lastSettings = loadLastSettings();
  const invocationDefaults = getInvocationDefaults(invocationScope, linkDataset);
  const defaultSpellbookId = getCanonicalSpellbookKey(actor, invocationDefaults.spellbookId, spellbooks)
    || getPrimarySpellbookId(actor, spellbooks)
    || spellbooks[0]?.id
    || "";
  const defaultSchool = String(invocationDefaults.school || lastSettings.school || "").trim();
  const defaultSavingThrow = String(invocationDefaults.savingThrow || lastSettings.savingThrow || "").trim();
  const spellLabel = String(invocationDefaults.spellName || "").trim();

  const schoolOptions = [
    { value: "", label: "None / Unspecified" },
    { value: "Abjuration", label: "Abjuration" },
    { value: "Conjuration", label: "Conjuration" },
    { value: "Divination", label: "Divination" },
    { value: "Enchantment", label: "Enchantment" },
    { value: "Evocation", label: "Evocation" },
    { value: "Illusion", label: "Illusion" },
    { value: "Necromancy", label: "Necromancy" },
    { value: "Transmutation", label: "Transmutation" },
    { value: "Universal", label: "Universal" },
  ];
  const saveOptions = [
    { value: "", label: "None / Unspecified" },
    { value: "Fortitude", label: "Fortitude" },
    { value: "Reflex", label: "Reflex" },
    { value: "Will", label: "Will" },
  ];

  const content = `
    <style>
      .darkfinder-spell-attack-form { display:grid; gap:0.8rem; padding:0.2rem 0; }
      .darkfinder-spell-attack-field { display:grid; gap:0.35rem; }
      .darkfinder-spell-attack-field label { font-weight:700; }
      .darkfinder-spell-attack-field input,
      .darkfinder-spell-attack-field select {
        width:100%;
        min-height:2.2rem;
        padding:0.4rem 0.55rem;
        border:1px solid #8f8673;
        border-radius:4px;
        background:#e4dfd3;
        color:#161616;
      }
      .darkfinder-spell-attack-help { color:#5a554a; font-size:0.88rem; line-height:1.25; }
    </style>
    <div class="darkfinder-spell-attack-form">
      <div class="darkfinder-spell-attack-field">
        <label for="darkfinder-spellbook">Spellbook</label>
        <select id="darkfinder-spellbook">
          ${spellbooks.map((book) => `<option value="${escapeHtml(String(book.id))}" ${String(book.id) === String(defaultSpellbookId) ? "selected" : ""}>${escapeHtml(book.name)}</option>`).join("")}
        </select>
      </div>
      <div class="darkfinder-spell-attack-field">
        <label for="darkfinder-school">School</label>
        <select id="darkfinder-school">
          ${schoolOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === defaultSchool ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </div>
      <div class="darkfinder-spell-attack-field">
        <label for="darkfinder-save">Saving Throw</label>
        <select id="darkfinder-save">
          ${saveOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === defaultSavingThrow ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </div>
      <div class="darkfinder-spell-attack-help">
        School and saving throw are optional. Leaving school blank skips school-specific DC bonuses.
      </div>
    </div>
  `;

  const submitted = await new Promise((resolve) => {
    new Dialog({
      title: spellLabel ? `Spell Attack: ${spellLabel}` : "Spell Attack",
      content,
      buttons: {
        roll: {
          label: "Roll",
          callback: (html) => {
            resolve({
              spellbookId: String(html.find("#darkfinder-spellbook").val() || ""),
              school: String(html.find("#darkfinder-school").val() || "").trim(),
              savingThrow: String(html.find("#darkfinder-save").val() || "").trim(),
            });
          },
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null),
        },
      },
      default: "roll",
      close: () => resolve(null),
    }).render(true);
  });

  if (!submitted?.spellbookId) return;
  saveLastSettings({
    school: submitted.school,
    savingThrow: submitted.savingThrow,
  });

  const attackData = getSpellAttackData(actor, submitted.spellbookId, submitted.school);
  const roll = new Roll(attackData.formulaText);
  await roll.evaluate();
  const d20Result = Number(roll.dice?.[0]?.total ?? roll.terms?.find?.((term) => term?.faces === 20)?.total ?? 0);
  const dcBonusTooltip = attackData.dcBonusTotal ? ` + ${attackData.dcBonusTotal} [Spell DC Bonuses]` : "";
  const tooltipText = `${d20Result} [1d20] + ${attackData.casterLevelHalf} [CL/2] + ${attackData.abilityMod} [${attackData.abilityLabel}]${dcBonusTooltip}`;
  const saveHtml = submitted.savingThrow
    ? `<span style="margin-top:0.18rem;font-size:0.98rem;font-weight:700;line-height:1.08;color:#3e3424;">${escapeHtml(submitted.savingThrow)}</span>`
    : "";

  const resultContent = `
    <div class="spellcrafting-spell-attack-result" style="display:flex;justify-content:center;padding:0.15rem 0;">
      <div title="${escapeHtml(tooltipText)}" style="min-width:208px;max-width:100%;padding:0.75rem 0.85rem;border:1px solid #b6a16e;border-radius:8px;background:linear-gradient(180deg, #f6f1e5 0%, #e8dfcf 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.55), 0 2px 5px rgba(0,0,0,0.08);text-align:center;cursor:help;">
        <div style="font-size:0.7rem;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:#6b5c3d;">Spell Attack</div>
        <div style="margin-top:0.22rem;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <span class="spellcrafting-spell-attack-total" style="font-weight:900;font-size:2rem;line-height:1;color:#1f1a12;">${escapeHtml(String(roll.total))}</span>
          ${saveHtml}
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

  function loadLastSettings() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn("Spell Attack macro could not read last settings.", err);
      return {};
    }
  }

  function saveLastSettings(data) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data || {}));
    } catch (err) {
      console.warn("Spell Attack macro could not save last settings.", err);
    }
  }

  function getPrimarySpellbookId(actor, spellbooks) {
    const primaryCandidates = [
      getObjectPath(actor, ["system", "attributes", "spells", "spellbooks", "primary", "id"]),
      getObjectPath(actor, ["system", "attributes", "spells", "spellbooks", "primary", "key"]),
      getObjectPath(actor, ["system", "attributes", "spells", "spellbooks", "primary", "name"]),
      "primary",
    ].filter((value) => value != null && value !== "");

    for (const candidate of primaryCandidates) {
      const resolved = getCanonicalSpellbookKey(actor, candidate, spellbooks);
      if (resolved) return resolved;
    }

    const explicitPrimary = spellbooks.find((book) => String(book.id).toLowerCase() === "primary" || String(book.name || "").trim().toLowerCase() === "primary");
    return explicitPrimary?.id || null;
  }

  function getObjectPath(object, path) {
    return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), object);
  }

  function getInvocationDefaults(invocationScope, linkDataset) {
    return {
      spellbookId: String(invocationScope.spellbookId || linkDataset.spellbookId || "").trim(),
      school: String(invocationScope.school || linkDataset.spellSchool || "").trim(),
      savingThrow: String(invocationScope.savingThrow || linkDataset.savingThrow || "").trim(),
      spellName: String(invocationScope.spellName || linkDataset.spellName || "").trim(),
    };
  }

  async function resolveInvocationActor(invocationScope, linkDataset) {
    const actorUuid = String(invocationScope.actorUuid || linkDataset.actorUuid || "").trim();
    if (!actorUuid) return null;
    try {
      return await fromUuid(actorUuid);
    } catch (err) {
      console.warn("Spell Attack macro could not resolve actor from UUID.", err);
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

    const explicitModPaths = [["mod"], ["modifier"], ["totalMod"], ["abilityMod"]];
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

    const discoveredPath = findNumericLeafPath(entry, {
      include: [/^cl$/i, /caster.*level/i, /spellcasting.*level/i],
      exclude: [/max/i, /base/i, /temp/i, /used/i, /spent/i, /cost/i],
    });
    return discoveredPath ? Number(getObjectPath(entry, discoveredPath) || 0) : null;
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
})();
