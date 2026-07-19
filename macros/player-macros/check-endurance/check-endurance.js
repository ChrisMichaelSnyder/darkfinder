// Endurance Check -> pantry bonus in parentheses + SUCCESS/FAIL
// On FAIL: post chat FIRST, THEN prompt to add to the Fatigue resource
// PF1e v11.8 - Foundry v13 compatible

const DC = 10;
const GREEN = "#43a047"; // success box (white text)
const RED = "#ff4c4c"; // fail box (black text)
const FATIGUE_PACK_ID = "darkfinder.common-buffs";
const FATIGUE_NAME = "Fatigue";

/** Resolve actor/token:
 *  - If a token is selected, use it
 *  - Else fall back to the user's assigned character (game.user.character)
 *  - If neither exists, error
 */
function resolveActorToken() {
  const t = canvas.tokens.controlled[0] || null;
  if (t?.actor) return { actor: t.actor, token: t };

  const actor = game.user.character || null;
  if (!actor) return { actor: null, token: null };

  const token = actor.getActiveTokens()?.[0] || null;
  return { actor, token };
}

/** Find ACTIVE "Safehouse - Pantry..." buff level (integer).
 *  If no active Pantry buff is present, returns 0.
 */
function getPantryLevel(actor) {
  const prefix = "Safehouse - Pantry";
  const items = actor?.items ?? [];

  // Only consider Pantry buffs that are actually active.
  const matches = items.filter(i =>
    (i?.name || "").startsWith(prefix) &&
    (i.system?.active === true)
  );

  if (!matches.length) return 0;

  const buff = matches[0];

  const candidates = [
    buff.system?.level,
    buff.system?.cl,
    buff.system?.details?.level,
    buff.system?.value,
    buff.system?.bonus
  ];
  let lvl = candidates.find(v => v !== undefined && v !== null && !Number.isNaN(Number(v)));
  if (lvl === undefined) {
    const m = (buff.name || "").match(/(\d+)/);
    if (m) lvl = m[1];
  }
  lvl = Number(lvl) || 0;
  return Math.max(0, Math.floor(lvl));
}

/** Dialog to ask how many Fatigue points to add; resolves to int or null if cancelled */
function promptFatigueAmount(defaultVal = 1) {
  return new Promise((resolve) => {
    new Dialog({
      title: "Increase Fatigue",
      content: `
        <div style="margin-top:6px; text-align:center;">
          <label for="fatAdd" style="font-weight:600;">Fatigue Points to add?</label><br>
          <input id="fatAdd" type="number" min="0" step="1" value="${defaultVal}"
                 style="width:60px; text-align:center; margin-top:8px;"/>
        </div>
      `,
      buttons: {
        ok: {
          label: "Add",
          callback: (html) => {
            const raw = html.find("#fatAdd").val();
            const n = parseInt(String(raw), 10);
            resolve(Number.isFinite(n) && n >= 0 ? n : defaultVal);
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok",
      render: (html) => {
        html.closest(".dialog").css({
          width: "260px",
          minWidth: "260px"
        });
      }
    }).render(true);
  });
}

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

async function getFatigueTemplateData() {
  const pack = game.packs.get(FATIGUE_PACK_ID);
  if (!pack) {
    throw new Error(`Could not find the ${FATIGUE_PACK_ID} compendium.`);
  }

  if (!pack.index?.size && typeof pack.getIndex === "function") {
    await pack.getIndex();
  }

  const indexEntry = pack.index?.find?.((entry) => entry?.name === FATIGUE_NAME);
  if (!indexEntry?._id) {
    throw new Error(`Could not find ${FATIGUE_NAME} in ${pack.metadata?.label || FATIGUE_PACK_ID}.`);
  }

  const template = await pack.getDocument(indexEntry._id);
  if (!template) {
    throw new Error(`Could not load ${FATIGUE_NAME} from ${pack.metadata?.label || FATIGUE_PACK_ID}.`);
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

function findFatigueBuff(actor) {
  return actor.items.find((item) => item?.type === "buff" && item?.name === FATIGUE_NAME) || null;
}

function buildFatigueRepairUpdate(templateData, currentValue) {
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
  updateData.system.uses.value = currentValue;

  return flattenObject(updateData);
}

/** Ensure the Fatigue buff exists and matches the module template. */
async function ensureFatigueBuff(actor) {
  const templateData = await getFatigueTemplateData();
  const existing = findFatigueBuff(actor);

  if (!existing) {
    const [created] = await actor.createEmbeddedDocuments("Item", [templateData]);
    return created || findFatigueBuff(actor);
  }

  const currentValue = Number(existing.system?.uses?.value ?? 0) || 0;
  await existing.update(buildFatigueRepairUpdate(templateData, currentValue));
  return findFatigueBuff(actor);
}

/** Add delta to the Fatigue buff's uses.value (Limited Uses) */
async function addFatigue(actor, delta) {
  if (!delta || delta <= 0) return null;

  const fatigue = await ensureFatigueBuff(actor);
  if (!fatigue) {
    console.warn("Endurance Check: Fatigue buff could not be created or repaired on actor", actor.name);
    return null;
  }

  const cur = Number(fatigue.system?.uses?.value ?? 0) || 0;
  const next = cur + delta;

  await fatigue.update({ "system.uses.value": next });

  console.log("Endurance Check -> Fatigue buff uses updated:", { cur, next });
  return next;
}

(async () => {
  const { actor, token } = resolveActorToken();
  if (!actor) {
    ui.notifications.warn("No token selected and no default character assigned to your user.");
    return;
  }

  // Base CON mod
  const conMod = Number(actor.system?.abilities?.con?.mod ?? 0) || 0;

  // Pantry bonus (level) - only if an ACTIVE Pantry buff exists
  const pantry = getPantryLevel(actor);
  const hasPantry = pantry > 0;

  // Build & evaluate roll (v13 async style)
  const formula = hasPantry ? "1d20 + @mod + @pantry" : "1d20 + @mod";
  const rollData = { mod: conMod };
  if (hasPantry) rollData.pantry = pantry;

  const roll = new Roll(formula, rollData);
  await roll.evaluate();

  // Extract d20 face if possible
  let d20Face = null;
  try {
    d20Face = roll.dice?.find(d => d.faces === 20)?.total ?? null;
  } catch (_) {}

  const d20Part = (d20Face !== null) ? `${d20Face}` : `${roll.total - conMod - pantry}`;
  const modPart = (conMod >= 0) ? `+ ${conMod}` : `- ${Math.abs(conMod)}`;
  const pantryPart = hasPantry ? ` + (${pantry})` : "";

  const inline = `
    <div class="dice-roll endurance-roll" style="margin-top:4px;">
      <div class="dice-result">
        <div class="dice-formula" style="font-size:1.05em;">
          <i class="fas fa-dice-d20"></i>
          <strong>${d20Part}</strong> ${modPart}${pantryPart} &nbsp;=&nbsp; <strong>${roll.total}</strong>
        </div>
      </div>
    </div>
  `;

  const isSuccess = (roll.total ?? 0) >= DC;

  const badge = isSuccess
    ? `<div style="text-align:center;margin-top:10px;">
         <span style="display:inline-block;padding:8px 24px;background-color:${GREEN};
                      color:#ffffff;font-size:1.8em;font-weight:900;border-radius:8px;">
           SUCCESS
         </span>
       </div>`
    : `<div style="text-align:center;margin-top:10px;">
         <span style="display:inline-block;padding:8px 24px;background-color:${RED};
                      color:#000000;font-size:1.8em;font-weight:900;border-radius:8px;">
           FAIL
         </span>
       </div>`;

  const content = `
    <div class="chat-card" style="padding:4px 6px;">
      <header class="card-header flexrow" style="align-items:center;justify-content:space-between;">
        <h3 style="margin:0;font-size:1.2em;"><strong>Endurance Check</strong></h3>
      </header>
      <section class="card-content">
        ${inline}
        ${badge}
      </section>
    </div>
  `;

  const speaker = ChatMessage.getSpeaker({ token, actor });

  // Respect user's current roll mode (Self/Public/GM/etc)
  const rollMode = game.settings.get("core", "rollMode");

  let chatData = {
    user: game.user.id,
    speaker,
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    rolls: [roll],
    flavor: "",
    content,
    sound: CONFIG.sounds.dice
  };

  chatData = ChatMessage.applyRollMode(chatData, rollMode);

  // Post chat card
  await ChatMessage.create(chatData);

  // On FAIL: prompt and then adjust fatigue resource
  if (!isSuccess) {
    const amt = await promptFatigueAmount(1);
    if (amt !== null) {
      try {
        const newVal = await addFatigue(actor, amt);
        if (newVal !== null) {
          ui.notifications.info(`Fatigue increased by ${amt}. New fatigue value: ${newVal}.`);
        } else {
          ui.notifications.warn("Fatigue resource could not be updated.");
        }
      } catch (err) {
        console.warn("Endurance Check: Fatigue resource could not be created or updated.", err);
        ui.notifications.warn(err?.message || "Fatigue resource could not be updated.");
      }
    }
  }
})();
