(async () => {
  const MODULE_ID = "darkfinder";
  const FLAG_KEY = "concentrationTracker";
  const UPDATE_HOOK = `${MODULE_ID}.concentrationTrackerUpdated`;
  const GREEN = "#43a047";
  const RED = "#ff4c4c";

  const selectedToken = canvas.tokens.controlled[0] || null;
  const actor = selectedToken?.actor || game.user.character || null;
  const shouldAudit = game.user.isGM && !selectedToken;

  if (shouldAudit) {
    return renderAuditDialog();
  }

  if (!actor) {
    return ui.notifications.warn("Select a token or assign an active character before using Concentration Tracker.");
  }

  return renderActorDialog(actor, selectedToken || actor.getActiveTokens?.()[0] || null);

  function getObjectPath(object, path) {
    return path.reduce((current, key) => (current && current[key] !== undefined ? current[key] : null), object);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function normalizeAbilityKey(value) {
    const normalized = normalizeText(value).toLowerCase();
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

  function getStoredSpells(targetActor) {
    const payload = targetActor?.getFlag?.(MODULE_ID, FLAG_KEY) || {};
    return Array.isArray(payload?.spells) ? payload.spells : [];
  }

  async function saveStoredSpells(targetActor, spells) {
    await targetActor.setFlag(MODULE_ID, FLAG_KEY, { spells: spells || [] });
  }

  function calculateTotalSP(spells) {
    return (spells || []).reduce((sum, spell) => sum + Math.max(0, Number(spell?.spCost) || 0), 0);
  }

  function parseNumericValue(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      const match = value.trim().match(/[-+]?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    }
    if (typeof value === "object") {
      for (const key of ["total", "value", "mod", "bonus", "current"]) {
        const parsed = parseNumericValue(value[key]);
        if (parsed != null) return parsed;
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
      const parsed = parseNumericValue(value);
      if (parsed != null && options.include?.some((pattern) => pattern.test(keyText))) return path;
      if (value && typeof value === "object") {
        const nested = findNumericLeafPath(value, options, path);
        if (nested) return nested;
      }
    }
    return null;
  }

  function getActorAbilityModifier(targetActor, abilityKey) {
    const normalizedKey = normalizeAbilityKey(abilityKey);
    if (!normalizedKey) return null;
    const ability = getObjectPath(targetActor, ["system", "abilities", normalizedKey]);
    const explicit = parseNumericValue(ability?.mod ?? ability?.modifier ?? ability?.totalMod ?? ability?.abilityMod);
    if (explicit != null) return explicit;
    const score = parseNumericValue(ability?.total ?? ability?.value ?? ability?.score);
    return score == null ? null : Math.floor((score - 10) / 2);
  }

  function resolveSpellbookName(key, entry) {
    return entry?.name
      || entry?.label
      || getObjectPath(entry, ["spellbook", "name"])
      || getObjectPath(entry, ["book", "name"])
      || key
      || "Spellbook";
  }

  function getSpellbookEntries(targetActor) {
    const spellbooks = getObjectPath(targetActor, ["system", "attributes", "spells", "spellbooks"]);
    if (!spellbooks || typeof spellbooks !== "object") return [];
    return Object.entries(spellbooks)
      .filter(([, entry]) => entry && typeof entry === "object")
      .map(([key, entry]) => ({ key, entry, name: resolveSpellbookName(key, entry) }));
  }

  function getConcentrationBonusFromEntry(targetActor, entry) {
    const directPaths = [
      ["concentration", "total"],
      ["concentration", "value"],
      ["concentration", "bonus"],
      ["concentration"],
      ["concentrationBonus", "total"],
      ["concentrationBonus", "value"],
      ["concentrationBonus"],
      ["skill", "concentration"],
      ["skills", "concentration"],
      ["casting", "concentration"],
      ["spellcasting", "concentration"],
    ];
    for (const path of directPaths) {
      const parsed = parseNumericValue(getObjectPath(entry, path));
      if (parsed != null) return parsed;
    }

    const abilityKey = normalizeAbilityKey(
      getObjectPath(entry, ["ability"])
      || getObjectPath(entry, ["abilityKey"])
      || getObjectPath(entry, ["casting", "ability"])
      || getObjectPath(entry, ["spellcastingAbility"]),
    );
    const abilityMod = abilityKey ? getActorAbilityModifier(targetActor, abilityKey) : null;
    const casterLevel = parseNumericValue(
      getObjectPath(entry, ["cl", "total"])
      ?? getObjectPath(entry, ["cl", "value"])
      ?? getObjectPath(entry, ["cl"])
      ?? getObjectPath(entry, ["casterLevel", "total"])
      ?? getObjectPath(entry, ["casterLevel"])
      ?? getObjectPath(entry, ["level"]),
    );
    if (abilityMod != null || casterLevel != null) return Number(abilityMod || 0) + Number(casterLevel || 0);

    const foundPath = findNumericLeafPath(entry, {
      include: [/concentration/i],
      exclude: [/max/i, /base/i, /temp/i, /used/i, /spent/i, /cost/i],
    });
    if (foundPath) {
      const parsed = parseNumericValue(getObjectPath(entry, foundPath));
      if (parsed != null) return parsed;
    }

    return 0;
  }

  function getBestConcentrationData(targetActor) {
    const spellbooks = getSpellbookEntries(targetActor);
    const entries = spellbooks.length ? spellbooks : [{ key: "default", entry: {}, name: "Default" }];
    const ranked = entries.map((book) => ({
      ...book,
      bonus: getConcentrationBonusFromEntry(targetActor, book.entry),
    })).sort((left, right) => right.bonus - left.bonus);
    const best = ranked[0] || { key: "default", name: "Default", bonus: 0 };
    return {
      spellbookKey: best.key,
      spellbookName: best.name,
      concentrationBonus: Number(best.bonus) || 0,
      threshold: (Number(best.bonus) || 0) + 1,
      spellbookCount: spellbooks.length,
    };
  }

  function getPlayerActorsForAudit() {
    return game.actors
      .filter((candidate) => candidate?.type === "character" && candidate.hasPlayerOwner)
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }));
  }

  function buildStyles() {
    return `
      <style>
        .df-concentration-root { display:flex; flex-direction:column; gap:0.8rem; flex:1 1 auto; width:100%; height:100%; min-height:100%; overflow:hidden; box-sizing:border-box; background:#58544d; padding:0.9rem; border-radius:10px; color:#151412; }
        .df-concentration-panel { flex:0 0 auto; border:1px solid #7d7668; background:rgba(201,196,184,0.94); padding:0.9rem 1rem; border-radius:8px; overflow:hidden; box-shadow:0 1px 0 rgba(255,255,255,0.18) inset; box-sizing:border-box; }
        .df-concentration-panel h3 { margin:0 0 0.65rem; padding-bottom:0.35rem; border-bottom:1px solid #b85b4d; font-size:1.05rem; font-weight:800; color:#2c2a25; }
        .df-concentration-summary { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:0.7rem; }
        .df-concentration-stat { background:rgba(223,218,205,0.95); border:1px solid #8f8674; border-radius:6px; padding:0.6rem 0.75rem; box-sizing:border-box; }
        .df-concentration-label { display:block; font-size:0.72rem; font-weight:900; letter-spacing:0.06em; text-transform:uppercase; color:#5a554a; }
        .df-concentration-value { display:block; margin-top:0.2rem; font-size:1.65rem; font-weight:900; color:#191816; line-height:1; }
        .df-concentration-scroll-panel { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; height:100%; }
        .df-concentration-list { display:flex; flex-direction:column; gap:0.5rem; flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding-right:0.2rem; }
        .df-concentration-row { display:grid; grid-template-columns:auto minmax(0, 1fr) auto auto; align-items:center; gap:0.65rem; background:rgba(236,233,225,0.82); padding:0.5rem 0.65rem; border-radius:4px; color:#111; border:1px solid #9f9787; }
        .df-concentration-icon { width:2rem; height:2rem; object-fit:cover; border-radius:4px; border:1px solid rgba(89,82,66,0.35); background:rgba(255,255,255,0.75); }
        .df-concentration-name { min-width:0; overflow-wrap:anywhere; font-weight:800; }
        .df-concentration-cost { color:#6b4225; font-weight:900; white-space:nowrap; }
        .df-concentration-remove { width:1.85rem; min-width:1.85rem; height:1.85rem; padding:0; border:1px solid #9e916d; border-radius:4px; background:linear-gradient(to bottom, #ddd4b8, #c9bea0); color:#1c1914; font-size:1rem; font-weight:900; line-height:1; }
        .df-concentration-actions { display:flex; gap:0.75rem; justify-content:flex-end; flex:0 0 auto; }
        .df-concentration-actions button { flex:1 1 0; min-width:0; padding:0.55rem 0.8rem; font-weight:800; border:1px solid #9e916d; border-radius:4px; background:linear-gradient(to bottom, #ddd4b8, #c9bea0); color:#1c1914; }
        .df-concentration-empty { color:#555; font-style:italic; font-size:0.92rem; }
        .df-concentration-audit-list { display:flex; flex-direction:column; gap:0.45rem; flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding-right:0.2rem; }
        .df-concentration-audit-row { display:grid; grid-template-columns:minmax(0, 1fr); gap:0.3rem; align-items:start; background:rgba(236,233,225,0.82); border:1px solid #9f9787; border-radius:4px; padding:0.55rem 0.65rem; font-size:0.88rem; }
        .df-concentration-audit-name { font-weight:900; overflow-wrap:anywhere; }
        .df-concentration-audit-metrics { display:flex; flex-wrap:wrap; gap:0.75rem; }
        .df-concentration-audit-metric { white-space:nowrap; font-weight:800; color:#3b3528; }
        .df-concentration-audit-spells { min-width:0; display:grid; gap:0.18rem; color:#2f2d28; }
        .df-concentration-audit-spell { padding-left:1rem; overflow-wrap:anywhere; }
      </style>
    `;
  }

  function buildActorContent(targetActor) {
    const spells = getStoredSpells(targetActor);
    const totalSP = calculateTotalSP(spells);
    const concentration = getBestConcentrationData(targetActor);
    const overClass = totalSP > concentration.threshold ? " style=\"color:#8f2f23;\"" : "";
    const rows = spells.length
      ? spells.map((spell) => `
        <div class="df-concentration-row">
          <img class="df-concentration-icon" src="${escapeHtml(spell.img || "icons/svg/mystery-man.svg")}" alt="" />
          <div class="df-concentration-name">${escapeHtml(normalizeSpellName(spell.name) || "Concentration Spell")}</div>
          <div class="df-concentration-cost">${escapeHtml(String(Number(spell.spCost) || 0))} SP</div>
          <button type="button" class="df-concentration-remove" data-spell-id="${escapeHtml(spell.id || "")}" title="Stop concentrating">X</button>
        </div>
      `).join("")
      : "<div class=\"df-concentration-empty\">No concentration spells are currently tracked for this character.</div>";

    return `
      ${buildStyles()}
      <div class="df-concentration-root" data-df-concentration-actor-id="${escapeHtml(targetActor.id || "")}">
        <div class="df-concentration-panel">
          <h3>Concentration Tracker</h3>
          <div class="df-concentration-summary">
            <div class="df-concentration-stat">
              <span class="df-concentration-label">Total SP Being Concentrated On</span>
              <span class="df-concentration-value"${overClass}>${totalSP}</span>
            </div>
            <div class="df-concentration-stat">
              <span class="df-concentration-label">SP Threshold</span>
              <span class="df-concentration-value">${concentration.threshold}</span>
            </div>
          </div>
        </div>
        <div class="df-concentration-panel df-concentration-scroll-panel">
          <h3>Current Spells</h3>
          <div class="df-concentration-list">${rows}</div>
        </div>
        <div class="df-concentration-actions">
          <button type="button" class="df-concentration-roll">Roll Concentration</button>
          <button type="button" class="df-concentration-close">Close</button>
        </div>
      </div>
    `;
  }

  function buildAuditContent() {
    const actors = getPlayerActorsForAudit();
    const rows = actors.length
      ? actors.map((targetActor) => {
        const spells = getStoredSpells(targetActor);
        const totalSP = calculateTotalSP(spells);
        const concentration = getBestConcentrationData(targetActor);
        const spellHtml = spells.length
          ? spells.map((spell) => (
            `<div class="df-concentration-audit-spell">${escapeHtml(normalizeSpellName(spell.name) || "Spell")} (${escapeHtml(String(Number(spell.spCost) || 0))} SP)</div>`
          )).join("")
          : "<div class=\"df-concentration-audit-spell\">None</div>";
        return `
          <div class="df-concentration-audit-row">
            <div class="df-concentration-audit-name">${escapeHtml(targetActor.name || "Unknown")}</div>
            <div class="df-concentration-audit-metrics">
              <span class="df-concentration-audit-metric">Total: ${totalSP} SP</span>
              <span class="df-concentration-audit-metric">Threshold: ${concentration.threshold}</span>
            </div>
            <div class="df-concentration-audit-spells">${spellHtml}</div>
          </div>
        `;
      }).join("")
      : "<div class=\"df-concentration-empty\">No player-owned character actors were found.</div>";

    return `
      ${buildStyles()}
      <div class="df-concentration-root">
        <div class="df-concentration-panel">
          <h3>Concentration Audit</h3>
          <div class="df-concentration-empty">Player-owned actors and their currently tracked concentration spells.</div>
        </div>
        <div class="df-concentration-panel df-concentration-scroll-panel">
          <div class="df-concentration-audit-list">${rows}</div>
        </div>
        <div class="df-concentration-actions">
          <button type="button" class="df-concentration-close">Close</button>
        </div>
      </div>
    `;
  }

  function applyDialogSizing(html, dialog, width, height) {
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
  }

  async function rollConcentrationCheck(targetActor, token) {
    const concentration = getBestConcentrationData(targetActor);
    const roll = new Roll("1d20 + @bonus", { bonus: concentration.concentrationBonus });
    await roll.evaluate();

    const d20Result = Number(roll.dice?.[0]?.total ?? roll.terms?.find?.((term) => term?.faces === 20)?.total ?? 0);
    const isSuccess = Number(roll.total || 0) >= concentration.threshold;
    const badge = isSuccess
      ? `<span style="display:inline-block;padding:8px 24px;background-color:${GREEN};color:#ffffff;font-size:1.8em;font-weight:900;border-radius:8px;">SUCCESS</span>`
      : `<span style="display:inline-block;padding:8px 24px;background-color:${RED};color:#000000;font-size:1.8em;font-weight:900;border-radius:8px;">FAIL</span>`;
    const content = `
      <div class="chat-card" style="padding:4px 6px;">
        <header class="card-header flexrow" style="align-items:center;justify-content:space-between;">
          <h3 style="margin:0;font-size:1.2em;"><strong>Concentration Check</strong></h3>
        </header>
        <section class="card-content">
          <div class="dice-roll concentration-roll" style="margin-top:4px;">
            <div class="dice-result">
              <div class="dice-formula" style="font-size:1.05em;">
                <i class="fas fa-dice-d20"></i>
                <strong>${d20Result}</strong> ${concentration.concentrationBonus >= 0 ? "+" : "-"} ${Math.abs(concentration.concentrationBonus)}
                &nbsp;=&nbsp; <strong>${roll.total}</strong>
              </div>
            </div>
          </div>
          <div style="margin-top:6px;text-align:center;font-weight:700;">SP Threshold: ${concentration.threshold}</div>
          <div style="text-align:center;margin-top:10px;">${badge}</div>
        </section>
      </div>
    `;
    const messageData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: targetActor, token }),
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      rolls: [roll],
      content,
      sound: CONFIG.sounds.dice,
      flags: {
        [MODULE_ID]: {
          concentrationTrackerRoll: true,
        },
      },
    };
    ChatMessage.applyRollMode(messageData, game.settings.get("core", "rollMode"));
    await ChatMessage.create(messageData);
  }

  function bindActorEvents(html, dialog, targetActor, token) {
    const root = html.closest(".app.window-app, .dialog");
    root.off("click", ".df-concentration-close").on("click", ".df-concentration-close", (event) => {
      event.preventDefault();
      dialog.close();
    });
    root.off("click", ".df-concentration-roll").on("click", ".df-concentration-roll", async (event) => {
      event.preventDefault();
      await rollConcentrationCheck(targetActor, token);
    });
    root.off("click", ".df-concentration-remove").on("click", ".df-concentration-remove", async (event) => {
      event.preventDefault();
      const spellId = String(event.currentTarget.dataset.spellId || "");
      const spells = getStoredSpells(targetActor);
      const removed = spells.find((spell) => String(spell.id || "") === spellId);
      await saveStoredSpells(targetActor, spells.filter((spell) => String(spell.id || "") !== spellId));
      if (removed) ui.notifications.info(`${targetActor.name} stopped concentrating on ${removed.name}.`);
      refreshActorDialog(root, targetActor);
      bindActorEvents(html, dialog, targetActor, token);
    });
  }

  function refreshActorDialog(root, targetActor) {
    const nextRoot = $(buildActorContent(targetActor)).filter(".df-concentration-root");
    root.find(`.df-concentration-root[data-df-concentration-actor-id="${targetActor.id}"]`).replaceWith(nextRoot);
  }

  function bindAuditEvents(html, dialog) {
    const root = html.closest(".app.window-app, .dialog");
    root.off("click", ".df-concentration-close").on("click", ".df-concentration-close", (event) => {
      event.preventDefault();
      dialog.close();
    });
  }

  function renderActorDialog(targetActor, token) {
    let updateHandler = null;
    const dialog = new Dialog({
      title: "Concentration Tracker",
      content: buildActorContent(targetActor),
      buttons: {},
      width: 505,
      height: 720,
      resizable: true,
      close: () => {
        if (updateHandler) Hooks.off(UPDATE_HOOK, updateHandler);
      },
      render: function(html) {
        applyDialogSizing(html, dialog, 505, 720);
        bindActorEvents(html, dialog, targetActor, token);
        if (!updateHandler) {
          const root = html.closest(".app.window-app, .dialog");
          updateHandler = (updatedActor) => {
            if (String(updatedActor?.id || "") !== String(targetActor.id || "")) return;
            refreshActorDialog(root, targetActor);
            bindActorEvents(html, dialog, targetActor, token);
          };
          Hooks.on(UPDATE_HOOK, updateHandler);
        }
      },
    });
    dialog.render(true);
  }

  function renderAuditDialog() {
    const dialog = new Dialog({
      title: "Concentration Audit",
      content: buildAuditContent(),
      buttons: {},
      width: 600,
      height: 760,
      resizable: true,
      render: function(html) {
        applyDialogSizing(html, dialog, 600, 760);
        bindAuditEvents(html, dialog);
      },
    });
    dialog.render(true);
  }
})();
