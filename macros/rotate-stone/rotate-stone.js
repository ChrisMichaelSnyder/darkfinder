// Rotate selected square tiles 90° clockwise, and rotate the positions of:
//  - Tokens whose centers are on those tiles
//  - Other tiles whose centers are on those tiles
//  - Light sources whose centers are on those tiles
//
// Selected tiles keep the same smooth rotation animation.
// Tokens, overlay tiles, and lights are visually animated during the spin,
// then committed to their final positions at the end.
//
// Foundry VTT v13, Pathfinder 1e 11.8 compatible.

// ======================
// CONFIG
// ======================
const DURATION_MS = 1000; // tile rotation animation time
const STEPS = 20;         // frames of tile rotation animation

const SOUND_PATH = "worlds/whispers-in-the-dust/sounds/moving-stone.mp3";
const SOUND_FOR_EVERYONE = true;

// subtle anti-repetition variation
const SOUND_BASE_VOLUME = 0.8;
const SOUND_VOLUME_JITTER = 0.3; // actual volume = base ± this

// ---- BASIC CHECKS ----
if (!canvas.scene) {
  ui.notifications.error("No active scene.");
  return;
}

const selectedTileObjs = canvas.tiles.controlled;
if (!selectedTileObjs.length) {
  ui.notifications.warn("Select one or more tiles first.");
  return;
}

const grid = canvas.grid;
if (!grid) {
  ui.notifications.error("This scene has no grid.");
  return;
}

const gridSize = grid.size;
const tokenObjs = canvas.tokens.placeables;
const allTileObjs = canvas.tiles.placeables;
const lightObjs = canvas.lighting?.placeables ?? [];

// Easing + sleep helpers
const frameMs = DURATION_MS / STEPS;
const ease = t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t); // easeInOutQuad
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function degToRad(deg) {
  return deg * (Math.PI / 180);
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Correct clockwise rotation in screen coordinates
function rotatePointCW(px, py, cx, cy, angleRad) {
  const dx = px - cx;
  const dy = py - cy;

  return {
    x: cx + (dx * Math.cos(angleRad) - dy * Math.sin(angleRad)),
    y: cy + (dx * Math.sin(angleRad) + dy * Math.cos(angleRad))
  };
}

async function playVariedStoneSound() {
  // Wait for browser audio unlock if needed
  if (game.audio?.locked && game.audio?.unlock) {
    await game.audio.unlock;
  }

  // Ask connected clients to begin preloading this sound,
  // and preload locally too before animation starts.
  if (typeof game.audio?.preload === "function") {
    await game.audio.preload(SOUND_PATH);
  } else {
    await AudioHelper.preloadSound(SOUND_PATH);
  }

  const volume = clamp(
    SOUND_BASE_VOLUME + randRange(-SOUND_VOLUME_JITTER, SOUND_VOLUME_JITTER),
    0,
    1
  );

  // Broadcast one-off playback to all connected clients.
  // This is the documented broadcast-capable path.
  AudioHelper.play({
    src: SOUND_PATH,
    volume,
    autoplay: true,
    loop: false,
    channel: "interface"
  }, SOUND_FOR_EVERYONE);
}

// ======================
// GATHER ROTATION TARGETS
// ======================

const baseTileIds = new Set(selectedTileObjs.map(t => t.id));

const tilesData = [];                    // base tiles: { id, startRotation, cx, cy }
const tokensDataMap = new Map();         // tokenId -> data
const overlayTilesDataMap = new Map();   // tileId -> data
const lightsDataMap = new Map();         // lightId -> data

for (const tileObj of selectedTileObjs) {
  const tile = tileObj.document;

  const tileX = tile.x;
  const tileY = tile.y;
  const tileW = tile.width;
  const tileH = tile.height;

  // Only handle perfect squares in the rotation logic
  if (tileW !== tileH || tileW % gridSize !== 0) {
    ui.notifications.warn(`Tile "${tile.id}" is not a square multiple of the grid. Skipping.`);
    continue;
  }

  const N = tileW / gridSize;
  const startRotation = tile.rotation;
  const cx = tileX + tileW / 2;
  const cy = tileY + tileH / 2;

  tilesData.push({
    id: tile.id,
    obj: tileObj,
    startRotation,
    tileX,
    tileY,
    tileW,
    tileH,
    cx,
    cy
  });

  const minX = tileX;
  const maxX = tileX + tileW;
  const minY = tileY;
  const maxY = tileY + tileH;

  // ---- TOKENS ON THIS TILE ----
  for (const tokenObj of tokenObjs) {
    const tok = tokenObj.document;
    if (tokensDataMap.has(tok.id)) continue;

    const tokWpx = tok.width * gridSize;
    const tokHpx = tok.height * gridSize;
    const centerX = tok.x + tokWpx / 2;
    const centerY = tok.y + tokHpx / 2;

    const onTile = centerX >= minX && centerX <= maxX && centerY >= minY && centerY <= maxY;
    if (!onTile) continue;

    const localX = centerX - tileX;
    const localY = centerY - tileY;

    let col = Math.floor(localX / gridSize);
    let row = Math.floor(localY / gridSize);
    if (col < 0 || col >= N || row < 0 || row >= N) continue;

    const newRow = col;
    const newCol = N - 1 - row;

    const nx = tileX + (newCol + 0.5) * gridSize;
    const ny = tileY + (newRow + 0.5) * gridSize;

    let endX = nx - tokWpx / 2;
    let endY = ny - tokHpx / 2;

    const snapped = grid.getSnappedPosition(endX, endY, 1);
    endX = snapped.x;
    endY = snapped.y;

    const skipAnimation = (centerX === cx && centerY === cy);

    tokensDataMap.set(tok.id, {
      id: tok.id,
      obj: tokenObj,
      startDocX: tok.x,
      startDocY: tok.y,
      startCenterX: centerX,
      startCenterY: centerY,
      endX,
      endY,
      widthPx: tokWpx,
      heightPx: tokHpx,
      cx,
      cy,
      skipAnimation
    });
  }

  // ---- OVERLAY TILES ON THIS TILE ----
  for (const otherTileObj of allTileObjs) {
    const other = otherTileObj.document;

    if (baseTileIds.has(other.id)) continue;
    if (overlayTilesDataMap.has(other.id)) continue;

    const centerX = other.x + other.width / 2;
    const centerY = other.y + other.height / 2;

    const onTile = centerX >= minX && centerX <= maxX && centerY >= minY && centerY <= maxY;
    if (!onTile) continue;

    const localX = centerX - tileX;
    const localY = centerY - tileY;

    let col = Math.floor(localX / gridSize);
    let row = Math.floor(localY / gridSize);
    if (col < 0 || col >= N || row < 0 || row >= N) continue;

    const newRow = col;
    const newCol = N - 1 - row;

    const nx = tileX + (newCol + 0.5) * gridSize;
    const ny = tileY + (newRow + 0.5) * gridSize;

    let endX = nx - other.width / 2;
    let endY = ny - other.height / 2;

    const snapped = grid.getSnappedPosition(endX, endY, 1);
    endX = snapped.x;
    endY = snapped.y;

    const skipAnimation = (centerX === cx && centerY === cy);

    overlayTilesDataMap.set(other.id, {
      id: other.id,
      obj: otherTileObj,
      startDocX: other.x,
      startDocY: other.y,
      startCenterX: centerX,
      startCenterY: centerY,
      endX,
      endY,
      widthPx: other.width,
      heightPx: other.height,
      cx,
      cy,
      skipAnimation
    });
  }

  // ---- LIGHTS ON THIS TILE ----
  for (const lightObj of lightObjs) {
    const light = lightObj.document;
    if (lightsDataMap.has(light.id)) continue;

    const lx = light.x;
    const ly = light.y;

    const onTile = lx >= minX && lx <= maxX && ly >= minY && ly <= maxY;
    if (!onTile) continue;

    const localX = lx - tileX;
    const localY = ly - tileY;

    let col = Math.floor(localX / gridSize);
    let row = Math.floor(localY / gridSize);
    if (col < 0 || col >= N || row < 0 || row >= N) continue;

    const newRow = col;
    const newCol = N - 1 - row;

    const nx = tileX + (newCol + 0.5) * gridSize;
    const ny = tileY + (newRow + 0.5) * gridSize;

    const snapped = grid.getSnappedPosition(nx, ny, 1);

    const skipAnimation = (lx === cx && ly === cy);

    lightsDataMap.set(light.id, {
      id: light.id,
      obj: lightObj,
      startDocX: light.x,
      startDocY: light.y,
      startCenterX: lx,
      startCenterY: ly,
      endX: snapped.x,
      endY: snapped.y,
      cx,
      cy,
      skipAnimation
    });
  }
}

if (!tilesData.length) {
  ui.notifications.warn("No valid square selected tiles for rotation.");
  return;
}

const tokensData = Array.from(tokensDataMap.values());
const overlayTilesData = Array.from(overlayTilesDataMap.values());
const lightsData = Array.from(lightsDataMap.values());

// ======================
// RUN SOUND PRELOAD, THEN ANIMATE
// ======================

(async () => {
  try {
    // Wait for sound to be ready, then play it for everyone
    await playVariedStoneSound();

    // ======================
    // ANIMATE TILE + RIDERS TOGETHER
    // ======================
    for (let i = 1; i <= STEPS; i++) {
      const tNorm = i / STEPS;
      const t = ease(tNorm);
      const angleRad = degToRad(90 * t);

      const tileFrameUpdates = tilesData.map(td => {
        const rotation = (td.startRotation + 90 * t) % 360;
        return { _id: td.id, rotation };
      });

      if (tileFrameUpdates.length) {
        await canvas.scene.updateEmbeddedDocuments("Tile", tileFrameUpdates, { animate: false });
      }

      for (const td of tokensData) {
        if (td.skipAnimation) continue;

        let visX, visY;
        if (i === STEPS) {
          visX = td.endX;
          visY = td.endY;
        } else {
          const rotated = rotatePointCW(td.startCenterX, td.startCenterY, td.cx, td.cy, angleRad);
          visX = rotated.x - td.widthPx / 2;
          visY = rotated.y - td.heightPx / 2;
        }

        td.obj.document.x = visX;
        td.obj.document.y = visY;
        td.obj.renderFlags.set({ refreshPosition: true });
      }

      for (const od of overlayTilesData) {
        if (od.skipAnimation) continue;

        let visX, visY;
        if (i === STEPS) {
          visX = od.endX;
          visY = od.endY;
        } else {
          const rotated = rotatePointCW(od.startCenterX, od.startCenterY, od.cx, od.cy, angleRad);
          visX = rotated.x - od.widthPx / 2;
          visY = rotated.y - od.heightPx / 2;
        }

        od.obj.document.x = visX;
        od.obj.document.y = visY;
        od.obj.renderFlags.set({ refreshPosition: true });
      }

      for (const ld of lightsData) {
        if (ld.skipAnimation) continue;

        let visX, visY;
        if (i === STEPS) {
          visX = ld.endX;
          visY = ld.endY;
        } else {
          const rotated = rotatePointCW(ld.startCenterX, ld.startCenterY, ld.cx, ld.cy, angleRad);
          visX = rotated.x;
          visY = rotated.y;
        }

        ld.obj.document.x = visX;
        ld.obj.document.y = visY;

        if (ld.obj.renderFlags) {
          ld.obj.renderFlags.set({ refreshPosition: true, refreshField: true });
        } else if (typeof ld.obj.refresh === "function") {
          ld.obj.refresh();
        }

        if (typeof ld.obj.initializeLightSource === "function") {
          ld.obj.initializeLightSource();
        }

        if (canvas.perception?.update) {
          canvas.perception.update({ refreshLighting: true, refreshVision: true }, true);
        }
      }

      if (i < STEPS) await sleep(frameMs);
    }

    if (tokensData.length) {
      const tokenUpdates = tokensData
        .filter(td => !td.skipAnimation)
        .map(td => ({
          _id: td.id,
          x: td.endX,
          y: td.endY
        }));

      if (tokenUpdates.length) {
        await canvas.scene.updateEmbeddedDocuments("Token", tokenUpdates, { animate: false });
      }
    }

    if (overlayTilesData.length) {
      const overlayUpdates = overlayTilesData
        .filter(od => !od.skipAnimation)
        .map(od => ({
          _id: od.id,
          x: od.endX,
          y: od.endY
        }));

      if (overlayUpdates.length) {
        await canvas.scene.updateEmbeddedDocuments("Tile", overlayUpdates, { animate: false });
      }
    }

    if (lightsData.length) {
      const lightUpdates = lightsData
        .filter(ld => !ld.skipAnimation)
        .map(ld => ({
          _id: ld.id,
          x: ld.endX,
          y: ld.endY
        }));

      if (lightUpdates.length) {
        await canvas.scene.updateEmbeddedDocuments("AmbientLight", lightUpdates, { animate: false });
      }
    }

    ui.notifications.info(
      `Rotated ${tilesData.length} base tile(s), moved ${tokensData.filter(t => !t.skipAnimation).length} token(s), ${overlayTilesData.filter(t => !t.skipAnimation).length} overlay tile(s), and ${lightsData.filter(t => !t.skipAnimation).length} light source(s).`
    );
  } catch (err) {
    console.error(err);
    ui.notifications.error(`Rotation macro failed: ${err.message}`);
  }
})();