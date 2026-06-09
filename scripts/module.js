import { MODULE_ID, installWorldMacros, registerApi } from "./api.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing module.`);
});

Hooks.once("ready", () => {
  const api = registerApi();
  if (!api) return;
  console.log(`${MODULE_ID} | API registered.`);

  if (!game.user?.isGM) return;
  installWorldMacros({ notify: true }).catch((error) => {
    console.warn(`${MODULE_ID} | Failed to install launcher macros.`, error);
  });
});
