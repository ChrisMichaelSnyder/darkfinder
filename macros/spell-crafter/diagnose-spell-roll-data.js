// Foundry VTT 13 macro for Pathfinder 1e spell roll-data diagnostics

(async () => {
  const actor = canvas.tokens.controlled[0]?.actor || game.user.character;
  if (!actor) {
    return ui.notifications.warn("Please select a token or set an active character before running spell diagnostics.");
  }

  const spells = actor.items
    .filter((item) => item.type === "spell")
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }));

  if (!spells.length) {
    return ui.notifications.warn("No spell items were found on this actor.");
  }

  const optionHtml = spells
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.id)}</option>`)
    .join("");

  const content = `
    <div style="display:grid;gap:0.75rem;">
      <div>
        <label for="spellcrafting-diagnostic-spell" style="display:block;font-weight:700;margin-bottom:0.35rem;">Spell</label>
        <select id="spellcrafting-diagnostic-spell" style="width:100%;min-height:2.2rem;">${optionHtml}</select>
      </div>
    </div>
  `;

  const selectedSpellId = await new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    new Dialog({
      title: "Diagnose Spell Roll Data",
      content,
      buttons: {
        inspect: {
          label: "Inspect",
          callback: (html) => {
            settle(String(html.find("#spellcrafting-diagnostic-spell").val() || "").trim() || null);
          },
        },
        cancel: {
          label: "Cancel",
          callback: () => settle(null),
        },
      },
      default: "inspect",
      close: () => settle(null),
    }).render(true);
  });

  if (!selectedSpellId) return;

  const spell = actor.items.get(selectedSpellId);
  if (!spell) {
    return ui.notifications.warn("That spell could not be found on the actor.");
  }

  const actionEntries = getItemActionEntries(spell);
  const defaultAction = spell.defaultAction || actionEntries[0] || null;
  const itemRollData = safeInvoke(() => spell.getRollData?.() || {});
  const actionRollData = safeInvoke(() => defaultAction?.getRollData?.() || {});
  const labels = safeInvoke(() => spell.getLabels?.({
    actionId: defaultAction?.id || defaultAction?._id || null,
    rollData: actionRollData?.error ? itemRollData : actionRollData,
  }) || {});

  console.group("Spellcrafting Spell Roll Data Diagnostic");
  console.log("Actor:", {
    id: actor.id,
    name: actor.name,
    uuid: actor.uuid,
  });
  console.log("Spell:", {
    id: spell.id,
    name: spell.name,
    type: spell.type,
    systemSpellPointCost: spell.system?.spellPointCost,
    systemSpCost: spell.system?.spCost,
    systemSp: spell.system?.sp,
    systemSpellPointsCost: spell.system?.spellPoints?.cost,
  });
  console.log("Default action:", defaultAction ? {
    id: defaultAction.id || defaultAction._id || null,
    name: defaultAction.name || null,
    actionType: defaultAction.actionType || null,
    activation: defaultAction.activation,
    damage: defaultAction.damage,
    resourceFormula: defaultAction.resourceFormula,
    save: defaultAction.save,
    duration: defaultAction.duration,
    uses: defaultAction.uses,
    spellPointCost: defaultAction.spellPointCost,
    sp: defaultAction.sp,
  } : null);
  console.log("Item roll data candidates:", {
    itemSpellPointCost: itemRollData?.item?.spellPointCost,
    itemSpCost: itemRollData?.item?.spCost,
    itemSp: itemRollData?.item?.sp,
    itemSystemSpellPointCost: itemRollData?.item?.system?.spellPointCost,
    itemSystemSpCost: itemRollData?.item?.system?.spCost,
    itemSystemSp: itemRollData?.item?.system?.sp,
  });
  console.log("Action roll data candidates:", {
    itemSpellPointCost: actionRollData?.item?.spellPointCost,
    itemSpCost: actionRollData?.item?.spCost,
    itemSp: actionRollData?.item?.sp,
    itemSystemSpellPointCost: actionRollData?.item?.system?.spellPointCost,
    itemSystemSpCost: actionRollData?.item?.system?.spCost,
    itemSystemSp: actionRollData?.item?.system?.sp,
    actionSpellPointCost: actionRollData?.action?.spellPointCost,
    actionSp: actionRollData?.action?.sp,
  });
  console.log("Item roll data:", itemRollData);
  console.log("Action roll data:", actionRollData);
  console.log("Item labels:", labels);
  console.groupEnd();

  ui.notifications.info(`Spell roll-data diagnostic logged for ${spell.name}. Open the browser console to review it.`);

  function getItemActionEntries(itemData) {
    const actions = itemData?.system?.actions;
    if (!actions) return [];
    if (Array.isArray(actions)) return actions.filter((action) => action && typeof action === "object");
    if (typeof actions === "object") return Object.values(actions).filter((action) => action && typeof action === "object");
    return [];
  }

  function safeInvoke(callback) {
    try {
      return callback();
    } catch (err) {
      return { error: err?.message || String(err) };
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
})();
