(async () => {
  const controlledTokens = canvas.tokens.controlled.filter((token) => token?.actor);
  const fallbackActor = game.user.character || null;
  const fallbackTokens = fallbackActor?.getActiveTokens?.() || [];
  const targetTokens = controlledTokens.length
    ? controlledTokens
    : fallbackTokens.filter((token) => token?.actor);

  if (!targetTokens.length) {
    return ui.notifications.warn("Select a token or assign an active character before using Carried Light.");
  }

  const LIGHT_SOURCE_ORDER = ["flashlight", "lantern", "torch", "candle"];
  const LIGHT_SOURCE_CONFIG = {
    candle: {
      apply: (token) => {
        const isOn = (token.document.light.bright || 0) > 0;
        return {
          isOn: !isOn,
          updateData: {
            "light.bright": isOn ? 0 : 4,
            "light.dim": isOn ? 0 : 10,
            "light.alpha": isOn ? 0 : 0.4,
            "light.luminosity": isOn ? 0 : 0.2,
            "light.color": isOn ? "" : "#FFAE42",
            "light.coloration": isOn ? 0 : 0.9,
            "light.animation": isOn
              ? { type: "", speed: 0, intensity: 0 }
              : { type: "torch", speed: 6, intensity: 7 },
            "sight.range": 0,
          },
        };
      },
    },
    flashlight: {
      apply: (token) => {
        const isOn = (token.document.light.bright || 0) > 0;
        return {
          isOn: !isOn,
          updateData: {
            "light.bright": isOn ? 0 : 15,
            "light.dim": isOn ? 0 : 25,
            "light.alpha": isOn ? 0 : 0.3,
            "light.luminosity": isOn ? 0 : 0.1,
            "light.color": isOn ? "" : "#ffffff",
            "light.coloration": isOn ? 0 : 0.9,
            "light.animation": isOn
              ? { type: "", speed: 0, intensity: 0 }
              : { type: "pulse", speed: 0.5, intensity: 0.5 },
            "sight.range": 0,
          },
        };
      },
    },
    lantern: {
      apply: (token) => {
        const bright = token.document.light.bright || 0;
        const dim = token.document.light.dim || 0;

        let mode = "off";
        if (bright === 5 && dim === 10) mode = "half";
        else if (bright === 10 && dim === 20) mode = "full";

        if (mode === "off") {
          return {
            isOn: true,
            stage: "half",
            updateData: {
              "light.bright": 5,
              "light.dim": 10,
              "light.alpha": 0.5,
              "light.luminosity": 0.2,
              "light.color": "#E25822",
              "light.coloration": 1,
              "light.animation": { type: "torch", speed: 6, intensity: 5 },
              "sight.range": 0,
            },
          };
        }

        if (mode === "half") {
          return {
            isOn: true,
            stage: "full",
            updateData: {
              "light.bright": 10,
              "light.dim": 20,
              "light.alpha": 0.5,
              "light.luminosity": 0.2,
              "light.color": "#E25822",
              "light.coloration": 1,
              "light.animation": { type: "torch", speed: 6, intensity: 5 },
              "sight.range": 0,
            },
          };
        }

        return {
          isOn: false,
          stage: "off",
          updateData: {
            "light.bright": 0,
            "light.dim": 0,
            "light.alpha": 0,
            "light.luminosity": 0,
            "light.color": "",
            "light.coloration": 0,
            "light.animation": { type: "", speed: 0, intensity: 0 },
            "sight.range": 0,
          },
        };
      },
    },
    torch: {
      apply: (token) => {
        const isOn = (token.document.light.bright || 0) > 0;
        return {
          isOn: !isOn,
          updateData: {
            "light.bright": isOn ? 0 : 10,
            "light.dim": isOn ? 0 : 20,
            "light.alpha": isOn ? 0 : 0.6,
            "light.luminosity": isOn ? 0 : 0.2,
            "light.color": isOn ? "" : "#FFAE42",
            "light.coloration": isOn ? 0 : 0.9,
            "light.animation": isOn
              ? { type: "", speed: 0, intensity: 0 }
              : { type: "torch", speed: 6, intensity: 6 },
            "sight.range": 0,
          },
        };
      },
    },
  };

  const notices = [];
  const successMessages = [];

  for (const token of targetTokens) {
    const actor = token.actor;
    const inventoryLightItems = getInventoryLightItems(actor);
    const matchedItems = getEquippedLightItems(actor);

    if (!matchedItems.length) {
      if (inventoryLightItems.length) {
        notices.push(`${actor.name}: a carried light source is in their inventory but not equipped.`);
      } else {
        notices.push(`${actor.name}: no candle, torch, lantern, or flashlight found in inventory.`);
      }
      continue;
    }

    if (matchedItems.length > 1) {
      notices.push(`${actor.name}: multiple equipped light sources found (${matchedItems.map((item) => item.name).join(", ")}).`);
      continue;
    }

    const lightSource = matchedItems[0];
    const config = LIGHT_SOURCE_CONFIG[lightSource.key];
    if (!config) {
      notices.push(`${actor.name}: unsupported light source "${lightSource.name}".`);
      continue;
    }

    const result = config.apply(token);
    await token.document.update(result.updateData);
    successMessages.push(buildSuccessMessage(actor.name, lightSource.key, result));
  }

  if (successMessages.length) {
    ui.notifications.info(successMessages.join(" "));
  }

  if (notices.length) {
    ui.notifications.warn(notices.join(" "));
  }

  function getInventoryLightItems(actor) {
    return LIGHT_SOURCE_ORDER.flatMap((key) => (
      (actor.items || [])
        .filter((item) => normalizeItemName(item?.name) === key)
        .map((item) => ({ key, name: item.name, item }))
    ));
  }

  function getEquippedLightItems(actor) {
    return LIGHT_SOURCE_ORDER.flatMap((key) => (
      (actor.items || [])
        .filter((item) => normalizeItemName(item?.name) === key && isItemEquipped(item))
        .map((item) => ({ key, name: item.name, item }))
    ));
  }

  function normalizeItemName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function capitalize(value) {
    const text = String(value || "").trim();
    return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
  }

  function buildSuccessMessage(actorName, lightKey, result) {
    const lightLabel = capitalize(lightKey);
    const actionText = result.isOn ? "turned on" : "turned off";
    const stageText = lightKey === "lantern" && result.stage
      ? ` Stage ${capitalize(result.stage)}.`
      : "";
    return `${actorName} turned ${result.isOn ? "on" : "off"} their ${lightLabel}.${stageText}`;
  }

  function isItemEquipped(item) {
    const truthy = (value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value === 1;
      if (typeof value === "string") return ["1", "true", "yes", "on", "equipped"].includes(value.trim().toLowerCase());
      return false;
    };

    const equippedPaths = [
      ["system", "equipped"],
      ["system", "equipped", "value"],
      ["system", "equipped", "current"],
      ["system", "equipped", "equipped"],
      ["system", "equipment", "equipped"],
      ["system", "worn"],
      ["data", "equipped"],
      ["data", "data", "equipped"],
    ];

    for (const path of equippedPaths) {
      if (truthy(getObjectPath(item, path))) return true;
    }

    return false;
  }

  function getObjectPath(object, path) {
    return path.reduce((current, key) => (current && current[key] !== undefined ? current[key] : null), object);
  }
})();
