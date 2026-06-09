// PF1e v11.8 — Foundry v13 compatible

const DC     = 10;
const GREEN  = "#43a047"; // SUCCESS
const RED    = "#ff4c4c"; // FAIL
const BLUE   = "#2a7bff"; // STABILIZED
const BLACK  = "#000000"; // DEATH

/** Prefer selected token; else fall back to user's assigned character */
function resolveActorToken() {
  const t = canvas.tokens.controlled[0] || null;
  if (t?.actor) return { actor: t.actor, token: t };

  const actor = game.user.character || null;
  if (!actor) return { actor: null, token: null };

  const token = actor.getActiveTokens()?.[0] || null;
  return { actor, token };
}

/** Find ACTIVE "Safehouse - Pantry..." buff level (integer). If none, returns 0. */
function getPantryLevel(actor) {
  const prefix = "Safehouse - Pantry";
  const items = actor?.items ?? [];
  const matches = items.filter(i =>
    (i?.name || "").startsWith(prefix) &&
    i.system?.active === true
  );
  if (!matches.length) return 0;

  const buff = matches[0];
  let lvl =
    buff.system?.level ??
    buff.system?.cl ??
    buff.system?.details?.level ??
    buff.system?.value ??
    buff.system?.bonus;

  if (lvl === undefined) {
    const m = (buff.name || "").match(/(\d+)/);
    if (m) lvl = m[1];
  }
  return Math.max(0, Math.floor(Number(lvl) || 0));
}

/** Find the "Resolve" feature/item with Uses configured */
function findResolveItem(actor) {
  return (actor.items ?? []).find(i =>
    String(i.name ?? "").trim().toLowerCase() === "resolve"
  ) || null;
}

/** Get Resolve uses.value safely (returns number or NaN) */
function getResolveUses(item) {
  return Number(item?.system?.uses?.value ?? NaN);
}

/** Spend 1 use of Resolve (system.uses.value) if possible */
async function spendResolve(item) {
  const cur = getResolveUses(item);
  if (!Number.isFinite(cur) || cur <= 0) return { ok: false, cur };
  const next = Math.max(0, cur - 1);
  await item.update({ "system.uses.value": next });
  return { ok: true, cur, next };
}

/** Badge HTML */
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

(async () => {
  const { actor, token } = resolveActorToken();
  if (!actor) {
    ui.notifications.error("No token selected and no default character assigned.");
    return;
  }

  // Mods / bonuses
  const conMod = Number(actor.system?.abilities?.con?.mod ?? 0) || 0;
  const pantry = getPantryLevel(actor);
  const hasPantry = pantry > 0;

  // Roll
  const formula = hasPantry ? "1d20 + @mod + @pantry" : "1d20 + @mod";
  const roll = new Roll(formula, { mod: conMod, pantry });
  await roll.evaluate();

  // Natural d20 face
  let d20 = null;
  try { d20 = roll.dice?.find(d => d.faces === 20)?.total ?? null; } catch (_) {}
  const d20Face = (d20 !== null) ? d20 : (Number(roll.total ?? 0) - conMod - pantry);

  const isNat20 = d20Face === 20;
  const isSuccess = isNat20 || (Number(roll.total ?? 0) >= DC);

  // Inline roll display (matches Endurance style)
  const modPart    = (conMod >= 0) ? `+ ${conMod}` : `- ${Math.abs(conMod)}`;
  const pantryPart = hasPantry ? ` + (${pantry})` : "";

  const inline = `
    <div class="dice-roll endurance-roll" style="margin-top:4px;">
      <div class="dice-result">
        <div class="dice-formula" style="font-size:1.05em;">
          <i class="fas fa-dice-d20"></i>
          <strong>${d20Face}</strong> ${modPart}${pantryPart} &nbsp;⇒&nbsp; <strong>${roll.total}</strong>
        </div>
      </div>
    </div>
  `;

  // Resolve info (for footer text)
  const resolveItem = findResolveItem(actor);
  const resolveUses = getResolveUses(resolveItem);

  let badgeHtml = "";
  let footer = "";
  let spend = false;

  if (isNat20) {
    badgeHtml = badge({ text: "STABILIZED", bg: BLUE, fg: "#ffffff" });
    footer = `
      <div style="margin-top:8px;text-align:center;font-weight:800;">
        Resolve: ${Number.isFinite(resolveUses) ? resolveUses : "—"}
      </div>`;
  } else if (isSuccess) {
    badgeHtml = badge({ text: "SUCCESS", bg: GREEN, fg: "#ffffff" });
    footer = `
      <div style="margin-top:8px;text-align:center;font-weight:800;">
        Resolve: ${Number.isFinite(resolveUses) ? resolveUses : "—"}
      </div>`;
  } else {
    // Failed: if Resolve is 0 => DEATH, else FAIL and spend 1
    if (Number.isFinite(resolveUses) && resolveUses <= 0) {
      badgeHtml = badge({ text: "DEATH", bg: BLACK, fg: "#ffffff" });
      footer = `
        <div style="margin-top:8px;text-align:center;font-weight:800;">
          Resolve Remaining: --
        </div>`;
    } else {
      badgeHtml = badge({ text: "FAIL", bg: RED, fg: "#000000" });
      spend = true;
      footer = `
        <div style="margin-top:8px;text-align:center;font-weight:800;">
          Remaining Resolve: ${Number.isFinite(resolveUses) ? Math.max(0, resolveUses - 1) : "—"}
        </div>`;
    }
  }

  const content = `
    <div class="chat-card" style="padding:4px 6px;">
      <header class="card-header flexrow" style="align-items:center;justify-content:space-between;">
        <h3 style="margin:0;font-size:1.2em;"><strong>Resolve Check</strong></h3>
      </header>
      <section class="card-content">
        ${inline}
        ${badgeHtml}
        ${footer}
      </section>
    </div>
  `;

  // Respect user's roll mode (Self/Public/GM/etc)
  let chatData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor, token }),
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    rolls: [roll],
    content,
    sound: CONFIG.sounds.dice
  };

  chatData = ChatMessage.applyRollMode(chatData, game.settings.get("core", "rollMode"));

  // Post chat card first
  await ChatMessage.create(chatData);

  // On FAIL (non-death), spend Resolve after posting
  if (spend && resolveItem) {
    await spendResolve(resolveItem);
  }
})();