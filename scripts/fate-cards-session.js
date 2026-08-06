import { MODULE_ID, getMacroUrl } from "./api.js";

const SOCKET_NAME = `module.${MODULE_ID}`;

const state = {
  hooksRegistered: false,
};

function registerFateCardsSessionFeature(api) {
  if (!state.hooksRegistered) {
    if (game.ready) {
      game.socket.on(SOCKET_NAME, handleSocketMessage);
    } else {
      Hooks.once("ready", () => {
        game.socket.on(SOCKET_NAME, handleSocketMessage);
      });
    }
    state.hooksRegistered = true;
  }

  if (!api || typeof api !== "object") return;
}

async function handleSocketMessage(message) {
  if (!message || typeof message !== "object") return;
  if (String(message.moduleId || "") !== MODULE_ID) return;
  if (String(message.type || "") !== "fate-cards:show-dialog") return;
  if (String(message.senderUserId || "") === String(game.user.id || "")) return;

  try {
    await executeFateCardsMacro({
      fateCardBroadcast: message.payload || {},
      suppressBroadcast: true,
      suppressChatMessage: true,
    });
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not open a broadcast Fate Cards dialog.`, error);
  }
}

async function executeFateCardsMacro(scopeData) {
  const api = game.modules.get(MODULE_ID)?.api;
  if (api?.executeMacroFile) {
    return api.executeMacroFile("macros/player-macros/fate-cards/fate-cards.js", null, scopeData);
  }

  const response = await fetch(getMacroUrl("macros/player-macros/fate-cards/fate-cards.js"), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load Fate Cards macro source (${response.status}).`);
  }

  const source = await response.text();
  const AsyncFunction = async function () {}.constructor;
  const runner = new AsyncFunction("scope", source);
  return runner.call(null, scopeData || {});
}

export {
  registerFateCardsSessionFeature,
};
