(async function () {

  // Foundry v13: flag scope must be an active package id → system id is safe
  const NS = game.system.id;
  const FLAG = "activeCheck"; // { dc:number, lossFormula:string, setAt:number(ms) }
  const TTL_MS = 60_000;

  // Per-player "one wait at a time" guard key
  const PENDING_KEY = "__sanityCheckPendingByUser";

  // Resolve-style badge colors
  const GREEN = "#43a047"; // SUCCESS
  const RED   = "#ff4c4c"; // FAIL
  const COMMON_BUFFS_PACK_ID = "darkfinder.common-buffs";

  /** ---------- Per-player pending guard ---------- */
  function isPending() {
    const map = (globalThis[PENDING_KEY] ||= {});
    return !!map[game.user.id];
  }
  function setPending(v) {
    const map = (globalThis[PENDING_KEY] ||= {});
    map[game.user.id] = !!v;
  }

  /** ---------- Actor / Token resolution ---------- */
  function resolveActorToken() {
    const t = canvas.tokens.controlled[0] || null;
    if (t?.actor) return { actor: t.actor, token: t };

    const actor = game.user.character || null;
    if (!actor) return { actor: null, token: null };

    const token = actor.getActiveTokens()?.[0] || null;
    return { actor, token };
  }

  /** ---------- Shared DC storage on Scene flags ---------- */
  function getScene() {
    return canvas?.scene || game.scenes?.current || null;
  }

  async function getCheckData() {
    const scene = getScene();
    if (!scene) return null;
    return scene.getFlag(NS, FLAG) || null;
  }

  async function setCheckData(data) {
    const scene = getScene();
    if (!scene) return;
    await scene.setFlag(NS, FLAG, data);
  }

  function isValidCheckData(data) {
    if (!data) return false;
    const dc = Number(data.dc);
    const setAt = Number(data.setAt);
    const lossFormula = String(data.lossFormula ?? "").trim();

    if (!Number.isFinite(dc) || dc < 0) return false;
    if (!Number.isFinite(setAt) || setAt <= 0) return false;
    if (!lossFormula) return false;

    return (Date.now() - setAt) <= TTL_MS;
  }

  /** ---------- Common Buff helpers ---------- */
  function deepCloneData(value) {
    if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function flattenObject(object, prefix = "", result = {}) {
    for (const [key, value] of Object.entries(object || {})) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        flattenObject(value, path, result);
        continue;
      }
      result[path] = value;
    }
    return result;
  }

  async function getCommonBuffTemplateData(buffName) {
    const pack = game.packs.get(COMMON_BUFFS_PACK_ID);
    if (!pack) {
      throw new Error(`Could not find the ${COMMON_BUFFS_PACK_ID} compendium.`);
    }

    if (!pack.index?.size && typeof pack.getIndex === "function") {
      await pack.getIndex();
    }

    const indexEntry = pack.index?.find?.((entry) => entry?.name === buffName);
    if (!indexEntry?._id) {
      throw new Error(`Could not find ${buffName} in ${pack.metadata?.label || COMMON_BUFFS_PACK_ID}.`);
    }

    const template = await pack.getDocument(indexEntry._id);
    if (!template) {
      throw new Error(`Could not load ${buffName} from ${pack.metadata?.label || COMMON_BUFFS_PACK_ID}.`);
    }

    const data = typeof template.toObject === "function"
      ? template.toObject()
      : deepCloneData(template);

    delete data._id;
    delete data.id;
    delete data.folder;
    delete data.sort;
    delete data.pack;
    return data;
  }

  function findCommonBuff(actor, buffName) {
    const target = String(buffName || "").trim().toLowerCase();
    return (actor.items ?? []).find((item) => (
      item?.type === "buff" && String(item.name ?? "").trim().toLowerCase() === target
    )) || null;
  }

  function buildCommonBuffRepairUpdate(templateData, currentUsesValue) {
    const updateData = deepCloneData(templateData);
    delete updateData._id;
    delete updateData.id;
    delete updateData.folder;
    delete updateData.sort;
    delete updateData.pack;
    delete updateData.ownership;
    delete updateData._stats;

    if (!updateData.system) updateData.system = {};
    if (!updateData.system.uses) updateData.system.uses = {};
    updateData.system.uses.value = currentUsesValue;

    return flattenObject(updateData);
  }

  async function resolveCreatedUsesMax(actor, itemData) {
    const formula = String(itemData.system?.uses?.maxFormula || "").trim();
    if (formula) {
      try {
        const roll = new Roll(formula, actor.getRollData?.() || actor.system || {});
        await roll.evaluate();
        const total = Math.floor(Number(roll.total));
        if (Number.isFinite(total)) return Math.max(0, total);
      } catch (err) {
        console.warn("Sanity Check: Could not evaluate Common Buff max uses formula.", { formula, err });
      }
    }

    const fallback = Math.floor(Number(itemData.system?.uses?.max ?? NaN));
    return Number.isFinite(fallback) ? Math.max(0, fallback) : null;
  }

  async function prepareCreatedCommonBuffData(actor, templateData, buffName) {
    const data = deepCloneData(templateData);
    const normalizedName = String(buffName || "").trim().toLowerCase();
    if (normalizedName === "sanity" || normalizedName === "short rest") {
      const max = await resolveCreatedUsesMax(actor, data);
      if (max !== null) {
        if (!data.system) data.system = {};
        if (!data.system.uses) data.system.uses = {};
        data.system.uses.max = max;
        data.system.uses.value = max;
      }
    }
    return data;
  }

  async function ensureCommonBuff(actor, buffName) {
    const templateData = await getCommonBuffTemplateData(buffName);
    const existing = findCommonBuff(actor, buffName);

    if (!existing) {
      const createData = await prepareCreatedCommonBuffData(actor, templateData, buffName);
      const [created] = await actor.createEmbeddedDocuments("Item", [createData]);
      return created || findCommonBuff(actor, buffName);
    }

    const currentValue = Number(existing.system?.uses?.value ?? 0) || 0;
    await existing.update(buildCommonBuffRepairUpdate(templateData, currentValue));
    return findCommonBuff(actor, buffName);
  }

  /** ---------- Sanity item helpers ---------- */
  function findSanityItem(actor) {
    return findCommonBuff(actor, "Sanity");
  }

  async function ensureSanityItem(actor) {
    return ensureCommonBuff(actor, "Sanity");
  }

  async function decrementUsesClamped(item, amount) {
    const valuePath = "system.uses.value";
    const cur = Number(foundry.utils.getProperty(item, valuePath) ?? 0) || 0;
    const dec = Math.max(0, Math.floor(Number(amount) || 0));
    const next = Math.max(0, cur - dec);
    if (next !== cur) await item.update({ [valuePath]: next });
    return { cur, next, decApplied: cur - next };
  }

  /** ---------- Roll mode handling ---------- */
  function getUserRollMode() {
    return game.settings.get("core", "rollMode") || "publicroll";
  }

  /** ---------- UI: GM dialog to set DC + loss formula ---------- */
  function gmPromptSetDC(existing) {
    return new Promise((resolve) => {
      const curDC = Number(existing?.dc);
      const curFormula = String(existing?.lossFormula ?? "").trim();

      const content = `
        <style>
          .sc-wrap{ padding: 14px 16px; }
          .sc-row{ display:flex; gap:12px; align-items:center; margin:10px 0; }
          .sc-row label{ flex: 0 0 160px; font-weight:700; }
          .sc-row input{ flex: 1 1 auto; padding:6px 8px; }
          .sc-hint{ opacity:0.8; font-size:0.92em; margin-top:10px; line-height:1.25; }
          .sc-ex{ opacity:0.8; font-size:0.9em; margin-top:6px; }
          code{ padding:0 4px; }
        </style>
        <div class="sc-wrap">
          <div style="text-align:center; font-weight:800; margin-bottom:8px;">Set Sanity Check</div>

          <div class="sc-row">
            <label>DC</label>
            <input type="number" name="dc" min="0" step="1" value="${Number.isFinite(curDC) && curDC >= 0 ? curDC : 15}">
          </div>

          <div class="sc-row">
            <label>Sanity Loss</label>
            <input type="text" name="lossFormula" value="${curFormula || "1"}" placeholder="e.g. 2d6+1 or 7">
          </div>

          <div class="sc-hint">
            This DC expires after 60 seconds. Players running the macro will use the latest values set on the current Scene.
          </div>
        </div>
      `;

      new Dialog({
        title: "Sanity Check (GM)",
        content,
        buttons: {
          ok: {
            label: "Accept",
            callback: (html) => {
              const dc = Number(html.find('input[name="dc"]').val());
              const lossFormula = String(html.find('input[name="lossFormula"]').val() ?? "").trim();
              resolve({
                dc: Number.isFinite(dc) ? Math.floor(dc) : -1,
                lossFormula
              });
            }
          },
          cancel: { label: "Cancel", callback: () => resolve(null) }
        },
        default: "ok"
      }).render(true);
    });
  }

  
/** ---------- Notify GM(s) if player needs DC (only called once per wait) ---------- */
async function whisperGMRequest() {
  const gms = game.users.filter(u => u.isGM && u.active);
  if (!gms.length) return;

  // Try to identify THIS macro reliably
  const thisMacro =
    (this && this.documentName === "Macro") ? this :
    (this && this instanceof Macro) ? this :
    game.macros?.find(m => m.id === (this?.id ?? null)) ||
    game.macros?.getName?.("Sanity Check") ||
    null;

  

  // UUID-style macro link is the most reliable in v13
  const macroLink = `@UUID[${thisMacro.uuid}]{Set Sanity DC}`;

  const content = `
    <div class="chat-card" style="padding:10px 12px;">
      <div style="font-weight:900; text-align:center; font-size:1.05em;">Sanity Check Requested</div>
      <hr style="margin:8px 0; opacity:0.35;" />
      <div style="opacity:0.92; margin-bottom:12px; line-height:1.25;">
        This player triggered the <strong>Sanity Check</strong> macro, but no DC was set in the last minute.
        <div>GM: Click below to set the DC and Sanity loss.</div>

      <div style="display:flex; justify-content:center;">
        <div style="
          display:inline-block;
          padding:8px 14px;
          border:1px solid rgba(255,255,255,0.25);
          border-radius:10px;
          background:rgba(0,0,0,0.18);
          font-weight:900;
        ">
          ${macroLink}
        </div>
      </div>
    </div>
  `;

  // IMPORTANT: enrich so @UUID[...] becomes clickable
  const enriched = await TextEditor.enrichHTML(content, { async: true, documents: true });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker(),
    content: enriched,
    whisper: gms.map(u => u.id)
  });
}






  /** ---------- Wait/poll for a valid DC ---------- */
  async function waitForValidDC({ timeoutMs = 60_000, pollMs = 500 } = {}) {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
      const data = await getCheckData();
      if (isValidCheckData(data)) return data;
      await new Promise(r => setTimeout(r, pollMs));
    }
    return null;
  }

  /** ---------- UI bits: Resolve-style badges + LARGE purple loss dot ---------- */
  function badge({ text, bg, fg }) {
    return `
      <div style="text-align:center;margin-top:10px;">
        <span style="
          display:inline-block;
          padding:8px 24px;
          background:${bg};
          color:${fg};
          font-size:1.8em;
          font-weight:900;
          border-radius:8px;">
          ${text}
        </span>
      </div>
    `;
  }

  function purpleLossDotLarge({ amountText, hoverText }) {
    const safeTitle = String(hoverText ?? "").replace(/"/g, "&quot;");
    return `
      <div style="display:flex; justify-content:center; margin-top:12px;">
        <div title="${safeTitle}" style="
          width:60px; height:60px;
          border-radius:999px;
          background:#8b3dff;
          box-shadow: 0 0 10px rgba(139,61,255,0.55), 0 4px 10px rgba(0,0,0,0.45);
          display:flex; align-items:center; justify-content:center;
          cursor:help;
        ">
          <div style="
            color:white;
            font-weight:900;
            font-size:32px;
            line-height:1;
            text-shadow: 0 2px 4px rgba(0,0,0,0.8);
            white-space:nowrap;
          ">${amountText}</div>
        </div>
      </div>
    `;
  }

  function fmtPart(n) {
    const v = Number(n) || 0;
    const sign = (v >= 0) ? "+" : "-";
    return `${sign} ${Math.abs(v)}`;
  }

  /** ---------- Post result (respects roll mode) ---------- */
  async function postResultChat({
    actor, token, dc, roll, total, mods, success,
    lossFormula, lossRolledTotal, sanityLossApplied
  }) {
    const speaker = ChatMessage.getSpeaker({ actor, token });
    const rollMode = getUserRollMode();

    // Natural d20 face (Resolve-style)
    let d20Face = null;
    try {
      d20Face = roll.dice?.find(d => d.faces === 20)?.total ?? null;
    } catch (_) {}
    if (d20Face === null) {
      d20Face = (Number(roll.total ?? 0) || 0) - (mods.int || 0) - (mods.wis || 0) - (mods.cha || 0);
    }

    const inline = `
      <div class="dice-roll endurance-roll" style="margin-top:4px;">
        <div class="dice-result">
          <div class="dice-formula" style="font-size:1.05em;">
            <i class="fas fa-dice-d20"></i>
            <strong>${d20Face}</strong>
            ${fmtPart(mods.int)}
            ${fmtPart(mods.wis)}
            ${fmtPart(mods.cha)}
            &nbsp;⇒&nbsp; <strong>${total}</strong>
          </div>
        </div>
      </div>
    `;

    const badgeHtml = success
      ? badge({ text: "SUCCESS", bg: GREEN, fg: "#ffffff" })
      : badge({ text: "FAIL", bg: RED, fg: "#000000" });

    // DC display larger, no "vs"
    const dcLine = `
      <div style="text-align:center; margin-top:8px; font-weight:900; font-size:1.25em; opacity:0.95;">
        DC <span style="font-size:1.05em;">${dc}</span>
      </div>
    `;

    // Loss dot hover: "<formula> = <result>"
    let lossDot = "";
    if (!success && Number(sanityLossApplied) > 0) {
      const hover = `${String(lossFormula).trim()} = ${lossRolledTotal}`;
      lossDot = purpleLossDotLarge({ amountText: `-${sanityLossApplied}`, hoverText: hover });
    }

    const msg = `
      <div class="chat-card" style="padding:4px 6px;">
        <header class="card-header flexrow" style="align-items:center;justify-content:space-between;">
          <h3 style="margin:0;font-size:1.2em;"><strong>Sanity Check</strong></h3>
        </header>
        <section class="card-content">
          ${inline}
          ${dcLine}
          ${badgeHtml}
          ${lossDot}
        </section>
      </div>
    `;

    const messageData = {
      speaker,
      content: msg,
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      rolls: [roll],
      sound: CONFIG.sounds.dice
    };

    ChatMessage.applyRollMode(messageData, rollMode);
    await ChatMessage.create(messageData);
  }

  /** ---------- Main flow ---------- */

  const scene = getScene();
  if (!scene) {
    ui.notifications.error("No active Scene found.");
    return;
  }

  // If GM: prompt and set DC+loss formula
  if (game.user.isGM) {
    const existing = await getCheckData();
    const input = await gmPromptSetDC(existing);
    if (!input) return;

    if (!Number.isFinite(input.dc) || input.dc < 0) {
      ui.notifications.warn("Invalid DC.");
      return;
    }

    const lossFormula = String(input.lossFormula ?? "").trim();
    if (!lossFormula) {
      ui.notifications.warn("Invalid sanity loss formula.");
      return;
    }

    // Validate formula with a safe test roll (no side effects)
    try {
      const test = new Roll(lossFormula);
      await test.evaluate();
      if (!Number.isFinite(Number(test.total))) throw new Error("Bad total");
    } catch (e) {
      ui.notifications.warn(`Loss formula is invalid: "${lossFormula}"`);
      return;
    }

    await setCheckData({ dc: input.dc, lossFormula, setAt: Date.now() });
    ui.notifications.info(`Sanity Check set: DC ${input.dc}, loss "${lossFormula}" (expires in 60s).`);
    return;
  }

  // Player: prevent queueing multiple waits/results per player
  if (isPending()) {
    ui.notifications.info("Sanity Check is already waiting for the GM. (Not queuing another.)");
    return;
  }

  setPending(true);
  try {
    // Player: resolve actor
    const { actor, token } = resolveActorToken();
    if (!actor) {
      ui.notifications.error("No token selected and no default character assigned to your user.");
      return;
    }

    let sanityItem = null;
    try {
      sanityItem = await ensureSanityItem(actor);
    } catch (err) {
      console.warn("Sanity Check: Sanity buff could not be created or repaired.", err);
      ui.notifications.warn(err?.message || `${actor.name} could not create or repair the Sanity buff.`);
    }

    // Get valid DC or wait for it (only once per pending run)
    let data = await getCheckData();
    if (!isValidCheckData(data)) {
      ui.notifications.info("Waiting for GM to set the Sanity Check DC...");
      await whisperGMRequest(await getCheckData());
      data = await waitForValidDC({ timeoutMs: 30_000, pollMs: 500 });

    }

    if (!isValidCheckData(data)) {
      ui.notifications.warn("No Sanity Check DC was set in time.");
      return;
    }

    const dc = Number(data.dc);
    const lossFormula = String(data.lossFormula ?? "").trim();

    // Roll: 1d20 + INT + WIS + CHA mods
    const intMod = Number(actor.system?.abilities?.int?.mod ?? 0) || 0;
    const wisMod = Number(actor.system?.abilities?.wis?.mod ?? 0) || 0;
    const chaMod = Number(actor.system?.abilities?.cha?.mod ?? 0) || 0;

    const roll = new Roll("1d20 + @int + @wis + @cha", { int: intMod, wis: wisMod, cha: chaMod });
    await roll.evaluate();

    const total = Number(roll.total ?? 0) || 0;
    const success = total >= dc;

    // If fail: roll loss formula per-player, decrement Sanity uses by that result (clamped)
    let sanityLossApplied = 0;
    let lossRolledTotal = 0;

    if (!success) {
      // Evaluate per-player loss roll
      let lossRoll;
      try {
        lossRoll = new Roll(lossFormula);
        await lossRoll.evaluate();
        lossRolledTotal = Math.max(0, Math.floor(Number(lossRoll.total ?? 0) || 0));
      } catch (e) {
        // If GM entered something weird after validation, fail gracefully
        ui.notifications.warn(`Sanity loss formula could not be rolled: "${lossFormula}"`);
        lossRolledTotal = 0;
      }

      if (lossRolledTotal > 0) {
        if (!sanityItem) {
          ui.notifications.warn(`${actor.name} has no Common Buff named "Sanity" with Uses configured.`);
        } else {
          const dec = await decrementUsesClamped(sanityItem, lossRolledTotal);
          sanityLossApplied = dec.decApplied;
        }
      }
    }

    await postResultChat({
      actor,
      token,
      dc,
      roll,
      total,
      mods: { int: intMod, wis: wisMod, cha: chaMod },
      success,
      lossFormula,
      lossRolledTotal,
      sanityLossApplied
    });

  } finally {
    setPending(false);
  }

})();
