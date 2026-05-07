// Short Rest Heal Macro (HP / Spell Points / Fatigue / Sanity selector)
// + Passive Bonus Fatigue & Bonus Sanity each Short Rest (regardless of choice)
// + Chat card respects the user's current roll mode (Public / GM / Blind / Self)
// PF1e 11.8, Foundry v13.346
//
(function () {

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

  /** Find "Short Rest" ability/item with uses */
  function findShortRestItem(actor) {
    const target = "short rest";
    return (actor.items ?? []).find(i => String(i.name ?? "").trim().toLowerCase() === target) || null;
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
    return (actor.items ?? []).find(i =>
      i.type === "buff" &&
      String(i.name ?? "").trim().toLowerCase() === "fatigue"
    ) || null;
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
    const target = "sanity";
    return (actor.items ?? []).find(i => {
      const nameOk = String(i.name ?? "").trim().toLowerCase() === target;
      if (!nameOk) return false;
      const max = Number(i.system?.uses?.max ?? NaN);
      return Number.isFinite(max) && max >= 0;
    }) || null;
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
        /* Give the dialog room to breathe */
        .app.window-app.dialog {
          min-width: 640px;
        }

        .sr-wrap {
          padding: 20px 28px 26px 28px; /* top | right | bottom | left */
        }

        /* 2x2 grid with more breathing room */
        .sr-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(240px, 1fr));
          gap: 26px;
          justify-content: center;
          align-items: stretch;
          padding: 14px 0 10px 0;
          max-width: 640px;
          margin: 0 auto;
        }

        /* Mobile fallback */
        @media (max-width: 700px) {
          .app.window-app.dialog {
            min-width: unset;
          }

          .sr-grid {
            grid-template-columns: 1fr;
            max-width: 420px;
          }
        }

        .sr-choice {
          border: 1px solid rgba(255,255,255,0.22);
          border-radius: 14px;
          padding: 18px 16px;
          cursor: pointer;
          user-select: none;
          text-align: center;
          background: rgba(255,255,255,0.02);
        }

        .sr-choice:hover {
          border-color: rgba(255,255,255,0.4);
          box-shadow: 0 4px 14px rgba(0,0,0,0.35);
        }

        .sr-choice input { display: none; }

        .sr-choice.selected {
          border-color: rgba(255,255,255,0.6);
          box-shadow:
            0 0 0 2px rgba(255,255,255,0.14) inset,
            0 6px 18px rgba(0,0,0,0.45);
        }

        .sr-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 10px;
          font-weight: 800;
          font-size: 1.05em;
        }

        .sr-sub {
          opacity: 0.8;
          font-size: 0.95em;
          line-height: 1.35;
          padding: 0 6px;
        }

        /* Icons */
        .sr-heart {
          width: 16px;
          height: 14px;
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
          width: 16px;
          height: 14px;
          background: #ff2d2d;
          border-radius: 50%;
        }
        .sr-heart:before { top: -8px; left: 0; }
        .sr-heart:after  { top: 0; left: 8px; }

        .sr-diamond {
          width: 16px;
          height: 16px;
          background: #2a7bff;
          transform: rotate(45deg);
          border-radius: 3px;
          box-shadow: 0 0 4px rgba(42,123,255,0.7);
        }

        .sr-green {
          width: 16px;
          height: 16px;
          background: #18b83a;
          border-radius: 999px;
          box-shadow: 0 0 4px rgba(24,184,58,0.6);
        }

        .sr-purple {
          width: 16px;
          height: 16px;
          background: #8b3dff;
          border-radius: 999px;
          box-shadow: 0 0 4px rgba(139,61,255,0.65);
        }
      </style>

      <div class="sr-wrap">
        <form class="sr-form">
          <div style="text-align:center; margin-bottom:16px; opacity:0.85; font-size:1.05em;">
            What are you recovering?
          </div>

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
        const root = html[0];
        const okBtn = root.closest(".app")?.querySelector('button[data-button="ok"]');
        if (okBtn) okBtn.disabled = true;

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
    const shortRest = findShortRestItem(actor);
    if (!shortRest) {
      ui.notifications.error(`${actor.name} does not have an ability/item named "Short Rest".`);
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
    const fatigueBuff = findFatigueBuff(actor);
    const fatigueBefore = fatigueBuff ? getFatigueValue(fatigueBuff) : null;

    const sanityItem = findSanityItem(actor);
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