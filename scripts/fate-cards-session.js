import { MODULE_ID } from "./api.js";

const SOCKET_NAME = `module.${MODULE_ID}`;

const state = {
  hooksRegistered: false,
};

function registerFateCardsSessionFeature(api) {
  if (!state.hooksRegistered) {
    Hooks.once("ready", () => {
      game.socket.on(SOCKET_NAME, handleSocketMessage);
    });
    state.hooksRegistered = true;
  }

  if (!api || typeof api !== "object") return;
}

async function handleSocketMessage(message) {
  if (!message || typeof message !== "object") return;
  if (String(message.moduleId || "") !== MODULE_ID) return;
  if (String(message.type || "") !== "fate-cards:show-dialog") return;
  if (String(message.senderUserId || "") === String(game.user.id || "")) return;

  const api = game.modules.get(MODULE_ID)?.api;
  if (!api?.executeMacroFile) return;

  try {
    await api.executeMacroFile("macros/player-macros/fate-cards/fate-cards.js", null, {
      fateCardBroadcast: message.payload || {},
      suppressBroadcast: true,
      suppressChatMessage: true,
    });
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not open a broadcast Fate Cards dialog.`, error);
  }
}

export {
  registerFateCardsSessionFeature,
};
