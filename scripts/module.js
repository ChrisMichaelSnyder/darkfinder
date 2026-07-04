import { MODULE_ID, registerApi } from "./api.js";
import { registerRandomLootSessionFeature } from "./random-loot-session.js";

registerRandomLootSessionFeature();

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing module.`);
});

Hooks.once("ready", () => {
  const api = registerApi();
  if (!api) return;
  registerRandomLootSessionFeature(api);
  registerSpellAttackChatLinkHook(api);
  console.log(`${MODULE_ID} | API registered.`);
});

function registerSpellAttackChatLinkHook(api) {
  Hooks.on("renderChatMessageHTML", (message, element) => {
    const root = element instanceof HTMLElement ? element : null;
    if (!root) return;

    const buttons = root.querySelectorAll("[data-spellcrafting-spell-attack='true']");
    if (!buttons.length) return;

    for (const button of buttons) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
        if (!target) return;

        await api.executeMacroFile("macros/player-macros/spell-crafter/spell-attack.js", null, {
          actorUuid: String(target.dataset.actorUuid || "").trim(),
          spellbookId: String(target.dataset.spellbookId || "").trim(),
          school: String(target.dataset.spellSchool || "").trim(),
          savingThrow: String(target.dataset.savingThrow || "").trim(),
          spellName: String(target.dataset.spellName || "").trim(),
          skipDialog: true,
        });
      });
    }
  });
}
