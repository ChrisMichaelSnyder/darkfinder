// Torch Toggle (10 Bright / 20 Dim)
for (let token of canvas.tokens.controlled) {
  const isOn = (token.document.light.bright || 0) > 0;

  await token.document.update({
    "light.bright": isOn ? 0 : 10,
    "light.dim": isOn ? 0 : 20,
    "light.alpha": isOn ? 0 : 0.6,       // Softer edges
    "light.luminosity": isOn ? 0 : 0.2,  // Moderate falloff
    "light.color": isOn ? "" : "#FFAE42",// Warm orange flame
    "light.coloration": isOn ? 0 : 0.9,
    "light.animation": isOn
      ? { type: "", speed: 0, intensity: 0 }
      : { type: "torch", speed: 6, intensity: 6 },
    // Vision settings
    "sight.range": isOn ? 0 : 0   // 3 ft dim vision when flashlight OFF
  });
}