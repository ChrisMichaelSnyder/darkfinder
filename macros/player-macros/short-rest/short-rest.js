// Short Rest Heal Macro (HP / Spell Points / Fatigue / Sanity selector)
// + Passive Bonus Fatigue & Bonus Sanity each Short Rest (regardless of choice)
// + Chat card respects the user's current roll mode (Public / GM / Blind / Self)
// PF1e 11.8, Foundry v13.346
//
(function () {
  const COMMON_BUFFS_PACK_ID = "darkfinder.common-buffs";

  /** Resolve actor/token
   * Prefer selected token; else fall back to game.user.character; else error.
   */
  function resolveActorToken() {
    const t = canvas.tokens.controlled[0] || null;

    if (t?.actor) return { actor: t.actor, token: t };

    const actor = game.user.character || null;
    if (!actor) return { actor: null, token: null };

    const token = actor.getActiveTokens()?.[0] || null;
    return { actor, token };
  }

  function getUses(item) {
    const uses = item?.system?.uses;
    const value = Number(uses?.value ?? NaN);
    const max = Number(uses?.max ?? NaN);
    const per = uses?.per ?? null;
    return { value, max, per };
  }

  async function spendOneUse(item) {
    const cur = Number(item.system?.uses?.value ?? 0) || 0;
    const next = Math.max(0, cur - 1);
    await item.update({ "system.uses.value": next });
    return { cur, next };
  }

  /** Read the user's current roll mode so the chat card matches their setting */
  function getUserRollMode() {
    // Foundry v13: stored in core settings as "core.rollMode"
    // values typically: "publicroll", "gmroll", "blindroll", "selfroll"
    return game.settings.get("core", "rollMode") || "publicroll";
  }

  /** -------- Common Buff helpers -------- */

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
        console.warn("Short Rest: Could not evaluate Common Buff max uses formula.", { formula, err });
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

  async function ensureShortRestItem(actor) {
    return ensureCommonBuff(actor, "Short Rest");
  }

  function findShortRestItem(actor) {
    return findCommonBuff(actor, "Short Rest");
  }

  /** Get class level with fallbacks */
  function getClassLevel(cls) {
    return (
      Number(cls.system?.levels) ||
      Number(cls.system?.level) ||
      Number(cls.system?.classLevel) ||
      Number(cls.system?.data?.levels) ||
      0
    );
  }

  /** Pick the most common hit die weighted by class levels; ties -> larger die. */
  function getDominantHitDie(actor) {
    const classes = actor.items.filter(i => i.type === "class");
    if (!classes.length) return null;

    const counts = { 6: 0, 8: 0, 10: 0, 12: 0 };

    for (const cls of classes) {
      const hd = cls.system?.hd;
      let faces = null;
      if (typeof hd === "number") faces = hd;
      else if (hd && typeof hd.faces === "number") faces = hd.faces;
      else if (hd && typeof hd.value === "number") faces = hd.value;

      if (!faces || ![6, 8, 10, 12].includes(faces)) continue;

      const lvl = getClassLevel(cls);
      if (lvl > 0) counts[faces] += lvl;
    }

    let bestDie = null;
    let bestCount = 0;

    for (const die of [6, 8, 10, 12]) {
      const count = counts[die] || 0;
      if (count > bestCount || (count === bestCount && count > 0 && (bestDie === null || die > bestDie))) {
        bestCount = count;
        bestDie = die;
      }
    }

    return bestCount > 0 ? bestDie : null;
  }

  /** -------- Fatigue Buff -------- */

  function findFatigueBuff(actor) {
    return findCommonBuff(actor, "Fatigue");
  }

  async function ensureFatigueBuff(actor) {
    return ensureCommonBuff(actor, "Fatigue");
  }

  function getFatigueValue(fatigueBuff) {
    const usesPath = "system.uses.value";
    const cur = Number(foundry.utils.getProperty(fatigueBuff, usesPath));
    return Number.isFinite(cur) ? cur : null;
  }

  async function setFatigueValue(fatigueBuff, next) {
    const usesPath = "system.uses.value";
    await fatigueBuff.update({ [usesPath]: next });
  }

  async function decrementFatigueByOne(fatigueBuff) {
    const cur = getFatigueValue(fatigueBuff);
    if (cur === null) return { ok: false, reason: "noField" };
    if (cur <= 0) return { ok: false, reason: "zero", cur };
    const next = Math.max(0, cur - 1);
    await setFatigueValue(fatigueBuff, next);
    return { ok: true, cur, next };
  }

  /** Bonus Fatigue CON check
   * Only eligible if fatigueBefore > 1
   * roll 1d20 + CON mod; if >=10 and fatigue currently >0, decrement by 1.
   */
  async function tryBonusFatigue(actor, fatigueBuff, fatigueBefore) {
    if (!fatigueBuff) return { applied: false };
    if (!(Number.isFinite(fatigueBefore) && fatigueBefore > 1)) return { applied: false };

    const conMod = Number(actor.system?.abilities?.con?.mod ?? 0) || 0;
    const roll = new Roll(`1d20 + @conMod`, { conMod });
    await roll.evaluate();

    const dieResult = (roll.terms?.[0]?.results?.[0]?.result ?? null);
    const total = Number(roll.total ?? 0) || 0;

    if (total < 10) return { applied: false, roll, conMod, total, dieResult };

    const curNow = getFatigueValue(fatigueBuff);
    if (curNow === null || curNow <= 0) return { applied: false, roll, conMod, total, dieResult };

    await setFatigueValue(fatigueBuff, Math.max(0, curNow - 1));
    return { applied: true, roll, conMod, total, dieResult };
  }

  /** -------- Sanity Feature/Buff (Uses-based) -------- */

  function findSanityItem(actor) {
    return findCommonBuff(actor, "Sanity");
  }

  async function ensureSanityItem(actor) {
    return ensureCommonBuff(actor, "Sanity");
  }

  function getSanityUses(item) {
    const value = Number(item?.system?.uses?.value ?? NaN);
    const max = Number(item?.system?.uses?.max ?? NaN);
    return { value, max };
  }

  async function addSanityClamped(sanityItem, amount) {
    const valuePath = "system.uses.value";
    const maxPath   = "system.uses.max";

    const cur = Number(foundry.utils.getProperty(sanityItem, valuePath) ?? 0) || 0;
    const max = Number(foundry.utils.getProperty(sanityItem, maxPath) ?? NaN);

    if (!Number.isFinite(max)) return { ok: false, reason: "noMax", cur, max, applied: 0, next: cur };

    const applied = Math.max(0, Math.min(amount, Math.max(0, max - cur)));
    const next = cur + applied;

    if (applied !== 0) await sanityItem.update({ [valuePath]: next });

    return { ok: true, cur, max, applied, next };
  }

  /** Passive Bonus Sanity on ANY Short Rest
   * Chance = % missing sanity (based on sanityBefore/max)
   * If it triggers: heal +1, and upgrade chance:
   *  - base 10% chance to be +2
   *  - if sanityBefore < max/2: 20% chance to be +2
   */
  async function tryBonusSanity(sanityItem, sanityBefore) {
    if (!sanityItem) return { applied: false };

    const { value: curNow, max } = getSanityUses(sanityItem);
    if (!Number.isFinite(max) || max <= 0) return { applied: false };
    if (Number.isFinite(curNow) && curNow >= max) return { applied: false };

    const baseCur = Number.isFinite(sanityBefore) ? sanityBefore : (Number.isFinite(curNow) ? curNow : 0);
    const missing = Math.max(0, max - baseCur);
    const chancePct = Math.max(0, Math.min(100, (missing / max) * 100));

    if (chancePct <= 0) return { applied: false, chancePct, baseCur, max };

    const rollChance = new Roll("1d100");
    await rollChance.evaluate();
    const r1 = Number(rollChance.total ?? 0) || 0;

    if (r1 > chancePct) {
      return { applied: false, chancePct, rollChance, r1, baseCur, max };
    }

    const belowHalf = baseCur < (max / 2);
    const upChancePct = belowHalf ? 20 : 10;

    const rollUpgrade = new Roll("1d100");
    await rollUpgrade.evaluate();
    const r2 = Number(rollUpgrade.total ?? 0) || 0;

    const amount = (r2 <= upChancePct) ? 2 : 1;
    const clamp = await addSanityClamped(sanityItem, amount);

    return {
      applied: clamp.applied > 0,
      amount,
      appliedAmount: clamp.applied,
      chancePct,
      upChancePct,
      belowHalf,
      baseCur,
      max,
      rollChance,
      rollUpgrade,
      r1,
      r2
    };
  }

  /** -------- Badges -------- */

  function heartCore({ amount, hoverText }) {
    return `
      <div
        title="${String(hoverText).replace(/"/g, "&quot;")}"
        style="
          position:relative;
          width:38px;
          height:34px;
          transform: rotate(-45deg);
          background:#ff2d2d;
          box-shadow: 0 0 4px rgba(255,45,45,0.7), 0 1px 3px rgba(0,0,0,0.4);
          cursor:help;
        "
      >
        <div style="position:absolute; width:38px; height:34px; background:#ff2d2d; border-radius:50%; top:-19px; left:0;"></div>
        <div style="position:absolute; width:38px; height:34px; background:#ff2d2d; border-radius:50%; top:0; left:19px;"></div>
        <div style="
          position:absolute; top:35%; left:50%;
          transform: translate(-50%, -50%) rotate(45deg);
          color:white; font-weight:900; font-size:2.0em; line-height:1;
          padding:0 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.65);
          pointer-events:none; white-space:nowrap;
        ">+${amount}</div>
      </div>
    `;
  }

  function diamondCore({ amount, hoverText }) {
    const safeTitle = String(hoverText).replace(/"/g, "&quot;");
    return `
      <div title="${safeTitle}" style="position:relative; width:72px; height:72px; cursor:help;">
        <div style="
          position:absolute; left:50%; top:50%;
          transform: translate(-50%, -50%) rotate(45deg);
          width:60px; height:60px; background:#2a7bff;
          box-shadow: 0 0 14px rgba(42,123,255,0.85), 0 4px 8px rgba(0,0,0,0.45);
          border-radius:6px;
        "></div>
        <div style="
          position:absolute; left:50%; top:50%;
          transform: translate(-50%, -50%) rotate(45deg);
          width:44px; height:44px; background: rgba(255,255,255,0.18);
          border-radius:5px; pointer-events:none;
        "></div>
        <div style="
          position:absolute; left:50%; top:50%;
          transform: translate(-50%, -50%);
          color:white; font-weight:900; font-size:2.0em; line-height:1;
          padding:0 4px; text-shadow: 0 2px 4px rgba(0,0,0,0.8);
          pointer-events:none; white-space:nowrap;
        ">+${amount}</div>
      </div>
    `;
  }

  function greenCircleCore({ amountText, hoverText, sizePx, fontPx }) {
    const safeTitle = String(hoverText ?? "").replace(/"/g, "&quot;");
    return `
      <div title="${safeTitle}" style="
        position:relative; width:${sizePx}px; height:${sizePx}px; border-radius:999px;
        background:#18b83a;
        box-shadow: 0 0 ${Math.round(sizePx * 0.14)}px rgba(24,184,58,0.45),
                    0 ${Math.max(2, Math.round(sizePx * 0.07))}px ${Math.max(4, Math.round(sizePx * 0.14))}px rgba(0,0,0,0.45);
        cursor:help; display:flex; align-items:center; justify-content:center;
      ">
        <div style="
          color:white; font-weight:900; font-size:${fontPx}px; line-height:1;
          padding:0 2px; text-shadow: 0 2px 4px rgba(0,0,0,0.8);
          pointer-events:none; white-space:nowrap;
        ">${amountText}</div>
      </div>
    `;
  }

  function purpleCircleCore({ amountText, hoverText, sizePx, fontPx }) {
    const safeTitle = String(hoverText ?? "").replace(/"/g, "&quot;");
    return `
      <div title="${safeTitle}" style="
        position:relative; width:${sizePx}px; height:${sizePx}px; border-radius:999px;
        background:#8b3dff;
        box-shadow: 0 0 ${Math.round(sizePx * 0.14)}px rgba(139,61,255,0.55),
                    0 ${Math.max(2, Math.round(sizePx * 0.07))}px ${Math.max(4, Math.round(sizePx * 0.14))}px rgba(0,0,0,0.45);
        cursor:help; display:flex; align-items:center; justify-content:center;
      ">
        <div style="
          color:white; font-weight:900; font-size:${fontPx}px; line-height:1;
          padding:0 2px; text-shadow: 0 2px 4px rgba(0,0,0,0.8);
          pointer-events:none; white-space:nowrap;
        ">${amountText}</div>
      </div>
    `;
  }

  function buildBadgeRow(mainCoreHtml, secondaryHtmlOrNull) {
    const gap = secondaryHtmlOrNull ? 34 : 0;
    return `
      <div style="margin-top:26px; margin-bottom:20px; display:flex; justify-content:center; align-items:center; gap:${gap}px;">
        ${mainCoreHtml}
        ${secondaryHtmlOrNull || ""}
      </div>
    `;
  }

  function buildSecondaryStack(badges) {
    const arr = (badges ?? []).filter(Boolean);
    if (!arr.length) return null;
    return `<div style="display:flex; align-items:center; justify-content:center; gap:14px;">${arr.join("")}</div>`;
  }

  /** -------- Spellbook helpers (Primary) -------- */

  function normalizeCasterType(raw) {
    const s = String(raw ?? "").toLowerCase();
    if (s === "high") return "high";
    if (s === "med" || s === "medium") return "medium";
    if (s === "low") return "low";
    return null;
  }

  function getPrimarySpellbook(actor) {
    return actor.system?.attributes?.spells?.spellbooks?.primary || null;
  }

  function getPrimaryProgression(actor) {
    const sb = getPrimarySpellbook(actor);
    return normalizeCasterType(sb?.casterType) || null;
  }

  function getPrimaryPreparationMode(actor) {
    const sb = getPrimarySpellbook(actor);
    const mode = String(sb?.spellPreparationMode ?? "").toLowerCase();
    if (mode.includes("spont")) return "spontaneous";
    if (mode.includes("prep")) return "prepared";
    if (sb?.spontaneous === true) return "spontaneous";
    if (sb?.prepared === true) return "prepared";
    return null;
  }

  async function addSpellPointsToPrimarySpellbookClamped(actor, amount) {
    const valuePath = "system.attributes.spells.spellbooks.primary.spellPoints.value";
    const maxPath   = "system.attributes.spells.spellbooks.primary.spellPoints.max";

    const cur = Number(foundry.utils.getProperty(actor, valuePath) ?? 0) || 0;
    const max = Number(foundry.utils.getProperty(actor, maxPath) ?? NaN);

    const applied = Number.isFinite(max)
      ? Math.max(0, Math.min(amount, Math.max(0, max - cur)))
      : Math.max(0, amount);

    const next = cur + applied;
    if (applied !== 0) await actor.update({ [valuePath]: next });

    return { cur, next, max, applied, valuePath };
  }

  /** -------- Main recovery effects (do NOT roll bonuses here) -------- */

  async function mainHitPointHeal(actor) {
    const hpPath = "system.attributes.hp";
    const hp = foundry.utils.getProperty(actor, hpPath) || {};
    const cur = Number(hp.value ?? 0) || 0;
    const max = Number(hp.max ?? cur) || cur;

    if (cur >= max) {
      ui.notifications.info(`${actor.name} is already at maximum Hit Points.`);
      return { ok: false, atMax: true };
    }

    const hdFaces = getDominantHitDie(actor);
    if (!hdFaces) {
      ui.notifications.warn("Could not determine a hit die from your classes.");
      return { ok: false };
    }

    const conMod = Number(actor.system?.abilities?.con?.mod ?? 0) || 0;
    const roll = new Roll(`1d${hdFaces} + @conMod`, { conMod });
    await roll.evaluate();

    const healAmount = Math.max(0, roll.total ?? 0);
    const newHP = Math.min(max, cur + healAmount);
    await actor.update({ [`${hpPath}.value`]: newHP });

    const dieResult = (roll.terms?.[0]?.results?.[0]?.result ?? roll.total ?? 0);
    const hoverText = `Roll: ${dieResult} [1d${hdFaces}] + ${conMod} [CON] = ${roll.total}`;

    return {
      ok: true,
      label: "Hit Points",
      mainBadge: heartCore({ amount: healAmount, hoverText }),
      rolls: [roll]
    };
  }

  async function mainSpellPointRecover(actor) {
    const sb = getPrimarySpellbook(actor);
    if (!sb || sb?.spellPoints?.useSystem !== true) {
      ui.notifications.error(`${actor.name} has no spellbooks that use Spell Points.`);
      return { ok: false };
    }

    const spValuePath = "system.attributes.spells.spellbooks.primary.spellPoints.value";
    const spMaxPath   = "system.attributes.spells.spellbooks.primary.spellPoints.max";

    const spCur = Number(foundry.utils.getProperty(actor, spValuePath) ?? 0) || 0;
    const spMax = Number(foundry.utils.getProperty(actor, spMaxPath) ?? NaN);

    if (Number.isFinite(spMax) && spCur >= spMax) {
      ui.notifications.info(`${actor.name} is already at maximum Spell Points.`);
      return { ok: false, atMax: true };
    }

    const prog = getPrimaryProgression(actor);
    if (!prog) {
      ui.notifications.warn("Could not determine Primary spellcasting progression (casterType).");
      return { ok: false };
    }

    const prep = getPrimaryPreparationMode(actor);

    let formula;
    if (prog === "high") formula = (prep === "spontaneous") ? "1d8+2" : "1d8+1";
    else if (prog === "medium") formula = "1d4+1";
    else formula = "1d4";

    const roll = new Roll(formula);
    await roll.evaluate();

    const rolledGain = Math.max(0, roll.total ?? 0);
    await addSpellPointsToPrimarySpellbookClamped(actor, rolledGain);

    const dieResult = (roll.terms?.[0]?.results?.[0]?.result ?? roll.total ?? 0);
    const dieFaces = (String(formula).match(/^1d(\d+)/)?.[1]) || "?";
    const flat = String(formula).includes("+") ? (Number(String(formula).split("+")[1]) || 0) : 0;

    const hoverText = String(formula).includes("+")
      ? `Roll: ${dieResult} [1d${dieFaces}] + ${flat} [Bonus] = ${roll.total}`
      : `Roll: ${dieResult} [1d${dieFaces}] = ${roll.total}`;

    return {
      ok: true,
      label: "Spell Points",
      mainBadge: diamondCore({ amount: rolledGain, hoverText }),
      rolls: [roll]
    };
  }

  async function mainFatigueRecover(actor, fatigueBuff) {
    if (!fatigueBuff) {
      ui.notifications.info(`${actor.name} has no Fatigue to recover.`);
      return { ok: false, noFatigue: true };
    }

    const dec = await decrementFatigueByOne(fatigueBuff);
    if (!dec.ok) {
      ui.notifications.info(`${actor.name} has no Fatigue to recover.`);
      return { ok: false, noFatigue: true };
    }

    return {
      ok: true,
      label: "Fatigue",
      mainBadge: greenCircleCore({
        amountText: "-1",
        hoverText: "Fatigue reduced by 1",
        sizePx: 60,
        fontPx: 32
      }),
      rolls: []
    };
  }

  async function mainSanityRecover(actor, sanityItem) {
    const sItem = sanityItem || findSanityItem(actor);
    if (!sItem) {
      ui.notifications.error(`${actor.name} does not have a feature/buff named "Sanity" with Uses configured.`);
      return { ok: false, missing: true };
    }

    const { value: cur, max } = getSanityUses(sItem);
    if (!Number.isFinite(max)) {
      ui.notifications.error(`"Sanity" on ${actor.name} does not have a Max Uses value configured.`);
      return { ok: false };
    }
    if (Number.isFinite(cur) && cur >= max) {
      ui.notifications.info(`${actor.name} is already at maximum Sanity.`);
      return { ok: false, atMax: true };
    }

    const roll = new Roll("1d4");
    await roll.evaluate();

    const gained = Math.max(0, roll.total ?? 0);
    await addSanityClamped(sItem, gained);

    const dieResult = (roll.terms?.[0]?.results?.[0]?.result ?? roll.total ?? 0);
    const hoverText = `Roll: ${dieResult} [1d4] = ${roll.total}`;

    return {
      ok: true,
      label: "Sanity",
      mainBadge: purpleCircleCore({
        amountText: `+${gained}`,
        hoverText,
        sizePx: 60,
        fontPx: 32
      }),
      rolls: [roll]
    };
  }

  /** -------- Dialog to choose pool (Accept disabled until selected) -------- */

  function choosePool() {
  return new Promise((resolve) => {
    const content = `
      <style>
        .sr-wrap {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          width: 100%;
          min-height: 100%;
          padding: 0;
          box-sizing: border-box;
          color: #eadfbe;
        }

        .sr-header {
          flex: 0 0 auto;
          padding: 0.15rem 0.1rem 0.5rem;
          border-bottom: 1px solid rgba(142, 68, 58, 0.42);
        }

        .sr-title {
          margin: 0;
          font-size: 1.45rem;
          line-height: 1.1;
          color: #f4e9ca;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .sr-subtitle {
          margin: 0.22rem 0 0;
          color: rgba(239, 226, 191, 0.82);
          font-size: 0.95rem;
        }

        .sr-grid-panel {
          background:
            radial-gradient(circle at top, rgba(116, 88, 50, 0.18), transparent 34%),
            linear-gradient(180deg, rgba(59, 44, 29, 0.96), rgba(34, 25, 17, 0.98));
          border: 1px solid rgba(188, 157, 103, 0.42);
          border-radius: 12px;
          box-shadow: inset 0 0 0 1px rgba(255, 241, 210, 0.05);
          padding: 0.8rem;
          box-sizing: border-box;
          overflow: visible;
          margin-bottom: 0.5rem;
        }

        .sr-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(240px, 1fr));
          gap: 16px;
          align-items: stretch;
          width: 100%;
        }

        @media (max-width: 700px) {
          .sr-grid {
            grid-template-columns: 1fr;
          }
        }

        .sr-choice {
          border: 1px solid rgba(138, 118, 81, 0.85);
          border-radius: 14px;
          padding: 16px 16px 14px;
          cursor: pointer;
          user-select: none;
          text-align: center;
          background:
            linear-gradient(180deg, rgba(241, 225, 182, 0.34), rgba(176, 132, 68, 0.26)),
            rgba(92, 69, 43, 0.9);
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
          transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background 120ms ease;
          min-height: 126px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .sr-choice:hover {
          transform: translateY(-1px);
          border-color: rgba(140, 179, 112, 0.95);
          background:
            linear-gradient(180deg, rgba(223, 236, 188, 0.34), rgba(146, 190, 111, 0.26)),
            rgba(98, 76, 48, 0.95);
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.26);
        }

        .sr-choice input { display: none; }

        .sr-choice.selected {
          border-color: rgba(136, 185, 109, 0.98);
          background:
            linear-gradient(180deg, rgba(223, 236, 188, 0.36), rgba(146, 190, 111, 0.28)),
            rgba(95, 75, 46, 0.98);
          box-shadow:
            0 0 0 2px rgba(166, 205, 136, 0.16) inset,
            0 12px 22px rgba(0,0,0,0.3);
        }

        .sr-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 12px;
          font-weight: 800;
          font-size: 1.28em;
          color: #f3e6c4;
        }

        .sr-sub {
          color: rgba(239, 226, 191, 0.8);
          font-size: 1.03em;
          line-height: 1.4;
          padding: 0 6px;
          font-weight: 600;
        }

        /* Icons */
        .sr-heart {
          width: 22px;
          height: 19px;
          position: relative;
          transform: rotate(-45deg);
          background: #ff2d2d;
          border-radius: 3px;
          box-shadow: 0 0 4px rgba(255,45,45,0.7);
        }
        .sr-heart:before,
        .sr-heart:after {
          content: "";
          position: absolute;
          width: 22px;
          height: 19px;
          background: #ff2d2d;
          border-radius: 50%;
        }
        .sr-heart:before { top: -11px; left: 0; }
        .sr-heart:after  { top: 0; left: 11px; }

        .sr-diamond {
          width: 20px;
          height: 20px;
          background: #2a7bff;
          transform: rotate(45deg);
          border-radius: 3px;
          box-shadow: 0 0 4px rgba(42,123,255,0.7);
        }

        .sr-green {
          width: 20px;
          height: 20px;
          background: #18b83a;
          border-radius: 999px;
          box-shadow: 0 0 4px rgba(24,184,58,0.6);
        }

        .sr-purple {
          width: 20px;
          height: 20px;
          background: #8b3dff;
          border-radius: 999px;
          box-shadow: 0 0 4px rgba(139,61,255,0.65);
        }
      </style>

      <div class="sr-wrap">
        <div class="sr-header">
          <h2 class="sr-title">Short Rest Recovery</h2>
          <div class="sr-subtitle">
            What are you recovering?
          </div>
        </div>
        <form class="sr-form sr-grid-panel">
          <div class="sr-grid">
            <label class="sr-choice" data-choice="hp">
              <input type="radio" name="pool" value="hp" />
              <div class="sr-row">
                <span class="sr-heart"></span>
                <span>Hit Points</span>
              </div>
              <div class="sr-sub">Recover HP based on your dominant hit die.</div>
            </label>

            <label class="sr-choice" data-choice="sp">
              <input type="radio" name="pool" value="sp" />
              <div class="sr-row">
                <span class="sr-diamond"></span>
                <span>Spell Points</span>
              </div>
              <div class="sr-sub">Recover SP based on your primary spellbook.</div>
            </label>

            <label class="sr-choice" data-choice="fatigue">
              <input type="radio" name="pool" value="fatigue" />
              <div class="sr-row">
                <span class="sr-green"></span>
                <span>Fatigue</span>
              </div>
              <div class="sr-sub">Reduce your Fatigue by 1.</div>
            </label>

            <label class="sr-choice" data-choice="sanity">
              <input type="radio" name="pool" value="sanity" />
              <div class="sr-row">
                <span class="sr-purple"></span>
                <span>Sanity</span>
              </div>
              <div class="sr-sub">Recover 1d4 Sanity.</div>
            </label>
          </div>
        </form>
      </div>
    `;

    const dlg = new Dialog({
      title: "Short Rest Recovery",
      content,
      buttons: {
        ok: {
          label: "Accept",
          callback: html => {
            const choice = html.find('input[name="pool"]:checked').val();
            resolve(choice || null);
          }
        },
        cancel: { label: "Cancel", callback: () => resolve(null) }
      },
      default: "ok",
      render: (html) => {
        const dialogWidth = 760;
        const dialogHeight = 510;
        dlg.setPosition({ width: dialogWidth, height: dialogHeight });
        const appWindow = html.closest(".app.window-app");
        const dialogWindow = html.closest(".app.window-app, .dialog");
        let dialogContent = dialogWindow.find(".window-content");
        if (!dialogContent.length) dialogContent = html;
        const dialogButtons = dialogWindow.find(".dialog-buttons");

        if (appWindow.length) {
          appWindow.css({
            width: `${dialogWidth}px`,
            minWidth: `${dialogWidth}px`,
            maxWidth: `${dialogWidth}px`,
            height: `${dialogHeight}px`,
            minHeight: `${dialogHeight}px`,
            maxHeight: `${dialogHeight}px`,
          });
        }
        dialogWindow.css({
          width: `${dialogWidth}px`,
          minWidth: `${dialogWidth}px`,
          maxWidth: `${dialogWidth}px`,
          height: `${dialogHeight}px`,
          minHeight: `${dialogHeight}px`,
          maxHeight: `${dialogHeight}px`,
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          padding: "0.75rem",
          boxSizing: "border-box",
          overflow: "hidden",
          background:
            "radial-gradient(circle at top, rgba(176, 146, 89, 0.24), transparent 30%), linear-gradient(180deg, #2f281f 0%, #1e1812 100%)",
          border: "1px solid #6d5a39",
          borderRadius: "12px",
        });
        dialogContent.css({
          width: "100%",
          height: "auto",
          minHeight: "0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          flex: "1 1 auto",
          padding: "0",
          boxSizing: "border-box",
          minWidth: 0,
          background: "transparent",
          border: "0",
          borderRadius: "0",
        });
        html.css({
          width: "100%",
          height: "auto",
          minHeight: "0",
          overflow: "visible",
          minWidth: 0,
        });
        dialogButtons.css({
          flex: "0 0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "0.6rem",
          padding: "0",
          margin: "0",
          background: "transparent",
          border: "0",
          borderRadius: "0",
          boxSizing: "border-box",
        });

        const root = html[0];
        const okBtn = root.closest(".app")?.querySelector('button[data-button="ok"]');
        const cancelBtn = root.closest(".app")?.querySelector('button[data-button="cancel"]');
        if (okBtn) okBtn.disabled = true;
        [okBtn, cancelBtn].filter(Boolean).forEach((button) => {
          button.style.borderRadius = "8px";
          button.style.border = "1px solid #8a7651";
          button.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.24)";
          button.style.fontWeight = "700";
          button.style.minHeight = "2.6rem";
          button.style.transition = "transform 120ms ease, box-shadow 120ms ease, filter 120ms ease";
          button.style.color = "#2c2117";
          button.style.background = "linear-gradient(180deg, #d8d2af 0%, #b3a06a 100%)";
        });
        if (cancelBtn) {
          cancelBtn.style.background = "linear-gradient(180deg, #d9c08c 0%, #b0915d 100%)";
        }

        const cards = root.querySelectorAll(".sr-choice");
        const radios = root.querySelectorAll('input[name="pool"]');

        function updateOkState() {
          const selected = root.querySelector('input[name="pool"]:checked');
          if (okBtn) okBtn.disabled = !selected;
        }

        cards.forEach(card => {
          card.addEventListener("click", () => {
            cards.forEach(c => c.classList.remove("selected"));
            card.classList.add("selected");
            const r = card.querySelector('input[name="pool"]');
            if (r) r.checked = true;
            updateOkState();
          });
        });

        radios.forEach(r => r.addEventListener("change", updateOkState));
        updateOkState();
      }
    });

    dlg.render(true);
  });
}



  /** -------- Create chat message respecting roll mode -------- */

  async function postShortRestChat({ actor, token, label, mainBadge, bonusBadges, rolls }) {
  const speaker = ChatMessage.getSpeaker({ actor, token });
  const rollMode = game.settings.get("core", "rollMode") || "publicroll";

  const secondary = buildSecondaryStack(bonusBadges);
  const badges = buildBadgeRow(mainBadge, secondary);

  const msg = `
    <div class="chat-card" style="padding:8px 10px;">
      <div style="font-weight:700; font-size:1.05em; text-align:center;">Short Rest</div>
      <hr style="margin:6px 0; opacity:0.35;" />
      <div style="margin-bottom:10px; text-align:center;">
        <strong>${actor.name}</strong> takes a Short Rest to recover <strong>${label}</strong>.
      </div>
      ${badges}
    </div>
  `;

  // Build message data
  const messageData = {
    speaker,
    content: msg,
    type: (rolls?.length ? CONST.CHAT_MESSAGE_TYPES.ROLL : CONST.CHAT_MESSAGE_TYPES.OTHER),
    rolls: rolls ?? [],
    ...(rolls?.length ? { sound: CONFIG.sounds.dice } : {})
  };

  // IMPORTANT: this is what actually makes Self Roll / GM Roll / Blind Roll work
  ChatMessage.applyRollMode(messageData, rollMode);

  await ChatMessage.create(messageData);
}


  /** -------- Main -------- */

  (async () => {
    const { actor, token } = resolveActorToken();

    if (!actor) {
      ui.notifications.error("No token selected and no default character assigned to your user.");
      return;
    }

    // Gate: must have Short Rest uses remaining
    let shortRest = null;
    try {
      shortRest = await ensureShortRestItem(actor);
    } catch (err) {
      console.warn("Short Rest: Short Rest buff could not be created or repaired.", err);
      ui.notifications.error(err?.message || `${actor.name} could not create or repair the Short Rest buff.`);
      return;
    }
    if (!shortRest) {
      ui.notifications.error(`${actor.name} does not have a Common Buff named "Short Rest".`);
      return;
    }

    const { value } = getUses(shortRest);
    if (!Number.isFinite(value)) {
      ui.notifications.error(`"Short Rest" on ${actor.name} does not have a Uses value configured.`);
      return;
    }
    if (value <= 0) {
      ui.notifications.error(`${actor.name} has no Short Rest uses remaining today.`);
      return;
    }

    const choice = await choosePool();
    if (!choice) return;

    // Capture BEFORE values once
    let fatigueBuff = null;
    let sanityItem = null;
    try {
      fatigueBuff = await ensureFatigueBuff(actor);
      sanityItem = await ensureSanityItem(actor);
    } catch (err) {
      console.warn("Short Rest: Recovery buffs could not be created or repaired.", err);
      ui.notifications.warn(err?.message || "One or more recovery buffs could not be created or repaired.");
      fatigueBuff = findFatigueBuff(actor);
      sanityItem = findSanityItem(actor);
    }

    const fatigueBefore = fatigueBuff ? getFatigueValue(fatigueBuff) : null;

    const sanityBefore = sanityItem ? getSanityUses(sanityItem).value : null;

    // 1) Apply the chosen main effect
    let main;
    if (choice === "hp") main = await mainHitPointHeal(actor);
    else if (choice === "sp") main = await mainSpellPointRecover(actor);
    else if (choice === "fatigue") main = await mainFatigueRecover(actor, fatigueBuff);
    else if (choice === "sanity") main = await mainSanityRecover(actor, sanityItem);
    else main = { ok: false };

    // If main effect failed, do not spend use and do not post a card (keeping your original behavior).
    if (!main?.ok) return;

    // 2) Regardless of choice: try bonus fatigue and bonus sanity (using BEFORE values)
    const bonusFatigue = await tryBonusFatigue(actor, fatigueBuff, fatigueBefore);
    const bonusSanity  = await tryBonusSanity(sanityItem, sanityBefore);

    // 3) Build bonus badges
    const bonusBadges = [];

    if (bonusFatigue.applied) {
      bonusBadges.push(
        greenCircleCore({
          amountText: "-1",
          hoverText: `Roll: ${bonusFatigue.dieResult ?? bonusFatigue.total} [1d20] + ${bonusFatigue.conMod} [CON] = ${bonusFatigue.total}`,
          sizePx: 36,
          fontPx: 18
        })
      );
    }

    if (bonusSanity.applied) {
      const missing = Math.max(0, (bonusSanity.max ?? 0) - (bonusSanity.baseCur ?? 0));
      const hover = [
        `Bonus Sanity Chance: ${Math.round(bonusSanity.chancePct)}% (missing ${missing}/${bonusSanity.max})`,
        `Roll: ${bonusSanity.r1} [1d100] => success`,
        `Upgrade: ${bonusSanity.r2} [1d100] (<=${bonusSanity.upChancePct}%) => +${bonusSanity.amount}`
      ].join("\n");

      bonusBadges.push(
        purpleCircleCore({
          amountText: `+${bonusSanity.amount}`,
          hoverText: hover,
          sizePx: 36,
          fontPx: 18
        })
      );
    }

    // 4) Post chat with all rolls (main roll + bonuses)
    const rolls = [
      ...(main.rolls ?? []),
      ...(bonusFatigue?.roll ? [bonusFatigue.roll] : []),
      ...(bonusSanity?.applied ? [bonusSanity.rollChance, bonusSanity.rollUpgrade] : [])
    ].filter(Boolean);

    await postShortRestChat({
      actor,
      token,
      label: main.label,
      mainBadge: main.mainBadge,
      bonusBadges,
      rolls
    });

    // 5) Spend a Short Rest use only after successful post
    await spendOneUse(shortRest);

  })();

})();
