// Flashlight Toggle (15 Bright / 30 Dim)
for (let token of canvas.tokens.controlled) {
  const isOn = (token.document.light.bright || 0) > 0;

  await token.document.update({
    "light.bright": isOn ? 0 : 15,
    "light.dim": isOn ? 0 : 25,
    "light.alpha": isOn ? 0 : 0.3,
    "light.luminosity": isOn ? 0 : 0.1,
    "light.color": isOn ? "" : "#ffffff",// Cool white
    "light.coloration": isOn ? 0 : 0.9,
    "light.animation": isOn
      ? { type: "", speed: 0, intensity: 0 }
      : { type: "pulse", speed: 0.5, intensity: 0.5 },
    // Vision settings
    "sight.range": isOn ? 0 : 0   // 3 ft dim vision when flashlight OFF
  });
}