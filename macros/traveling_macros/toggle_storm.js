(async () => {
  const FLAG_SCOPE = "core";
  const FLAG_KEY = "darkfinderTravel.storming";
  const PLAYLIST_FOLDER_NAME = "Traveling";
  const PLAYLIST_NAME = "Stormy Seas";
  const WEATHER_LABEL = "Rain Storm";

  const scene = canvas?.scene;
  if (!scene) {
    ui.notifications.warn("No active scene is available.");
    return;
  }

  if (!game.user.isGM) {
    ui.notifications.warn("Only a GM can toggle storm conditions.");
    return;
  }

  const findWeatherKeyByLabel = (label) => {
    const effects = CONFIG?.weatherEffects;
    if (!effects || typeof effects !== "object") return null;

    const normalizedLabel = String(label || "").trim().toLowerCase();
    for (const [key, config] of Object.entries(effects)) {
      const candidates = [
        key,
        config?.id,
        config?.label,
      ].filter((value) => value != null && value !== "");

      for (const candidate of candidates) {
        const localized = game.i18n?.localize?.(String(candidate)) ?? String(candidate);
        if (String(localized).trim().toLowerCase() === normalizedLabel) return key;
      }
    }

    return null;
  };

  const findPlaylist = () => {
    const normalizedFolderName = PLAYLIST_FOLDER_NAME.trim().toLowerCase();
    const normalizedPlaylistName = PLAYLIST_NAME.trim().toLowerCase();

    return game.playlists?.find((playlist) => {
      const playlistName = String(playlist?.name || "").trim().toLowerCase();
      const folderName = String(playlist?.folder?.name || "").trim().toLowerCase();
      return playlistName === normalizedPlaylistName && folderName === normalizedFolderName;
    }) || game.playlists?.find((playlist) => {
      const combinedName = String(playlist?.name || "").trim().toLowerCase();
      return combinedName === `${normalizedFolderName}/${normalizedPlaylistName}`;
    }) || null;
  };

  const stopPlaylistSounds = async (playlist) => {
    if (!playlist) return;

    if (typeof playlist.stopAll === "function") {
      await playlist.stopAll();
      return;
    }

    const sounds = Array.from(playlist.sounds ?? []);
    for (const sound of sounds) {
      if (typeof playlist.stopSound === "function") {
        await playlist.stopSound(sound);
      }
    }
  };

  const startPlaylistSounds = async (playlist) => {
    if (!playlist) return;

    if (typeof playlist.playAll === "function") {
      await playlist.playAll();
      return;
    }

    const sounds = Array.from(playlist.sounds ?? []);
    if (sounds.length && typeof playlist.playSound === "function") {
      await playlist.playSound(sounds[0]);
    }
  };

  const playlist = findPlaylist();
  if (!playlist) {
    ui.notifications.warn(`Could not find the playlist "${PLAYLIST_FOLDER_NAME}/${PLAYLIST_NAME}".`);
    return;
  }

  const rainStormKey = findWeatherKeyByLabel(WEATHER_LABEL);
  if (!rainStormKey) {
    ui.notifications.warn(`Could not find a weather effect labeled "${WEATHER_LABEL}".`);
    return;
  }

  const isStorming = scene.getFlag(FLAG_SCOPE, FLAG_KEY) === true;
  const nextStorming = !isStorming;

  try {
    if (nextStorming) {
      await scene.update({ weather: rainStormKey });
      await startPlaylistSounds(playlist);
      await scene.setFlag(FLAG_SCOPE, FLAG_KEY, true);
      ui.notifications.info(`Storm enabled: weather set to ${WEATHER_LABEL} and playlist "${PLAYLIST_NAME}" started.`);
      return;
    }

    await scene.update({ weather: "" });
    await stopPlaylistSounds(playlist);
    await scene.setFlag(FLAG_SCOPE, FLAG_KEY, false);
    ui.notifications.info(`Storm disabled: weather cleared and playlist "${PLAYLIST_NAME}" stopped.`);
  } catch (err) {
    console.error(err);
    ui.notifications.error(`Storm toggle macro failed: ${err.message}`);
  }
})();
