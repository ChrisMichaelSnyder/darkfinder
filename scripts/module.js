import { MODULE_ID, registerApi } from "./api.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing module.`);
});

Hooks.once("ready", () => {
  const api = registerApi();
  if (!api) return;
  console.log(`${MODULE_ID} | API registered.`);
});
