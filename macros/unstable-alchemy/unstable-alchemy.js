// Perfect Concoction - Interactive Chat Card
// Foundry VTT v13 / Pathfinder 1e 11.8

(async () => {
  const NS = "world";
  const FLAG_KEY = "perfectConcoctionData";

  window.PerfectConcoction ??= {};
  const PC = window.PerfectConcoction;

  PC.escapeHtml = function (value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  };

  PC.getNumericSkillBonus = function (actor) {
    const subSkills = foundry.utils.getProperty(actor, "system.skills.crf.subSkills") ?? {};

    for (const skill of Object.values(subSkills)) {
      const name = String(skill.name ?? skill.label ?? "").trim().toLowerCase();

      if (name === "alchemy" || name === "craft (alchemy)" || name.includes("alchemy")) {
        if (Number.isFinite(skill.mod)) return Number(skill.mod);
        if (Number.isFinite(skill.total)) return Number(skill.total);
        if (Number.isFinite(skill.value)) return Number(skill.value);
      }
    }

    return null;
  };

  PC.getClassLevel = function (cls) {
    return (
      Number(cls.system?.levels) ||
      Number(cls.system?.level) ||
      Number(cls.system?.classLevel) ||
      Number(cls.system?.data?.levels) ||
      0
    );
  };

  PC.getHitDiceCount = function (actor) {
    const directPaths = [
      foundry.utils.getProperty(actor, "system.attributes.hd.total"),
      foundry.utils.getProperty(actor, "system.attributes.hd.value"),
      foundry.utils.getProperty(actor, "system.attributes.hd"),
      foundry.utils.getProperty(actor, "system.details.level.value"),
      foundry.utils.getProperty(actor, "system.details.level.total")
    ];

    for (const value of directPaths) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
    }

    const classLevels = (actor?.items ?? [])
      .filter(item => item.type === "class")
      .reduce((sum, cls) => sum + PC.getClassLevel(cls), 0);

    if (classLevels > 0) return Math.floor(classLevels);
    return 1;
  };

  PC.extraSpellPointCost = function (data) {
    const belowBy = (data.low ?? 0) - (data.finalResult ?? 0);
    return belowBy > 0 ? 1 + Math.floor((belowBy - 1) / 5) : 0;
  };

  PC.canFinishConcoction = function (data) {
    return !!(data?.accepted && !data.finished && (PC.explosionChance(data) > 0 || PC.extraSpellPointCost(data) > 0));
  };

  PC.applyExplosionDamage = async function (actor, amount) {
    const hpPath = "system.attributes.hp.value";
    const current = Number(foundry.utils.getProperty(actor, hpPath) ?? 0) || 0;
    const next = Math.max(0, current - Math.max(0, Number(amount) || 0));
    await actor.update({ [hpPath]: next });
    return { current, next };
  };

  PC.spendPrimarySpellPoints = async function (actor, amount) {
    const spPath = "system.attributes.spells.spellbooks.primary.spellPoints.value";
    const current = Number(foundry.utils.getProperty(actor, spPath) ?? 0) || 0;
    const next = Math.max(0, current - Math.max(0, Number(amount) || 0));
    await actor.update({ [spPath]: next });
    return { current, next };
  };

  PC.resultState = function (result, low, high) {
    if (result >= low && result <= high) {
      return { label: "Stable", color: "#2e8b57", range: `${low}-${high}` };
    }

    if (result > high) {
      const maxMiss = Math.max(1, 100 - high);
      const miss = result - high;
      const q = maxMiss / 4;

      if (miss <= q) return { label: "Slightly Unstable!", color: "#4f8a4b", range: `${high + 1}-${Math.floor(high + q)}` };
      if (miss <= q * 2) return { label: "Very Unstable!!", color: "#8a7a34", range: `${Math.floor(high + q) + 1}-${Math.floor(high + q * 2)}` };
      if (miss <= q * 3) return { label: "Extremely Unstable!!!", color: "#a84a2d", range: `${Math.floor(high + q * 2) + 1}-${Math.floor(high + q * 3)}` };
      return { label: "Dangerously Unstable!!!!", color: "#8b1717", range: `${Math.floor(high + q * 3) + 1}-100` };
    }

    const maxMiss = Math.max(1, low - 1);
    const miss = low - result;
    const q = maxMiss / 4;

    if (miss <= q) return { label: "Slightly Weak.", color: "#2f8a73", range: `${Math.ceil(low - q)}-${low - 1}` };
    if (miss <= q * 2) return { label: "Very Weak..", color: "#287c9a", range: `${Math.ceil(low - q * 2)}-${Math.ceil(low - q) - 1}` };
    if (miss <= q * 3) return { label: "Extremely Weak...", color: "#2360b0", range: `${Math.ceil(low - q * 3)}-${Math.ceil(low - q * 2) - 1}` };
    return { label: "Pathetically Weak....", color: "#173d8f", range: `1-${Math.ceil(low - q * 3) - 1}` };
  };

  PC.needsText = function (state, low, high) {
    const [rangeMin, rangeMax] = state.range.split("-").map(Number);
    if (rangeMin > high) return `Needs to be: ${rangeMin - high}-${rangeMax - high} Lower`;
    if (rangeMax < low) return `Needs to be: ${low - rangeMax}-${low - rangeMin} Higher`;
    return "Needs: None";
  };

  PC.badge = function (state, tooltip = "") {
    const safeTooltip = PC.escapeHtml(tooltip).replaceAll("\n", "&#10;");

    return `
      <div style="display:flex; justify-content:center; margin-top:12px;" title="${safeTooltip}">
        <div style="
          min-width:180px;
          padding:10px 16px;
          border-radius:8px;
          border:1px solid rgba(255,255,255,0.35);
          background:linear-gradient(180deg, rgba(255,255,255,0.22), rgba(0,0,0,0.18)), ${state.color};
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.4);
          color:white;
          font-weight:bold;
          text-transform:uppercase;
          text-align:center;
          letter-spacing:0.05em;
          font-size:1.2em;
        ">
          ${state.label}
        </div>
      </div>
    `;
  };

  PC.explosionChance = function (data) {
    const aboveBy = (data.finalResult ?? 0) - data.high;
    return aboveBy > 0 ? aboveBy * 2 : 0;
  };

  PC.dieFormulaForCount = count => count > 0 ? `${count}d20` : "0";

  PC.makeRollModeChatData = function (data) {
    const rollMode = game.settings.get("core", "rollMode");
    if (ChatMessage.applyMode) return ChatMessage.applyMode(data, rollMode);
    if (ChatMessage.applyRollMode) return ChatMessage.applyRollMode(data, rollMode);
    return data;
  };

  PC.stabilizerTable = function (data, includeButtons = true) {
    function row(label, value, decAction, incAction) {
      const valueCell = includeButtons ? `
        <div style="display:flex; justify-content:center; align-items:center; gap:8px;">
          <button type="button" class="pc-btn" data-action="${decAction}" disabled style="width:28px; opacity:0.45; cursor:not-allowed; pointer-events:none;">−</button>
          <span style="display:inline-block; min-width:28px; font-weight:bold;">${value}</span>
          <button type="button" class="pc-btn" data-action="${incAction}" disabled style="width:28px; opacity:0.45; cursor:not-allowed; pointer-events:none;">+</button>
        </div>
      ` : `
        <span style="display:inline-block; min-width:28px; font-weight:bold;">${value}</span>
      `;

      return `
        <tr>
          <td style="font-weight:bold; padding:6px; border:1px solid rgba(0,0,0,0.25);">${label}</td>
          <td style="padding:6px; border:1px solid rgba(0,0,0,0.25);">${valueCell}</td>
        </tr>
      `;
    }

    return `
      <table style="
  width:90%;
  margin:4px auto 2px auto;
  text-align:center;
  border-collapse:collapse;
">
        ${row("Catalysts", data.catalysts, "dec-catalyst", "inc-catalyst")}
        ${row("Diluents", data.diluents, "dec-diluent", "inc-diluent")}
      </table>
    `;
  };

  PC.renderInitialCard = function (data) {
    const state = PC.resultState(data.initialResult, data.low, data.high);

    const tooltip = [
      `Stable Window: ${data.low}-${data.high}`,
      `Current Window: ${state.range}`,
      PC.needsText(state, data.low, data.high)
    ].join("\n");

    const controls = state.label === "Stable" ? "" : `
      <hr style="margin:6px 0;">

      <div style="font-weight:bold; font-size:1.05em; margin-bottom:3px;">
        Add stabilizers?
      </div>
      <div style="font-weight:bold; font-size:1.05em; margin-bottom:3px;">
        (1d20 each)
      </div>

      ${PC.stabilizerTable(data, !data.accepted)}

      ${!data.accepted ? `
        <div style="display:flex; justify-content:center; margin-top:8px;">
          <button type="button" class="pc-btn pc-accept-btn" data-action="accept" disabled style="font-weight:bold; padding:4px 12px; opacity:0.45; cursor:not-allowed; pointer-events:none;">
            Accept
          </button>
        </div>
      ` : ""}
    `;

    return `
      <div class="pf1e chat-card perfect-concoction-card" style="padding:10px; text-align:center;">
        <div style="font-weight:bold; font-size:1.15em;">
          ${PC.escapeHtml(data.actorName)} begins mixing a new concoction.
        </div>

        <div style="font-weight:bold; font-size:1.15em; margin-top:4px;">
          It is currently...
        </div>

        ${PC.badge(state, tooltip)}
        ${controls}
      </div>
    `;
  };

  PC.finalEffectBlock = function (data) {
    const belowBy = data.low - data.finalResult;
    const aboveBy = data.finalResult - data.high;

    if (belowBy > 0) {
      const penalty = PC.extraSpellPointCost(data);
      const tooltip = `Below Perfect Window by: ${belowBy}\nPenalty: 1 + floor((${belowBy} - 1) / 5) = ${penalty}`;
      const finishOutcome = !data.finished
        ? ""
        : `
          <div style="margin-top:12px; color:#2360b0; font-weight:bold; font-size:1.2em;">
            You spend the extra ${penalty} SP to keep the concoction alive!
          </div>
        `;
      const finishBlock = `
        <div style="margin-top:12px; font-weight:bold; font-size:1.0em;">
          Do you want to Finish your concoction or Scrap it?
        </div>
        <div style="display:flex; justify-content:center; margin-top:8px;">
          <button type="button" class="pc-btn pc-finish-btn" data-action="finish" disabled style="font-weight:bold; padding:4px 12px; opacity:0.45; cursor:not-allowed; pointer-events:none;">
            Finish
          </button>
        </div>
        ${finishOutcome}
      `;

      return `
        <div style="margin-top:6px; text-align:center;">
          <div style="font-weight:bold; font-size:1.0em; margin-bottom:4px;">
            The concoction costs additional SP to stay effective!
          </div>

          <div title="${PC.escapeHtml(tooltip).replaceAll("\n", "&#10;")}" style="
            color:#2360b0;
            font-weight:bold;
            font-size:2.2em;
          ">
            -${penalty}
          </div>

          ${finishBlock}
        </div>
      `;
    }

    if (aboveBy > 0) {
      const chance = PC.explosionChance(data);
      const tooltip = `Above Perfect Window by: ${aboveBy}\nExplosion Chance: ${aboveBy} x 2 = ${chance}%`;
      const finishOutcome = !data.finished
        ? ""
        : data.exploded
          ? `
            <div style="margin-top:12px; color:#b00000; font-weight:bold; font-size:1.2em;">
              Your concoction EXPLODES in your face!
            </div>
            <div style="margin-top:8px; font-weight:bold; font-size:1.3em;">
              Damage: <span style="color:#b00000; font-size:1.15em;">${data.explosionDamageTotal ?? 0}</span>
            </div>
          `
          : `
            <div style="margin-top:12px; font-weight:bold; font-size:1.0em;">
              Nothing exciting happens, the concoction functions normally.
            </div>
          `;
      const finishBlock = `
          <div style="margin-top:12px; font-weight:bold; font-size:1.0em;">
            Do you want to Finish your concoction or Scrap it?
          </div>
          <div style="display:flex; justify-content:center; margin-top:8px;">
            <button type="button" class="pc-btn pc-finish-btn" data-action="finish" disabled style="font-weight:bold; padding:4px 12px; opacity:${data.finished ? "0.45" : "0.45"}; cursor:not-allowed; pointer-events:none;">
              Finish
            </button>
          </div>
          ${finishOutcome}
        `;

      return `
        <div style="margin-top:6px; text-align:center;">
          <div style="font-weight:bold; font-size:1.0em; margin-bottom:4px;">
            The concoction has a chance to Explode!
          </div>

          <div title="${PC.escapeHtml(tooltip).replaceAll("\n", "&#10;")}" style="
            color:#b00000;
            font-weight:bold;
            font-size:2.2em;
          ">
            ${chance}%
          </div>

          ${finishBlock}
        </div>
      `;
    }

    return "";
  };

  PC.renderFinalCard = function (data) {
    const state = PC.resultState(data.finalResult, data.low, data.high);
  
    const tooltip = [
      `Perfect Window: ${data.low}-${data.high}`,
      `Initial d100: ${data.initialResult}`,
      `Catalysts Added: ${data.catalysts}`,
      `Catalyst Result: +${data.catalystTotal} (${data.catalystFormula})`,
      `Diluents Added: ${data.diluents}`,
      `Diluent Result: -${data.diluentTotal} (${data.diluentFormula})`,
      `Final Result: ${data.initialResult} + ${data.catalystTotal} - ${data.diluentTotal} = ${data.finalResult}`
    ].join("\n");
  
    return `
      <div class="pf1e chat-card perfect-concoction-card" style="padding:10px; text-align:center;">
        <hr style="margin:6px 0;">
  
        <div style="font-weight:bold; font-size:1.1em;">
          After adding the above stabilizers
        </div>
  
        <div style="font-weight:bold; font-size:1.1em; margin-top:2px;">
          the resulting concoction is now...
        </div>
  
        <div style="margin-bottom:12px;">
          ${PC.badge(state, tooltip)}
        </div>
  
        ${PC.finalEffectBlock(data)}
      </div>
    `;
  };

  PC.findMessageFromButton = function (button) {
    const messageElement = button.closest("[data-message-id]");
    const messageId = messageElement?.dataset?.messageId ?? messageElement?.getAttribute("data-message-id");
    return messageId ? game.messages.get(messageId) : null;
  };

  PC.updateButtonOwnershipState = function () {
    document.querySelectorAll(".perfect-concoction-card").forEach(card => {
      const messageElement = card.closest("[data-message-id]");
      const messageId = messageElement?.dataset?.messageId;
      const message = messageId ? game.messages.get(messageId) : null;
      const data = message?.getFlag(NS, FLAG_KEY);

      if (!data) return;

      const isOwner = game.user.id === data.ownerUserId;
      const canFinish = PC.canFinishConcoction(data);

      card.querySelectorAll(".pc-btn").forEach(btn => {
        if (isOwner && (!data.accepted || canFinish)) {
          btn.disabled = false;
          btn.style.opacity = "";
          btn.style.cursor = "";
          btn.style.pointerEvents = "";
          btn.title = "";
          return;
        }

        btn.disabled = true;
        btn.style.opacity = "0.45";
        btn.style.cursor = "not-allowed";
        btn.style.pointerEvents = "none";
        btn.title = isOwner
          ? "This concoction has already been stabilized."
          : "Only the character mixing this concoction can adjust it.";
      });
    });
  };

  PC.handleButton = async function (button) {
    const message = PC.findMessageFromButton(button);
    if (!message) return ui.notifications.error("Could not find the chat message for this button.");

    const data = foundry.utils.deepClone(message.getFlag(NS, FLAG_KEY));
    if (!data) return;

    if (game.user.id !== data.ownerUserId) {
      PC.updateButtonOwnershipState();
      return ui.notifications.warn("Only the character mixing this concoction can adjust it.");
    }

    const action = button.dataset.action;
    const canFinish = PC.canFinishConcoction(data);

    if (action === "finish") {
      if (!canFinish) return;

      const actorDoc = data.actorUuid ? await fromUuid(data.actorUuid) : null;
      const chance = PC.explosionChance(data);
      const extraSP = PC.extraSpellPointCost(data);
      const finishRoll = chance > 0 ? await new Roll("1d100").evaluate() : null;

      data.finished = true;
      data.finishRollTotal = chance > 0 ? finishRoll.total : null;
      data.exploded = chance > 0 ? finishRoll.total <= chance : false;
      data.explosionDamageFormula = null;
      data.explosionDamageTotal = null;

      const rolls = [...(message.rolls ?? [])];

      if (chance > 0) {
        rolls.push(finishRoll);
      }

      if (data.exploded) {
        const hitDiceCount = PC.getHitDiceCount(actorDoc);
        const damageFormula = `${hitDiceCount}d6`;
        const damageRoll = await new Roll(damageFormula).evaluate();

        data.explosionDamageFormula = damageFormula;
        data.explosionDamageTotal = damageRoll.total;
        rolls.push(damageRoll);
        if (actorDoc) await PC.applyExplosionDamage(actorDoc, damageRoll.total);
      } else if (extraSP > 0) {
        if (actorDoc) await PC.spendPrimarySpellPoints(actorDoc, extraSP);
      }

      await message.update({
        content: PC.renderInitialCard(data) + PC.renderFinalCard(data),
        rolls,
        [`flags.${NS}.${FLAG_KEY}`]: data
      });

      setTimeout(() => {
        PC.updateButtonOwnershipState();
        ui.chat.scrollBottom();
      }, 100);
      return;
    }

    if (data.accepted) return;

    if (action === "inc-catalyst") data.catalysts++;
    if (action === "dec-catalyst") data.catalysts = Math.max(0, data.catalysts - 1);
    if (action === "inc-diluent") data.diluents++;
    if (action === "dec-diluent") data.diluents = Math.max(0, data.diluents - 1);

    if (action !== "accept") {
      await message.update({
        content: PC.renderInitialCard(data),
        [`flags.${NS}.${FLAG_KEY}`]: data
      });
      setTimeout(() => PC.updateButtonOwnershipState(), 50);
      return;
    }

    const catalystFormula = PC.dieFormulaForCount(data.catalysts);
    const diluentFormula = PC.dieFormulaForCount(data.diluents);

    const catalystRoll = await new Roll(catalystFormula).evaluate();
    const diluentRoll = await new Roll(diluentFormula).evaluate();

    data.accepted = true;
    data.catalystFormula = catalystFormula;
    data.diluentFormula = diluentFormula;
    data.catalystTotal = catalystRoll.total;
    data.diluentTotal = diluentRoll.total;
    data.finalResult = data.initialResult + data.catalystTotal - data.diluentTotal;
    data.finished = false;
    data.finishRollTotal = null;
    data.exploded = false;
    data.explosionDamageFormula = null;
    data.explosionDamageTotal = null;

    await message.update({
      content: PC.renderInitialCard(data) + PC.renderFinalCard(data),
      rolls: [catalystRoll, diluentRoll],
      [`flags.${NS}.${FLAG_KEY}`]: data
    });

    setTimeout(() => {
      PC.updateButtonOwnershipState();
      ui.chat.scrollBottom();
    }, 100);
  };

  if (PC.clickHandler) {
    document.removeEventListener("click", PC.clickHandler, true);
  }

  PC.clickHandler = async function (event) {
    const button = event.target.closest?.(".pc-btn");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    await PC.handleButton(button);
  };

  document.addEventListener("click", PC.clickHandler, true);

  if (!PC.ownershipHookInstalled) {
    Hooks.on("renderChatMessage", () => {
      setTimeout(() => PC.updateButtonOwnershipState(), 50);
    });

    Hooks.on("renderChatMessageHTML", () => {
      setTimeout(() => PC.updateButtonOwnershipState(), 50);
    });

    PC.ownershipHookInstalled = true;
  }

  const controlled = canvas.tokens?.controlled ?? [];
  let token = null;
  let actor = null;

  if (controlled.length > 0) {
    token = controlled.find(t => t.actor?.testUserPermission(game.user, "OWNER"));
    if (!token) return ui.notifications.error("No selected token you own was found.");
    actor = token.actor;
  } else {
    actor = game.user.character;
    if (!actor) return ui.notifications.error("No owned token selected, and no assigned character found.");
  }

  const alchemyBonus = PC.getNumericSkillBonus(actor);
  if (alchemyBonus === null) return ui.notifications.error("Could not find Craft (Alchemy) on this actor.");

  const halfBonus = Math.floor(alchemyBonus / 2);
  const low = Math.max(1, 50 - halfBonus);
  const high = Math.min(100, 50 + halfBonus);

  const initialRoll = await new Roll("1d100").evaluate();
  const initialResult = initialRoll.total;
  const initialSuccess = initialResult >= low && initialResult <= high;

  const data = {
    ownerUserId: game.user.id,
    actorName: actor.name,
    actorUuid: actor.uuid,
    tokenId: token?.id ?? null,
    low,
    high,
    initialResult,
    catalysts: 0,
    diluents: 0,
    accepted: initialSuccess,
    finished: false,
    finishRollTotal: null,
    exploded: false,
    explosionDamageFormula: null,
    explosionDamageTotal: null
  };

  await ChatMessage.create(PC.makeRollModeChatData({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor, token }),
    content: PC.renderInitialCard(data),
    flags: {
      [NS]: {
        [FLAG_KEY]: data
      }
    }
  }));

  setTimeout(() => PC.updateButtonOwnershipState(), 150);
})();
