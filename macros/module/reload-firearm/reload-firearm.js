//Determine which token to use
async function resolveToken() {
  // 1) Controlled token
  const controlled = canvas.tokens.controlled?.[0];
  if (controlled) return controlled;

  const placeables = canvas.tokens.placeables ?? [];

  // 2) Token(s) for the user's assigned character
  const userChar = game.user.character;
  if (userChar) {
    const charTokens = placeables.filter(t =>
      t?.actor?.id === userChar.id && t.isOwner
    );

    if (charTokens.length === 1) return charTokens[0];
    if (charTokens.length > 1) return await pickTokenDialog(charTokens, "Choose your character token");
  }

  // 3) Any owned token fallback
  const ownedTokens = placeables.filter(t => t?.actor && t.isOwner);
  if (ownedTokens.length === 1) return ownedTokens[0];
  if (ownedTokens.length > 1) return await pickTokenDialog(ownedTokens, "Choose a token");

  return null;
}

function pickTokenDialog(tokens, title) {
  return new Promise((resolve) => {
    const options = tokens.map(t => {
      const name = t.name ?? t.actor?.name ?? "Unnamed";
      return `<option value="${t.id}">${name}</option>`;
    }).join("");

    new Dialog({
      title,
      content: `
        <p>Multiple valid tokens found on this scene. Which one should be used?</p>
        <div class="form-group">
          <label>Token</label>
          <select id="token-choice" style="width:100%">${options}</select>
        </div>
      `,
      buttons: {
        ok: {
          label: "OK",
          callback: (html) => {
            const id = html.find("#token-choice").val();
            resolve(canvas.tokens.get(id));
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

// Reload the Weapon

const token = await resolveToken();
if (!token?.actor) {
  ui.notifications.warn("No usable token found. Make sure your character has a token on this scene.");
  return;
}

const actor = token.actor;

// Weapons that use charges and are not full
const reloadable = actor.items
  .filter(i => i.type === "weapon") // PF1e: "weapon" is correct for most guns
  .filter(i => {
    const max = i.system?.uses?.max;
    const val = i.system?.uses?.value;
    return Number.isFinite(max) && max > 0 && Number.isFinite(val) && val < max;
  });

if (reloadable.length === 0) {
  ui.notifications.info("No weapons need reloading.");
  return;
}

async function reloadItem(item) {
  const maxCharges = item.system?.uses?.max;
  await item.update({ "system.uses.value": maxCharges });
  ui.notifications.info(`'${item.name}' has been reloaded (${maxCharges}).`);
}

if (reloadable.length === 1) {
  await reloadItem(reloadable[0]);
  return;
}

// Multiple weapons need reload -> prompt to choose ONE
const weaponOptions = reloadable.map(i => {
  const val = i.system.uses.value;
  const max = i.system.uses.max;
  return `<option value="${i.id}">${i.name} (${val}/${max})</option>`;
}).join("");

new Dialog({
  title: "Reload Firearm",
  content: `
    <p>Select a weapon to reload:</p>

    <div class="form-group">
      <label>Weapon</label>
      <select id="reload-weapon" style="width:100%;">
        ${weaponOptions}
      </select>
    </div>

    <!-- Spacer to prevent dropdown overlap with buttons -->
    <div style="height: 4.5em;"></div>
  `,
  buttons: {
    reload: {
      label: "Reload",
      callback: async (html) => {
        const id = html.find("#reload-weapon").val();
        const item = actor.items.get(id);
        if (!item) return ui.notifications.warn("Could not find that weapon.");
        await reloadItem(item);
      }
    },
    cancel: { label: "Cancel" }
  },
  default: "reload"
}).render(true);