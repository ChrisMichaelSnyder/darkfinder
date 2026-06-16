(async () => {
  if (!game.user?.isGM) {
    return ui.notifications.warn("Only a GM can run this macro.");
  }

  const macro = getSpellAttackMacro();
  if (!macro?.uuid) {
    return ui.notifications.warn("The Spell Attack macro could not be found.");
  }

  const actorCandidates = [];
  let totalCandidateSpells = 0;

  for (const actor of game.actors?.contents || []) {
    const spells = actor.items.filter((item) => {
      if (item.type !== "spell") return false;
      const description = getSpellDescription(item);
      return /spellcrafting-spell-attack-button/i.test(description);
    });

    if (!spells.length) continue;
    actorCandidates.push({ actor, spells });
    totalCandidateSpells += spells.length;
  }

  if (!actorCandidates.length) {
    return ui.notifications.info("No existing Spell Attack buttons were found on world actors.");
  }

  const confirmed = await promptForConfirmation(actorCandidates.length, totalCandidateSpells);
  if (!confirmed) return;

  let updatedSpellCount = 0;
  let skippedSpellCount = 0;
  let updatedActorCount = 0;

  for (const { actor, spells } of actorCandidates) {
    const updates = [];

    for (const spell of spells) {
      const nextDescription = rewriteSpellAttackButtonMarkup(actor, spell, macro);
      if (!nextDescription || nextDescription === getSpellDescription(spell)) {
        skippedSpellCount += 1;
        continue;
      }

      updates.push({
        _id: spell.id,
        "system.description.value": nextDescription,
      });
    }

    if (!updates.length) continue;

    await actor.updateEmbeddedDocuments("Item", updates);
    updatedActorCount += 1;
    updatedSpellCount += updates.length;
  }

  const skippedText = skippedSpellCount ? ` ${skippedSpellCount} spell(s) were already current or could not be updated.` : "";
  ui.notifications.info(`Updated ${updatedSpellCount} spell(s) across ${updatedActorCount} actor(s).${skippedText}`);

  async function promptForConfirmation(actorCount, spellCount) {
    const content = `
      <div style="display:grid;gap:0.8rem;line-height:1.35;">
        <p>This will scan all world actors and replace old spellcrafting <strong>Spell Attack</strong> buttons with the new auto-roll version.</p>
        <p><strong>Actors with candidate spells:</strong> ${actorCount}<br><strong>Candidate spells:</strong> ${spellCount}</p>
        <p>This is intended as a one-time migration for existing saved spells.</p>
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
        title: "Repair Spell Attack Buttons",
        content,
        buttons: {
          repair: {
            label: "Repair",
            callback: () => settle(true),
          },
          cancel: {
            label: "Cancel",
            callback: () => settle(false),
          },
        },
        default: "repair",
        close: () => settle(false),
      }).render(true);
    });
  }

  function rewriteSpellAttackButtonMarkup(actor, spell, macro) {
    const description = getSpellDescription(spell);
    if (!description) return "";

    const container = document.createElement("div");
    container.innerHTML = String(description);

    const rows = Array.from(container.querySelectorAll(".spellcrafting-spell-attack-row"));
    if (!rows.length) return "";

    const savingThrow = getDescriptionSavingThrowValue(spell);
    const spellbookId = getSpellbookRefs(spell)[0]?.id || getObjectPath(spell, ["system", "spellbookId"]) || getObjectPath(spell, ["system", "spellbook"]) || "";
    const spellName = getDisplaySpellName(spell.name || "");
    const replacementHtml = buildSpellAttackButtonHtml(actor, spellbookId, spell, spellName, savingThrow, macro);
    if (!replacementHtml) return "";

    const replacementTemplate = document.createElement("template");
    replacementTemplate.innerHTML = replacementHtml.trim();
    const replacementNode = replacementTemplate.content.firstElementChild;
    if (!replacementNode) return "";

    rows.forEach((row, index) => {
      if (index === 0) {
        row.replaceWith(replacementNode.cloneNode(true));
      } else {
        row.remove();
      }
    });

    return container.innerHTML;
  }

  function buildSpellAttackButtonHtml(actor, spellbookId, spell, spellName, savingThrowOverride = "", macro) {
    const savingThrow = getDescriptionSavingThrowValue(spell, savingThrowOverride);
    if (!shouldShowSpellAttackButton(spell, savingThrow)) return "";

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
          data-spell-school="${escapeHtml(getSpellSchool(spell) || "")}"
          data-saving-throw="${escapeHtml(savingThrow)}"
          data-spell-name="${escapeHtml(spellName || getDisplaySpellName(spell?.name || ""))}"
          style="display:inline-flex;align-items:center;justify-content:center;padding:0.56rem 1rem;border:1px solid #8f8674;border-radius:5px;background:linear-gradient(to bottom, #ddd4b8, #c9bea0);color:#1c1914;font-weight:700;font-size:1.15rem;line-height:1;cursor:pointer;text-decoration:none;"
        ><i class="fas fa-bolt" style="margin-right:0.45rem;"></i>Spell Attack</a>
      </div>
    `;
  }

  function getSpellAttackMacro() {
    return game.macros?.find((entry) => String(entry?.name || "").trim().toLowerCase() === "spell attack") || null;
  }

  function getDescriptionSavingThrowValue(spell, savingThrowOverride = "") {
    const explicitSavingThrow = String(savingThrowOverride || "").trim();
    if (explicitSavingThrow) return explicitSavingThrow;

    const fromDescription = parseSavingThrowFromDescription(getSpellDescription(spell));
    if (fromDescription) return fromDescription;

    return String(getSpellSavingThrow(spell) || "").trim();
  }

  function parseSavingThrowFromDescription(description) {
    const plaintext = stripHtmlTags(description);
    const match = plaintext.match(/(?:^|\n)\s*Saving Throw:\s*([^\n\r]+)/i);
    return match?.[1] ? match[1].trim() : "";
  }

  function shouldShowSpellAttackButton(spell, savingThrowOverride = "") {
    const savingThrow = getDescriptionSavingThrowValue(spell, savingThrowOverride);
    return !!savingThrow && savingThrow.toLowerCase() !== "none";
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

  function getSpellSavingThrow(item) {
    const searchPaths = [
      ["system", "save", "description"],
      ["system", "save", "type"],
      ["system", "savingThrow"],
      ["system", "save"],
      ["data", "savingThrow"],
    ];
    for (const path of searchPaths) {
      const value = getObjectPath(item, path);
      const normalized = normalizeAttributeValue(value);
      if (normalized) return normalized;
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
