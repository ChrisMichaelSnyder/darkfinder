// Lantern Cycle: Off → Half → Full → Off
for (let token of canvas.tokens.controlled) {
  const bright = token.document.light.bright || 0;
  const dim = token.document.light.dim || 0;

  // Determine current mode
  let mode = "off";
  if (bright === 5 && dim === 10) mode = "half";
  else if (bright === 10 && dim === 20) mode = "full";

  // Next mode in cycle
  let updateData = {};
  if (mode === "off") {
    // Switch to Half
    updateData = {
      "light.bright": 5,
      "light.dim": 10,
      "light.alpha": 0.5,
      "light.luminosity": 0.2,
      "light.color": "#E25822",
      "light.coloration": 1,
      "light.animation": { type: "torch", speed: 6, intensity: 5 },
      "sight.range": 0
    };
  } else if (mode === "half") {
    // Switch to Full
    updateData = {
      "light.bright": 10,
      "light.dim": 20,
      "light.alpha": 0.5,
      "light.luminosity": 0.2,
      "light.color": "#E25822",
      "light.coloration": 1,
      "light.animation": { type: "torch", speed: 6, intensity: 5 },
      "sight.range": 0
    };
  } else {
    // Switch to Off
    updateData = {
      "light.bright": 0,
      "light.dim": 0,
      "light.alpha": 0,
      "light.luminosity": 0,
      "light.color": "",
      "light.coloration": 0,
      "light.animation": { type: "", speed: 0, intensity: 0 },
      "sight.range": 0 // fallback vision when off
    };
  }

  await token.document.update(updateData);
}