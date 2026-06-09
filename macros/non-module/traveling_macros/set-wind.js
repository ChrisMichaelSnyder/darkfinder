(async () => {
  const FLAG_SCOPE = "core";
  const FLAG_KEY = "darkfinderTravel.windState";

  const scene = canvas?.scene;
  if (!scene) {
    ui.notifications.warn("No active scene is available.");
    return;
  }

  const DIRECTIONS = [
    { key: "N", label: "North", dx: 0, dy: -1 },
    { key: "NE", label: "North East", dx: 1, dy: -1 },
    { key: "E", label: "East", dx: 1, dy: 0 },
    { key: "SE", label: "South East", dx: 1, dy: 1 },
    { key: "S", label: "South", dx: 0, dy: 1 },
    { key: "SW", label: "South West", dx: -1, dy: 1 },
    { key: "W", label: "West", dx: -1, dy: 0 },
    { key: "NW", label: "North West", dx: -1, dy: -1 },
  ];

  const rollDirection = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
  const strength = Math.floor(Math.random() * 6) + 3;

  const windState = {
    directionKey: rollDirection.key,
    directionLabel: rollDirection.label,
    dx: rollDirection.dx,
    dy: rollDirection.dy,
    strength,
    sceneId: scene.id,
    updatedAt: new Date().toISOString(),
  };

  await scene.setFlag(FLAG_SCOPE, FLAG_KEY, windState);
  const accentColor = "#5a7d4d";
  const content = `
    <div style="display:flex;justify-content:center;padding:0.35rem 0;">
      <div style="min-width:280px;max-width:100%;padding:1rem 1.2rem;border:1px solid #8f8674;border-radius:10px;background:linear-gradient(180deg, #f3ecd9 0%, #ddd2b7 100%);box-shadow:0 3px 10px rgba(0,0,0,0.12);text-align:center;color:#241f18;">
        <div style="font-size:1rem;font-weight:700;line-height:1.25;">The wind is blowing to the</div>
        <div style="margin-top:0.35rem;font-size:2rem;font-weight:900;line-height:1.05;color:${accentColor};letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(windState.directionLabel)}</div>
        <div style="margin-top:0.8rem;font-size:1rem;font-weight:700;line-height:1.25;">with a strength of</div>
        <div style="margin-top:0.35rem;font-size:2rem;font-weight:900;line-height:1.05;color:${accentColor};">${escapeHtml(String(windState.strength))}</div>
      </div>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker(),
    content,
  });

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
