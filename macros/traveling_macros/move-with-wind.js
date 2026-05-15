(async () => {
  const FLAG_SCOPE = "core";
  const FLAG_KEY = "darkfinderTravel.windState";
  const STEPS = 20;

  const scene = canvas?.scene;
  if (!scene) {
    ui.notifications.warn("No active scene is available.");
    return;
  }

  if (!game.user.isGM) {
    ui.notifications.warn("Only a GM can move scene tiles.");
    return;
  }

  const windState = scene.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!windState?.directionLabel || !Number.isFinite(Number(windState.strength))) {
    ui.notifications.warn("No stored wind was found for this scene. Run the wind-setting macro first.");
    return;
  }

  const gridSize = Number(canvas.grid?.size ?? canvas.dimensions?.size ?? 0);
  if (!gridSize) {
    ui.notifications.warn("Could not determine the scene grid size.");
    return;
  }

  const dx = Number(windState.dx || 0);
  const dy = Number(windState.dy || 0);
  const strength = Math.max(0, Math.floor(Number(windState.strength) || 0));
  if (!strength || (!dx && !dy)) {
    ui.notifications.warn("The stored wind data is incomplete.");
    return;
  }

  const offsetX = dx * gridSize * strength;
  const offsetY = dy * gridSize * strength;
  const duration = Math.max(900, strength * 350);
  const frameMs = duration / STEPS;

  const unlockedTiles = canvas.tiles.placeables.filter((tile) => !tile.document.locked);
  if (!unlockedTiles.length) {
    ui.notifications.info("There are no unlocked tiles on this scene to move.");
    return;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
  const tileData = unlockedTiles.map((tile) => ({
    id: tile.document.id,
    obj: tile,
    startX: tile.document.x,
    startY: tile.document.y,
    endX: tile.document.x + offsetX,
    endY: tile.document.y + offsetY,
  }));

  try {
    for (let i = 1; i <= STEPS; i += 1) {
      const tNorm = i / STEPS;
      const t = ease(tNorm);

      for (const td of tileData) {
        const visX = i === STEPS
          ? td.endX
          : td.startX + ((td.endX - td.startX) * t);
        const visY = i === STEPS
          ? td.endY
          : td.startY + ((td.endY - td.startY) * t);

        td.obj.document.x = visX;
        td.obj.document.y = visY;
        td.obj.renderFlags.set({ refreshPosition: true });
      }

      if (i < STEPS) await sleep(frameMs);
    }

    const updates = tileData.map((td) => ({
      _id: td.id,
      x: td.endX,
      y: td.endY,
    }));

    await scene.updateEmbeddedDocuments("Tile", updates, { animate: false });

    ui.notifications.info(
      `Moved ${updates.length} unlocked tile${updates.length === 1 ? "" : "s"} ${windState.directionLabel} by ${strength} square${strength === 1 ? "" : "s"}.`,
    );
  } catch (err) {
    console.error(err);
    ui.notifications.error(`Wind movement macro failed: ${err.message}`);
  }
})();
