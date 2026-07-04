import { MODULE_ID } from "./api.js";

const SESSION_SETTING_KEY = "randomLootSession";
const SOCKET_NAME = `module.${MODULE_ID}`;
const PLAYER_DIALOG_WIDTH = 680;
const PLAYER_DIALOG_HEIGHT = 760;
const GM_DIALOG_WIDTH = 760;
const GM_DIALOG_HEIGHT = 760;
const FORCE_SUBMIT_WARNING = "Forcing submissions will lock in every players currently claimed items whether they are ready or not. Are you sure you want to do that?";
const PLAYER_SUBMIT_WARNING = "Hitting Submit will lock in your claims and they can't be changed. Are you sure?";

const lootSessionState = {
  dialogStateBySessionId: new Map(),
  resultsDialogStateBySessionId: new Map(),
  pendingSessionById: new Map(),
  settingWatcherIntervalId: null,
  lastObservedSessionSignature: "",
  hooksRegistered: false,
};

function registerRandomLootSessionFeature(api) {
  if (!lootSessionState.hooksRegistered) {
    Hooks.once("init", () => {
      game.settings.register(MODULE_ID, SESSION_SETTING_KEY, {
        name: "Random Loot Session",
        scope: "world",
        config: false,
        type: Object,
        default: {},
      });
    });

    Hooks.once("ready", () => {
      game.socket.on(SOCKET_NAME, handleSocketMessage);
      Hooks.on("updateSetting", handleLootSessionSettingUpdate);
      startLootSessionSettingWatcher();
      void syncLootSessionUiFromSetting(getStoredLootSession());
    });

    lootSessionState.hooksRegistered = true;
  }

  if (!api || typeof api !== "object") return;
  api.openRandomLootClaimSession = openRandomLootClaimSession;
  api.cancelRandomLootClaimSession = cancelRandomLootClaimSession;
  api.forceSubmitRandomLootClaimSession = forceSubmitRandomLootClaimSession;
}

async function openRandomLootClaimSession(items, options = {}) {
  if (!game.user?.isGM) {
    throw new Error("Only a GM can open a random loot claim session.");
  }

  const participantUsers = getLootParticipantUsers();
  if (!participantUsers.length) {
    throw new Error("No non-GM players with assigned characters are available for loot claiming.");
  }

  const existingSession = getStoredLootSession();
  if (isActiveSession(existingSession)) {
    await cancelRandomLootClaimSession(existingSession.id, { silent: true });
  }

  const normalizedItems = normalizeSessionItems(items);
  if (!normalizedItems.length) {
    throw new Error("No loot items were available to send to players.");
  }

  const session = {
    id: randomID(),
    createdAt: Date.now(),
    createdBy: game.user.id,
    gmUserId: game.user.id,
    title: String(options.title || "Party Loot"),
    status: "collecting",
    forcedSubmit: false,
    participantUserIds: participantUsers.map((user) => user.id),
    submittedUserIds: [],
    claimsByItemUuid: {},
    items: normalizedItems,
    resolution: {
      awardsByItemUuid: {},
      contests: [],
    },
    sessionStatsByUserId: {},
  };

  await setStoredLootSession(session);
  cachePendingLootSession(session);
  await broadcastLootSessionMessage({ type: "open-session", sessionId: session.id, session });
  await openOrRefreshLootSessionDialog(session.id);
  return session;
}

async function cancelRandomLootClaimSession(sessionId, options = {}) {
  if (!game.user?.isGM) return;
  const session = getStoredLootSession();
  if (!session?.id || session.id !== sessionId) return;

  const cancelledSession = {
    ...session,
    status: "cancelled",
    cancelledAt: Date.now(),
  };

  await setStoredLootSession(cancelledSession);
  cachePendingLootSession(cancelledSession);
  await broadcastLootSessionMessage({ type: "close-session", sessionId, reason: "cancelled", session: cancelledSession });
  closeLootSessionDialog(sessionId);
  closeLootResultsDialog(sessionId);
  clearPendingLootSession(sessionId);

  if (!options.silent) {
    ui.notifications.info("Closed the active loot claim session for all players.");
  }
}

async function forceSubmitRandomLootClaimSession(sessionId) {
  if (!game.user?.isGM) return;
  const session = getStoredLootSession();
  if (!session?.id || session.id !== sessionId || session.status !== "collecting") return;

  const forcedSession = {
    ...session,
    forcedSubmit: true,
    submittedUserIds: [...new Set(session.participantUserIds)],
  };

  await setStoredLootSession(forcedSession);
  cachePendingLootSession(forcedSession);
  await broadcastLootSessionMessage({ type: "refresh-session", sessionId, session: forcedSession });
  await maybeResolveLootSession(forcedSession.id);
}

async function handleSocketMessage(message) {
  const type = String(message?.type || "").trim();
  const sessionId = String(message?.sessionId || "").trim();
  if (!type || !sessionId) return;
  const session = normalizeSocketSession(message?.session);
  if (session?.id === sessionId) {
    cachePendingLootSession(session);
  }

  if (type === "request-claim-update") {
    if (!game.user?.isGM) return;
    await applyClaimUpdate(message);
    return;
  }

  if (type === "request-submit") {
    if (!game.user?.isGM) return;
    await applyPlayerSubmit(message);
    return;
  }

  if (type === "request-cancel") {
    if (!game.user?.isGM) return;
    await cancelRandomLootClaimSession(sessionId);
    return;
  }

  if (type === "request-force-submit") {
    if (!game.user?.isGM) return;
    await forceSubmitRandomLootClaimSession(sessionId);
    return;
  }

  if (type === "open-session" || type === "refresh-session") {
    await openOrRefreshLootSessionDialog(sessionId, session);
    return;
  }

  if (type === "close-session") {
    closeLootSessionDialog(sessionId);
    const reason = String(message?.reason || "").trim();
    if (reason === "cancelled") {
      closeLootResultsDialog(sessionId);
      clearPendingLootSession(sessionId);
      ui.notifications.info("The active loot claim session was closed by the GM.");
    } else if (reason === "resolving") {
      ui.notifications.info("Loot claims are locked in. Resolving awards now...");
    } else if (reason === "resolved") {
      await openOrRefreshLootResultsDialog(sessionId, session);
    }
  }
}

function handleLootSessionSettingUpdate(setting) {
  if (!isLootSessionSettingDocument(setting)) return;

  // Let the client read the committed world-setting value after Foundry finishes applying it locally.
  setTimeout(() => {
    void syncLootSessionUiFromSetting(getStoredLootSession());
  }, 0);
}

function startLootSessionSettingWatcher() {
  if (lootSessionState.settingWatcherIntervalId) return;

  lootSessionState.lastObservedSessionSignature = buildLootSessionSignature(getStoredLootSession());
  lootSessionState.settingWatcherIntervalId = window.setInterval(() => {
    const storedSession = getStoredLootSession();
    const nextSignature = buildLootSessionSignature(storedSession);
    if (nextSignature === lootSessionState.lastObservedSessionSignature) return;

    lootSessionState.lastObservedSessionSignature = nextSignature;
    void syncLootSessionUiFromSetting(storedSession);
  }, 350);
}

async function applyClaimUpdate(message) {
  const session = getStoredLootSession();
  const sessionId = String(message?.sessionId || "").trim();
  if (!session?.id || session.id !== sessionId || session.status !== "collecting") return;

  const userId = String(message?.userId || "").trim();
  const itemUuid = String(message?.itemUuid || "").trim();
  if (!userId || !itemUuid) return;
  if (!session.participantUserIds.includes(userId)) return;
  if ((session.submittedUserIds || []).includes(userId)) return;

  const currentClaims = Array.isArray(session.claimsByItemUuid?.[itemUuid])
    ? [...session.claimsByItemUuid[itemUuid]]
    : [];

  const claimed = !!message?.claimed;
  const nextClaims = claimed
    ? [...new Set([...currentClaims, userId])]
    : currentClaims.filter((entry) => entry !== userId);

  const nextSession = {
    ...session,
    claimsByItemUuid: {
      ...(session.claimsByItemUuid || {}),
      [itemUuid]: nextClaims,
    },
  };

  await setStoredLootSession(nextSession);
  cachePendingLootSession(nextSession);
  await broadcastLootSessionMessage({ type: "refresh-session", sessionId, session: nextSession });
}

async function applyPlayerSubmit(message) {
  const session = getStoredLootSession();
  const sessionId = String(message?.sessionId || "").trim();
  if (!session?.id || session.id !== sessionId || session.status !== "collecting") return;

  const userId = String(message?.userId || "").trim();
  if (!userId || !session.participantUserIds.includes(userId)) return;

  const submittedUserIds = [...new Set([...(session.submittedUserIds || []), userId])];
  const nextSession = {
    ...session,
    submittedUserIds,
  };

  await setStoredLootSession(nextSession);
  cachePendingLootSession(nextSession);
  await broadcastLootSessionMessage({ type: "refresh-session", sessionId, session: nextSession });
  await maybeResolveLootSession(sessionId);
}

async function maybeResolveLootSession(sessionId) {
  if (!game.user?.isGM) return;
  const session = getStoredLootSession();
  if (!session?.id || session.id !== sessionId || session.status !== "collecting") return;

  const participantIds = session.participantUserIds || [];
  const submittedIds = new Set(session.submittedUserIds || []);
  const everyoneSubmitted = participantIds.every((userId) => submittedIds.has(userId));
  if (!everyoneSubmitted) return;

  const resolvingSession = {
    ...session,
    status: "resolving",
    resolvedAt: null,
  };

  await setStoredLootSession(resolvingSession);
  cachePendingLootSession(resolvingSession);
  await broadcastLootSessionMessage({ type: "close-session", sessionId, reason: "resolving", session: resolvingSession });
  closeLootSessionDialog(sessionId);

  const resolvedSession = await resolveLootSessionAwards(resolvingSession);
  await setStoredLootSession(resolvedSession);
  cachePendingLootSession(resolvedSession);
  await broadcastLootSessionMessage({ type: "close-session", sessionId, reason: "resolved", session: resolvedSession });
  closeLootSessionDialog(sessionId);
  await openOrRefreshLootResultsDialog(sessionId);
}

async function resolveLootSessionAwards(session) {
  const sortedItems = [...(session.items || [])].sort((left, right) => {
    const priceDelta = (Number(right?.price) || 0) - (Number(left?.price) || 0);
    if (priceDelta !== 0) return priceDelta;
    return String(left?.name || "").localeCompare(String(right?.name || ""), undefined, { sensitivity: "base" });
  });

  const wealthByUserId = Object.fromEntries(
    (session.participantUserIds || []).map((userId) => [userId, getUserCharacterWealth(userId)])
  );
  const sessionStatsByUserId = { ...(session.sessionStatsByUserId || {}) };
  const awardsByItemUuid = {};
  const contests = [];

  for (const item of sortedItems) {
    const itemUuid = String(item?.uuid || "").trim();
    const quantity = Math.max(1, Number(item?.quantity) || 1);
    const claimantIds = getResolvedClaimantUserIds(session, itemUuid);
    if (!claimantIds.length) continue;

    if (claimantIds.length === 1) {
      awardsByItemUuid[itemUuid] = [{
        userId: claimantIds[0],
        quantity,
        method: "uncontested",
      }];
      continue;
    }

    const itemAwards = [];
    const baseShare = Math.floor(quantity / claimantIds.length);
    let remainder = quantity % claimantIds.length;

    if (baseShare > 0) {
      for (const userId of claimantIds) {
        itemAwards.push({
          userId,
          quantity: baseShare,
          method: "split",
        });
      }
    }

    if (remainder === 0 && itemAwards.length) {
      awardsByItemUuid[itemUuid] = mergeAwardEntries(itemAwards);
      continue;
    }

    if (quantity === 1) remainder = 1;

    while (remainder > 0) {
      const contest = await rollItemContest(item, claimantIds, wealthByUserId, sessionStatsByUserId);
      contests.push(contest);
      itemAwards.push({
        userId: contest.winnerUserId,
        quantity: 1,
        method: "contested",
      });
      updateContestStats(sessionStatsByUserId, contest);
      remainder -= 1;
    }

    awardsByItemUuid[itemUuid] = mergeAwardEntries(itemAwards);
  }

  await awardResolvedLoot(session.items || [], awardsByItemUuid);
  await createResolutionChatMessages(session.items || [], awardsByItemUuid, contests);

  return {
    ...session,
    status: "resolved",
    resolvedAt: Date.now(),
    resolution: {
      awardsByItemUuid,
      contests,
    },
    sessionStatsByUserId,
  };
}

async function rollItemContest(item, claimantIds, wealthByUserId, sessionStatsByUserId) {
  const wealthValues = claimantIds.map((userId) => Number(wealthByUserId[userId]) || 0);
  const averageWealth = wealthValues.length
    ? wealthValues.reduce((sum, value) => sum + value, 0) / wealthValues.length
    : 0;

  const results = [];
  for (const userId of claimantIds) {
    const wealthModifier = computeWealthModifier(Number(wealthByUserId[userId]) || 0, averageWealth);
    const streakModifier = computeSessionStreakModifier(sessionStatsByUserId?.[userId] || {});
    const modifier = roundToHundredth(wealthModifier + streakModifier);
    const roll = await (new Roll("1d20")).evaluate({ async: true });
    results.push({
      userId,
      rollTotal: Number(roll.total) || 0,
      modifier,
      total: roundToHundredth((Number(roll.total) || 0) + modifier),
    });
  }

  const sorted = [...results].sort((left, right) => {
    const totalDelta = right.total - left.total;
    if (totalDelta !== 0) return totalDelta;
    const rollDelta = right.rollTotal - left.rollTotal;
    if (rollDelta !== 0) return rollDelta;
    return Math.random() - 0.5;
  });

  return {
    itemUuid: String(item?.uuid || ""),
    itemName: String(item?.name || "Unnamed Item"),
    results: sorted,
    winnerUserId: sorted[0]?.userId || "",
  };
}

function updateContestStats(sessionStatsByUserId, contest) {
  const winnerId = String(contest?.winnerUserId || "").trim();
  for (const result of contest?.results || []) {
    const userId = String(result?.userId || "").trim();
    if (!userId) continue;
    const current = sessionStatsByUserId[userId] || { wins: 0, losses: 0 };
    if (userId === winnerId) {
      sessionStatsByUserId[userId] = {
        wins: current.wins + 1,
        losses: current.losses,
      };
    } else {
      sessionStatsByUserId[userId] = {
        wins: current.wins,
        losses: current.losses + 1,
      };
    }
  }
}

function computeWealthModifier(playerWealth, averageWealth) {
  if (!Number.isFinite(playerWealth) || !Number.isFinite(averageWealth) || averageWealth <= 0) return 0;
  const ratio = (averageWealth - playerWealth) / averageWealth;
  return clampNumber(ratio * 4, -3, 3);
}

function computeSessionStreakModifier(stats) {
  const wins = Number(stats?.wins) || 0;
  const losses = Number(stats?.losses) || 0;
  return clampNumber((losses - wins) * 0.5, -2, 2);
}

async function awardResolvedLoot(items, awardsByItemUuid) {
  for (const item of items || []) {
    const itemUuid = String(item?.uuid || "").trim();
    const awards = Array.isArray(awardsByItemUuid?.[itemUuid]) ? awardsByItemUuid[itemUuid] : [];
    if (!itemUuid || !awards.length) continue;

    const sourceDocument = await fromUuid(itemUuid);
    if (!sourceDocument) continue;

    for (const award of awards) {
      const user = game.users.get(String(award?.userId || "").trim());
      const actor = resolveLootRecipientActor(user);
      if (!actor) continue;

      const quantity = Math.max(1, Number(award?.quantity) || 1);
      const itemSource = sourceDocument.toObject();
      delete itemSource._id;
      applyItemQuantityToSource(itemSource, quantity);
      await actor.createEmbeddedDocuments("Item", [itemSource]);
    }
  }
}

function applyItemQuantityToSource(source, quantity) {
  if (!source || typeof source !== "object") return;
  if (foundry?.utils?.hasProperty?.(source, "system.quantity.value")) {
    foundry.utils.setProperty(source, "system.quantity.value", quantity);
    return;
  }
  if (foundry?.utils?.hasProperty?.(source, "system.quantity")) {
    foundry.utils.setProperty(source, "system.quantity", quantity);
    return;
  }
  source.system = source.system || {};
  source.system.quantity = quantity;
}

async function createResolutionChatMessages(items, awardsByItemUuid, contests) {
  const itemByUuid = Object.fromEntries((items || []).map((item) => [String(item?.uuid || ""), item]));
  const summaryLines = [];

  for (const [itemUuid, awards] of Object.entries(awardsByItemUuid || {})) {
    const item = itemByUuid[itemUuid];
    const awardSummary = (awards || []).map((award) => {
      const user = game.users.get(String(award?.userId || "").trim());
      const actorName = String(user?.character?.name || user?.name || "Unknown");
      const quantityText = (Number(award?.quantity) || 1) > 1 ? ` x${award.quantity}` : "";
      return `${actorName}${quantityText}`;
    }).join(", ");
    summaryLines.push(`<li><strong>${escapeHtml(String(item?.name || "Unnamed Item"))}</strong>: ${escapeHtml(awardSummary || "No recipient")}</li>`);
  }

  if (summaryLines.length) {
    await ChatMessage.create({
      content: `
        <div class="darkfinder-loot-resolution-chat">
          <h3>Loot Claim Results</h3>
          <ul>${summaryLines.join("")}</ul>
        </div>
      `,
    });
  }

  for (const contest of contests || []) {
    const contestLines = (contest.results || []).map((result) => {
      const user = game.users.get(String(result?.userId || "").trim());
      const actorName = String(user?.character?.name || user?.name || "Unknown");
      return `<li>${escapeHtml(actorName)}: ${result.rollTotal} + ${formatSignedModifier(result.modifier)} = <strong>${result.total}</strong></li>`;
    }).join("");
    const winnerUser = game.users.get(String(contest.winnerUserId || "").trim());
    const winnerName = String(winnerUser?.character?.name || winnerUser?.name || "Unknown");
    await ChatMessage.create({
      content: `
        <div class="darkfinder-loot-resolution-chat">
          <h4>Contested: ${escapeHtml(String(contest.itemName || "Unnamed Item"))}</h4>
          <ul>${contestLines}</ul>
          <p><strong>Winner:</strong> ${escapeHtml(winnerName)}</p>
        </div>
      `,
    });
  }
}

async function openOrRefreshLootSessionDialog(sessionId, fallbackSession = null) {
  const session = resolveSessionForClient(sessionId, fallbackSession);
  if (!session?.id || session.id !== sessionId) return;
  if (!sessionAppliesToCurrentUser(session)) return;

  const existing = lootSessionState.dialogStateBySessionId.get(sessionId);
  if (existing?.dialog?.rendered) {
    existing.session = session;
    renderLootSessionDialogState(existing.eventRoot, existing);
    return;
  }

  const role = game.user?.isGM ? "gm" : "player";
  const dimensions = role === "gm"
    ? { width: GM_DIALOG_WIDTH, height: GM_DIALOG_HEIGHT }
    : { width: PLAYER_DIALOG_WIDTH, height: PLAYER_DIALOG_HEIGHT };

  const dialogState = {
    sessionId,
    session,
    role,
    eventRoot: null,
    dialog: null,
  };

  const dialog = new Dialog({
    title: role === "gm" ? `${session.title} (GM)` : session.title,
    content: buildLootSessionDialogContent(role),
    buttons: {},
    width: dimensions.width,
    height: dimensions.height,
    resizable: false,
    render: async function (html) {
      dialog.setPosition({ width: dimensions.width, height: dimensions.height });
      const appWindow = html.closest(".app.window-app");
      const dialogWindow = html.closest(".app.window-app, .dialog");
      let dialogContent = dialogWindow.find(".window-content");
      if (!dialogContent.length) dialogContent = html;

      if (appWindow.length) {
        appWindow.css({
          width: `${dimensions.width}px`,
          minWidth: `${dimensions.width}px`,
          maxWidth: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          minHeight: `${dimensions.height}px`,
          maxHeight: `${dimensions.height}px`,
        });
      }

      dialogWindow.css({
        width: `${dimensions.width}px`,
        minWidth: `${dimensions.width}px`,
        maxWidth: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
        minHeight: `${dimensions.height}px`,
        maxHeight: `${dimensions.height}px`,
      });
      dialogWindow.addClass("darkfinder-random-loot-dialog");

      dialogContent.css({
        width: "100%",
        height: "100%",
        minHeight: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        padding: "0.75rem",
        boxSizing: "border-box",
      });

      html.css({
        width: "100%",
        height: "100%",
        minHeight: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
      });

      const eventRoot = dialogWindow.length ? dialogWindow : html;
      dialogState.eventRoot = eventRoot;
      bindLootSessionDialogEvents(eventRoot, dialogState);
      renderLootSessionDialogState(eventRoot, dialogState);
    },
    close: () => {
      const current = lootSessionState.dialogStateBySessionId.get(sessionId);
      if (current?.dialog === dialog) {
        lootSessionState.dialogStateBySessionId.delete(sessionId);
      }
    },
  });

  dialogState.dialog = dialog;
  lootSessionState.dialogStateBySessionId.set(sessionId, dialogState);
  dialog.render(true);
}

function closeLootSessionDialog(sessionId) {
  const state = lootSessionState.dialogStateBySessionId.get(sessionId);
  if (!state?.dialog) return;
  lootSessionState.dialogStateBySessionId.delete(sessionId);
  state.dialog.close();
}

async function openOrRefreshLootResultsDialog(sessionId, fallbackSession = null) {
  const session = resolveSessionForClient(sessionId, fallbackSession);
  if (!session?.id || session.id !== sessionId || session.status !== "resolved") return;
  if (!sessionAppliesToCurrentUser(session)) return;

  const existing = lootSessionState.resultsDialogStateBySessionId.get(sessionId);
  if (existing?.dialog?.rendered) {
    existing.session = session;
    renderLootResultsDialogState(existing.eventRoot, existing);
    return;
  }

  const dialogState = {
    sessionId,
    session,
    eventRoot: null,
    dialog: null,
  };

  const dialog = new Dialog({
    title: `${session.title} Results`,
    content: buildLootResultsDialogContent(),
    buttons: {},
    width: PLAYER_DIALOG_WIDTH,
    height: PLAYER_DIALOG_HEIGHT,
    resizable: false,
    render: async function (html) {
      dialog.setPosition({ width: PLAYER_DIALOG_WIDTH, height: PLAYER_DIALOG_HEIGHT });
      const appWindow = html.closest(".app.window-app");
      const dialogWindow = html.closest(".app.window-app, .dialog");
      let dialogContent = dialogWindow.find(".window-content");
      if (!dialogContent.length) dialogContent = html;

      if (appWindow.length) {
        appWindow.css({
          width: `${PLAYER_DIALOG_WIDTH}px`,
          minWidth: `${PLAYER_DIALOG_WIDTH}px`,
          maxWidth: `${PLAYER_DIALOG_WIDTH}px`,
          height: `${PLAYER_DIALOG_HEIGHT}px`,
          minHeight: `${PLAYER_DIALOG_HEIGHT}px`,
          maxHeight: `${PLAYER_DIALOG_HEIGHT}px`,
        });
      }

      dialogWindow.css({
        width: `${PLAYER_DIALOG_WIDTH}px`,
        minWidth: `${PLAYER_DIALOG_WIDTH}px`,
        maxWidth: `${PLAYER_DIALOG_WIDTH}px`,
        height: `${PLAYER_DIALOG_HEIGHT}px`,
        minHeight: `${PLAYER_DIALOG_HEIGHT}px`,
        maxHeight: `${PLAYER_DIALOG_HEIGHT}px`,
      });
      dialogWindow.addClass("darkfinder-random-loot-dialog");

      dialogContent.css({
        width: "100%",
        height: "100%",
        minHeight: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        padding: "0.75rem",
        boxSizing: "border-box",
      });

      html.css({
        width: "100%",
        height: "100%",
        minHeight: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
      });

      const eventRoot = dialogWindow.length ? dialogWindow : html;
      dialogState.eventRoot = eventRoot;
      bindLootResultsDialogEvents(eventRoot, dialogState);
      renderLootResultsDialogState(eventRoot, dialogState);
    },
    close: () => {
      const current = lootSessionState.resultsDialogStateBySessionId.get(sessionId);
      if (current?.dialog === dialog) {
        lootSessionState.resultsDialogStateBySessionId.delete(sessionId);
      }
    },
  });

  dialogState.dialog = dialog;
  lootSessionState.resultsDialogStateBySessionId.set(sessionId, dialogState);
  dialog.render(true);
}

function closeLootResultsDialog(sessionId) {
  const state = lootSessionState.resultsDialogStateBySessionId.get(sessionId);
  if (!state?.dialog) return;
  lootSessionState.resultsDialogStateBySessionId.delete(sessionId);
  state.dialog.close();
}

async function syncLootSessionUiFromSetting(session) {
  const normalizedSession = normalizeSocketSession(session);
  const sessionId = String(normalizedSession?.id || "").trim();

  if (!sessionId) {
    closeAllLootSessionDialogs();
    closeAllLootResultsDialogs();
    lootSessionState.pendingSessionById.clear();
    return;
  }

  cachePendingLootSession(normalizedSession);
  closeStaleLootSessionDialogs(sessionId);
  closeStaleLootResultsDialogs(sessionId);

  if (!sessionAppliesToCurrentUser(normalizedSession)) return;

  if (normalizedSession.status === "cancelled") {
    closeLootSessionDialog(sessionId);
    closeLootResultsDialog(sessionId);
    clearPendingLootSession(sessionId);
    return;
  }

  if (normalizedSession.status === "resolved") {
    closeLootSessionDialog(sessionId);
    await openOrRefreshLootResultsDialog(sessionId, normalizedSession);
    return;
  }

  if (normalizedSession.status === "resolving") {
    closeLootSessionDialog(sessionId);
    return;
  }

  await openOrRefreshLootSessionDialog(sessionId, normalizedSession);
}

function bindLootResultsDialogEvents(eventRoot, dialogState) {
  eventRoot.off("click", ".darkfinder-random-loot-item-body").on("click", ".darkfinder-random-loot-item-body", async (event) => {
    event.preventDefault();
    const row = event.currentTarget;
    const itemUuid = String(row.dataset.itemUuid || "").trim();
    if (!itemUuid) return;

    try {
      const document = await fromUuid(itemUuid);
      if (!document?.sheet) {
        return ui.notifications.warn("That compendium item could not be opened.");
      }
      document.sheet.render(true);
    } catch (error) {
      console.warn("Darkfinder loot results could not open compendium item.", error);
      ui.notifications.error("That compendium item could not be opened.");
    }
  });

  eventRoot.off("mouseenter", ".darkfinder-random-loot-item-body").on("mouseenter", ".darkfinder-random-loot-item-body", (event) => {
    const row = event.currentTarget;
    const itemUuid = String(row.dataset.itemUuid || "").trim();
    if (!itemUuid) return;
    showItemTooltip(eventRoot, dialogState.session, itemUuid, event);
  });

  eventRoot.off("mousemove", ".darkfinder-random-loot-item-body").on("mousemove", ".darkfinder-random-loot-item-body", (event) => {
    positionItemTooltip(eventRoot, event);
  });

  eventRoot.off("mouseleave", ".darkfinder-random-loot-item-body").on("mouseleave", ".darkfinder-random-loot-item-body", () => {
    hideItemTooltip(eventRoot);
  });

  eventRoot.off("click", "[data-action='close-loot-results']").on("click", "[data-action='close-loot-results']", (event) => {
    event.preventDefault();
    closeLootResultsDialog(dialogState.sessionId);
  });
}

function renderLootResultsDialogState(eventRoot, dialogState) {
  const latestSession = resolveSessionForClient(dialogState.sessionId, dialogState.session);
  if (!latestSession?.id || latestSession.id !== dialogState.sessionId) {
    closeLootResultsDialog(dialogState.sessionId);
    return;
  }

  dialogState.session = latestSession;
  hideItemTooltip(eventRoot);
  eventRoot.find("[data-value='loot-results-summary']").text(buildLootResultsSummaryText(latestSession));
  eventRoot.find("[data-value='loot-results-list']").html(buildLootResultsRowsHtml(latestSession));
}

function bindLootSessionDialogEvents(eventRoot, dialogState) {
  eventRoot.off("click", ".darkfinder-random-loot-item-body").on("click", ".darkfinder-random-loot-item-body", async (event) => {
    event.preventDefault();
    const row = event.currentTarget;
    const itemUuid = String(row.dataset.itemUuid || "").trim();
    if (!itemUuid) return;

    try {
      const document = await fromUuid(itemUuid);
      if (!document?.sheet) {
        return ui.notifications.warn("That compendium item could not be opened.");
      }
      document.sheet.render(true);
    } catch (error) {
      console.warn("Darkfinder loot session could not open compendium item.", error);
      ui.notifications.error("That compendium item could not be opened.");
    }
  });

  eventRoot.off("mouseenter", ".darkfinder-random-loot-item-body").on("mouseenter", ".darkfinder-random-loot-item-body", (event) => {
    const row = event.currentTarget;
    const itemUuid = String(row.dataset.itemUuid || "").trim();
    if (!itemUuid) return;
    showItemTooltip(eventRoot, dialogState.session, itemUuid, event);
  });

  eventRoot.off("mousemove", ".darkfinder-random-loot-item-body").on("mousemove", ".darkfinder-random-loot-item-body", (event) => {
    positionItemTooltip(eventRoot, event);
  });

  eventRoot.off("mouseleave", ".darkfinder-random-loot-item-body").on("mouseleave", ".darkfinder-random-loot-item-body", () => {
    hideItemTooltip(eventRoot);
  });

  eventRoot.off("change", "[data-player-item-action='toggle-claim']").on("change", "[data-player-item-action='toggle-claim']", async (event) => {
    event.stopPropagation();
    const checkbox = event.currentTarget;
    const itemUuid = String(checkbox.dataset.itemUuid || "").trim();
    if (!itemUuid) return;
    await broadcastLootSessionMessage({
      type: "request-claim-update",
      sessionId: dialogState.sessionId,
      userId: game.user.id,
      itemUuid,
      claimed: !!checkbox.checked,
    });
  });

  eventRoot.off("click", "[data-action='submit-player-loot']").on("click", "[data-action='submit-player-loot']", async (event) => {
    event.preventDefault();
    openPlayerSubmitConfirmation(dialogState.sessionId);
  });

  eventRoot.off("click", "[data-action='cancel-player-loot-session']").on("click", "[data-action='cancel-player-loot-session']", async (event) => {
    event.preventDefault();
    await broadcastLootSessionMessage({
      type: "request-cancel",
      sessionId: dialogState.sessionId,
    });
  });

  eventRoot.off("click", "[data-action='force-submit-player-loot-session']").on("click", "[data-action='force-submit-player-loot-session']", async (event) => {
    event.preventDefault();
    openForceSubmitConfirmation(dialogState.sessionId);
  });
}

function renderLootSessionDialogState(eventRoot, dialogState) {
  const latestSession = resolveSessionForClient(dialogState.sessionId, dialogState.session);
  if (!latestSession?.id || latestSession.id !== dialogState.sessionId) {
    closeLootSessionDialog(dialogState.sessionId);
    return;
  }

  dialogState.session = latestSession;
  const isPlayer = dialogState.role !== "gm";
  const currentUserSubmitted = (latestSession.submittedUserIds || []).includes(game.user.id);
  const isLocked = latestSession.status !== "collecting" || (isPlayer && currentUserSubmitted);

  hideItemTooltip(eventRoot);
  eventRoot.find("[data-value='player-results-total']").text(`${formatGold(sumItemPrices(latestSession.items))} gp`);
  eventRoot.find("[data-value='player-results-count']").text(String((latestSession.items || []).length));
  eventRoot.find("[data-value='player-results-status']").text(buildSessionStatusText(latestSession, dialogState.role));
  eventRoot.find("[data-value='player-results-list']").html(buildLootSessionItemsHtml(latestSession, dialogState.role));

  const checkboxes = eventRoot.find(".darkfinder-random-loot-player-item-checkbox");
  checkboxes.prop("disabled", isLocked);

  const submitButton = eventRoot.find("[data-action='submit-player-loot']").first();
  submitButton.prop("disabled", isLocked);
  submitButton.text(currentUserSubmitted ? "Submitted" : "Submit");

  const cancelButton = eventRoot.find("[data-action='cancel-player-loot-session']").first();
  const forceButton = eventRoot.find("[data-action='force-submit-player-loot-session']").first();
  cancelButton.prop("disabled", latestSession.status !== "collecting");
  forceButton.prop("disabled", latestSession.status !== "collecting");
}

function buildLootResultsDialogContent() {
  return `
    <style>
      .darkfinder-random-loot-results-dialog {
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
        width: 100%;
        height: 100%;
        min-height: 100%;
        overflow: hidden;
        color: #241d14;
        line-height: 1.35;
        background:
          radial-gradient(circle at top, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 42%),
          linear-gradient(180deg, rgba(63, 53, 34, 0.98) 0%, rgba(42, 34, 22, 0.98) 100%);
        border: 1px solid rgba(111, 92, 58, 0.9);
        border-radius: 16px;
        padding: 0.9rem;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.08),
          0 10px 26px rgba(0,0,0,0.24);
        box-sizing: border-box;
      }
      .darkfinder-random-loot-results-dialog-shell {
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        padding: 0.85rem 0.95rem;
        border: 1px solid #705447;
        border-radius: 14px;
        background: linear-gradient(180deg, rgba(245, 239, 223, 0.98) 0%, rgba(227, 216, 194, 0.98) 100%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
      }
      .darkfinder-random-loot-results-dialog-title {
        font-size: 1.12rem;
        font-weight: 900;
        color: #5f3a2f;
      }
      .darkfinder-random-loot-results-dialog-summary {
        color: #5f5548;
        font-size: 0.86rem;
        font-weight: 700;
      }
      .darkfinder-random-loot-results-dialog-list {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 0.2rem;
      }
      .darkfinder-random-loot-results-dialog-row {
        display: grid;
        gap: 0.5rem;
        padding: 0.75rem 0.85rem;
        border: 1px solid rgba(143, 134, 115, 0.95);
        border-radius: 12px;
        background: linear-gradient(180deg, rgba(241, 235, 219, 0.98) 0%, rgba(224, 214, 194, 0.98) 100%);
      }
      .darkfinder-random-loot-results-dialog-name {
        font-size: 0.98rem;
        font-weight: 900;
        color: #2b2218;
      }
      .darkfinder-random-loot-results-dialog-empty {
        color: #6a6051;
        font-style: italic;
      }
      .darkfinder-random-loot-results-dialog-awards {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }
      .darkfinder-random-loot-results-dialog-actions {
        display: flex;
        justify-content: center;
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-button {
        min-width: 8rem;
        min-height: 2.15rem;
        padding: 0.45rem 1rem;
        border: 1px solid #8f8673;
        border-radius: 9px;
        background: linear-gradient(180deg, #e7dfce 0%, #cec2a7 100%);
        color: #1a1712;
        font-weight: 800;
        cursor: pointer;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-button:hover:not(:disabled) {
        border-color: #6f644f;
        filter: brightness(1.02);
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-item-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-item-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.9rem;
        width: 100%;
        min-height: 3.6rem;
        padding: 0.65rem 0.75rem;
        border: 1px solid rgba(143, 134, 115, 0.95);
        border-radius: 12px;
        background: linear-gradient(180deg, rgba(241, 235, 219, 0.98) 0%, rgba(224, 214, 194, 0.98) 100%);
        color: #1f1a14;
        cursor: pointer;
        box-sizing: border-box;
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-item-main {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-item-icon {
        width: 2rem;
        height: 2rem;
        flex: 0 0 2rem;
        border-radius: 7px;
        object-fit: cover;
        border: 1px solid rgba(105, 89, 64, 0.35);
        background: rgba(255,255,255,0.7);
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-item-name {
        min-width: 0;
        font-weight: 800;
        color: #2b2218;
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-item-price {
        font-weight: 900;
        color: #4d6632;
        white-space: nowrap;
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-tooltip {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 10000;
        width: min(360px, calc(100vw - 24px));
        padding: 0.8rem 0.9rem;
        border: 1px solid rgba(92, 69, 47, 0.98);
        border-radius: 12px;
        background: linear-gradient(180deg, rgba(248, 242, 227, 0.99) 0%, rgba(226, 214, 192, 0.99) 100%);
        color: #241d14;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.5), 0 10px 28px rgba(0,0,0,0.28);
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 90ms ease, transform 90ms ease;
        visibility: hidden;
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-tooltip.is-visible {
        opacity: 1;
        transform: translateY(0);
        visibility: visible;
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-tooltip-title {
        font-size: 1rem;
        font-weight: 900;
        color: #503225;
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-tooltip-price {
        margin-top: 0.2rem;
        font-size: 0.88rem;
        font-weight: 800;
        color: #4d6632;
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-tooltip-meta {
        margin-top: 0.2rem;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: #746554;
      }
      .darkfinder-random-loot-results-dialog .darkfinder-random-loot-tooltip-description {
        margin-top: 0.55rem;
        color: #4f463b;
        font-size: 0.82rem;
        line-height: 1.4;
      }
      .darkfinder-random-loot-dialog .dialog-buttons {
        display: none !important;
      }
    </style>
    <div class="darkfinder-random-loot-results-dialog">
      <div class="darkfinder-random-loot-results-dialog-shell">
        <div class="darkfinder-random-loot-results-dialog-title">Loot Rewards</div>
        <div class="darkfinder-random-loot-results-dialog-summary" data-value="loot-results-summary"></div>
        <div class="darkfinder-random-loot-results-dialog-list" data-value="loot-results-list"></div>
      </div>
      <div class="darkfinder-random-loot-results-dialog-actions">
        <button type="button" class="darkfinder-random-loot-button" data-action="close-loot-results">Close</button>
      </div>
      <div class="darkfinder-random-loot-tooltip" data-role="item-tooltip"></div>
    </div>
  `;
}

function buildLootResultsRowsHtml(session) {
  const awardsByItemUuid = session?.resolution?.awardsByItemUuid || {};
  const itemsByUuid = Object.fromEntries((session?.items || []).map((item) => [String(item?.uuid || ""), item]));
  const awardsByUserId = new Map();

  for (const [itemUuid, awards] of Object.entries(awardsByItemUuid)) {
    const item = itemsByUuid[itemUuid];
    for (const award of awards || []) {
      const userId = String(award?.userId || "").trim();
      if (!userId || !item) continue;
      const existing = awardsByUserId.get(userId) || [];
      existing.push({
        ...item,
        awardQuantity: Math.max(1, Number(award?.quantity) || 1),
      });
      awardsByUserId.set(userId, existing);
    }
  }

  return (session?.participantUserIds || []).map((userId) => {
    const user = game.users.get(String(userId || "").trim());
    const characterName = String(user?.character?.name || user?.name || "Unknown");
    const awards = awardsByUserId.get(userId) || [];

    return `
      <div class="darkfinder-random-loot-results-dialog-row">
        <div class="darkfinder-random-loot-results-dialog-name">${escapeHtml(characterName)}</div>
        <div class="darkfinder-random-loot-results-dialog-awards">
          ${awards.length ? awards.map((item) => {
            const quantityLabel = item.awardQuantity > 1 ? ` x${item.awardQuantity}` : "";
            return `
              <div class="darkfinder-random-loot-item-row">
                <div class="darkfinder-random-loot-item-body" data-item-uuid="${escapeHtml(item.uuid)}">
                  <span class="darkfinder-random-loot-item-main">
                    <img class="darkfinder-random-loot-item-icon" src="${escapeHtml(item.img || "icons/svg/dice-target.svg")}" alt="" loading="lazy" />
                    <span class="darkfinder-random-loot-item-name">${escapeHtml(item.name)}${escapeHtml(quantityLabel)}</span>
                  </span>
                  <span class="darkfinder-random-loot-item-price">${formatGold(item.price)} gp</span>
                </div>
              </div>
            `;
          }).join("") : `<div class="darkfinder-random-loot-results-dialog-empty">Better luck next time!</div>`}
        </div>
      </div>
    `;
  }).join("");
}

function buildLootResultsSummaryText(session) {
  const contests = Array.isArray(session?.resolution?.contests) ? session.resolution.contests : [];
  if (!contests.length) {
    return "All claims are resolved. Uncontested items were assigned directly.";
  }
  return `All claims are resolved. ${contests.length} contested item(s) were rolled for.`;
}

function buildLootSessionDialogContent(role) {
  const isGm = role === "gm";
  return `
    <style>
      .darkfinder-random-loot-player {
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
        width: 100%;
        height: 100%;
        min-height: 100%;
        overflow: hidden;
        color: #241d14;
        line-height: 1.35;
        background:
          radial-gradient(circle at top, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 42%),
          linear-gradient(180deg, rgba(63, 53, 34, 0.98) 0%, rgba(42, 34, 22, 0.98) 100%);
        border: 1px solid rgba(111, 92, 58, 0.9);
        border-radius: 16px;
        padding: 0.9rem;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.08),
          0 10px 26px rgba(0,0,0,0.24);
        box-sizing: border-box;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-results-shell {
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
        overflow: hidden;
        padding: 0.85rem 0.95rem;
        border: 1px solid #705447;
        border-radius: 14px;
        background:
          linear-gradient(180deg, rgba(245, 239, 223, 0.98) 0%, rgba(227, 216, 194, 0.98) 100%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-results-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-results-title {
        font-size: 1.12rem;
        font-weight: 900;
        color: #5f3a2f;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-results-meta {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
        color: #5f5548;
        font-size: 0.86rem;
        font-weight: 700;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-results-status {
        color: #5f5548;
        font-size: 0.84rem;
        font-weight: 700;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-results-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 0.2rem;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-player-list-header {
        display: grid;
        grid-template-columns: 5.6rem minmax(0, 1fr);
        align-items: end;
        gap: 0.55rem;
        padding: 0 0.15rem 0.2rem 0;
        color: #746554;
        font-size: 0.76rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-player-list-header-claim {
        text-align: center;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-player-list-header-item {
        min-height: 1px;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-actions {
        flex: 0 0 auto;
        display: flex;
        justify-content: center;
        gap: 0.6rem;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-button {
        min-width: 7rem;
        min-height: 2.15rem;
        padding: 0.45rem 1rem;
        border: 1px solid #8f8673;
        border-radius: 9px;
        background: linear-gradient(180deg, #e7dfce 0%, #cec2a7 100%);
        color: #1a1712;
        font-weight: 800;
        cursor: pointer;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-button-primary {
        border-color: #5f7346;
        background: linear-gradient(180deg, #dce6c8 0%, #bccd9c 100%);
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-button-danger {
        border-color: rgba(122, 30, 30, 0.9);
        background: linear-gradient(180deg, rgba(185,72,72,0.98) 0%, rgba(126,36,36,0.98) 100%);
        color: #fff7f4;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-button:hover:not(:disabled) {
        border-color: #6f644f;
        filter: brightness(1.02);
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-button:disabled {
        opacity: 0.65;
        cursor: wait;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-item-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: stretch;
        gap: 0.55rem;
        width: 100%;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-item-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.9rem;
        width: 100%;
        min-height: 4.25rem;
        padding: 0.7rem 0.8rem;
        border: 1px solid rgba(143, 134, 115, 0.95);
        border-radius: 12px;
        background:
          linear-gradient(180deg, rgba(241, 235, 219, 0.98) 0%, rgba(224, 214, 194, 0.98) 100%);
        color: #1f1a14;
        text-align: left;
        cursor: pointer;
        box-sizing: border-box;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.5),
          0 3px 8px rgba(0,0,0,0.08);
        transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-item-body:hover {
        border-color: #6f644f;
        transform: translateY(-1px);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.5),
          0 6px 12px rgba(0,0,0,0.12);
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-item-main {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
        min-height: 2.2rem;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-item-icon {
        width: 2rem;
        height: 2rem;
        flex: 0 0 2rem;
        border-radius: 7px;
        object-fit: cover;
        border: 1px solid rgba(105, 89, 64, 0.35);
        background: rgba(255,255,255,0.7);
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-item-name {
        min-width: 0;
        font-weight: 800;
        color: #2b2218;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-item-price {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        text-align: right;
        font-weight: 900;
        color: #4d6632;
        white-space: nowrap;
        min-width: 6.5rem;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-item-actions {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        flex: 0 0 auto;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-player-item-actions-left {
        display: flex;
        justify-content: center;
        align-items: center;
        min-width: 5.6rem;
        min-height: 4.25rem;
        gap: 0.45rem;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-player-item-checkbox {
        width: 1.55rem;
        height: 1.55rem;
        margin: 0;
        accent-color: #5f7346;
        cursor: pointer;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-player-item-checkbox:disabled {
        cursor: default;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-claim-pie {
        width: 1.15rem;
        height: 1.15rem;
        border-radius: 999px;
        border: 1px solid rgba(92, 69, 47, 0.72);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.45);
        flex: 0 0 1.15rem;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-claim-pie-spacer {
        width: 1.15rem;
        height: 1.15rem;
        flex: 0 0 1.15rem;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-results-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        padding: 1rem;
        border: 1px dashed rgba(137, 119, 96, 0.8);
        border-radius: 12px;
        background: rgba(255,255,255,0.38);
        color: #6a6051;
        text-align: center;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-tooltip {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 10000;
        width: min(360px, calc(100vw - 24px));
        padding: 0.8rem 0.9rem;
        border: 1px solid rgba(92, 69, 47, 0.98);
        border-radius: 12px;
        background:
          linear-gradient(180deg, rgba(248, 242, 227, 0.99) 0%, rgba(226, 214, 192, 0.99) 100%);
        color: #241d14;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.5),
          0 10px 28px rgba(0,0,0,0.28);
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 90ms ease, transform 90ms ease;
        visibility: hidden;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-tooltip.is-visible {
        opacity: 1;
        transform: translateY(0);
        visibility: visible;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-tooltip-title {
        font-size: 1rem;
        font-weight: 900;
        color: #503225;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-tooltip-price {
        margin-top: 0.2rem;
        font-size: 0.88rem;
        font-weight: 800;
        color: #4d6632;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-tooltip-meta {
        margin-top: 0.2rem;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: #746554;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-tooltip-description {
        margin-top: 0.55rem;
        color: #4f463b;
        font-size: 0.82rem;
        line-height: 1.4;
        white-space: normal;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-tooltip-description > :first-child {
        margin-top: 0;
      }
      .darkfinder-random-loot-player .darkfinder-random-loot-tooltip-description > :last-child {
        margin-bottom: 0;
      }
      .darkfinder-random-loot-dialog .dialog-buttons {
        display: none !important;
      }
    </style>
    <div class="darkfinder-random-loot-player">
      <div class="darkfinder-random-loot-results-shell">
        <div class="darkfinder-random-loot-results-header">
          <div class="darkfinder-random-loot-results-title">${escapeHtml(isGm ? "Party Loot (GM)" : "Party Loot")}</div>
          <div class="darkfinder-random-loot-results-meta">
            <span>Total: <span data-value="player-results-total">0 gp</span></span>
            <span>Items: <span data-value="player-results-count">0</span></span>
          </div>
        </div>
        <div class="darkfinder-random-loot-results-status" data-value="player-results-status"></div>
        <div class="darkfinder-random-loot-player-list-header" aria-hidden="true">
          <div class="darkfinder-random-loot-player-list-header-claim">Claims</div>
          <div class="darkfinder-random-loot-player-list-header-item"></div>
        </div>
        <div class="darkfinder-random-loot-results-list" data-value="player-results-list">
          <div class="darkfinder-random-loot-results-empty">No items have been shared yet.</div>
        </div>
      </div>
      <div class="darkfinder-random-loot-actions">
        ${isGm ? `
          <button type="button" class="darkfinder-random-loot-button darkfinder-random-loot-button-danger" data-action="cancel-player-loot-session">Cancel</button>
          <button type="button" class="darkfinder-random-loot-button darkfinder-random-loot-button-primary" data-action="force-submit-player-loot-session">Force Submit</button>
        ` : `
          <button type="button" class="darkfinder-random-loot-button darkfinder-random-loot-button-primary" data-action="submit-player-loot">Submit</button>
        `}
      </div>
      <div class="darkfinder-random-loot-tooltip" data-role="item-tooltip"></div>
    </div>
  `;
}

function buildLootSessionItemsHtml(session, role) {
  if (!session?.items?.length) {
    return "<div class=\"darkfinder-random-loot-results-empty\">No items have been shared yet.</div>";
  }

  return session.items.map((item) => {
    const claimantIds = Array.isArray(session.claimsByItemUuid?.[item.uuid]) ? session.claimsByItemUuid[item.uuid] : [];
    const submittedUserIds = new Set(session.submittedUserIds || []);
    const claimantUsers = claimantIds
      .filter((userId) => submittedUserIds.has(userId))
      .map((userId) => game.users.get(userId))
      .filter(Boolean);
    const checked = claimantIds.includes(game.user.id);
    const quantity = Math.max(1, Number(item?.quantity) || 1);
    const quantityLabel = quantity > 1 ? ` x${quantity}` : "";
    const checkboxMarkup = role === "gm"
      ? ""
      : `
        <input
          type="checkbox"
          class="darkfinder-random-loot-player-item-checkbox"
          data-player-item-action="toggle-claim"
          data-item-uuid="${escapeHtml(item.uuid)}"
          aria-label="Include ${escapeHtml(item.name)}"
          ${checked ? "checked" : ""}
        />
      `;

    return `
      <div class="darkfinder-random-loot-item-row">
        <span class="darkfinder-random-loot-item-actions darkfinder-random-loot-player-item-actions-left">
          ${buildClaimPieChartHtml(claimantUsers)}
          ${checkboxMarkup}
        </span>
        <div
          class="darkfinder-random-loot-item-body"
          data-item-uuid="${escapeHtml(item.uuid)}"
        >
          <span class="darkfinder-random-loot-item-main">
            <img class="darkfinder-random-loot-item-icon" src="${escapeHtml(item.img || "icons/svg/dice-target.svg")}" alt="" loading="lazy" />
            <span class="darkfinder-random-loot-item-name">${escapeHtml(item.name)}${escapeHtml(quantityLabel)}</span>
          </span>
          <span class="darkfinder-random-loot-item-price">${formatGold(item.price)} gp</span>
        </div>
      </div>
    `;
  }).join("");
}

function buildClaimPieChartHtml(claimantUsers) {
  if (!claimantUsers?.length) {
    return `<span class="darkfinder-random-loot-claim-pie-spacer" aria-hidden="true"></span>`;
  }

  const colors = claimantUsers.map((user) => resolveUserColor(user));
  const slice = 100 / colors.length;
  let start = 0;
  const segments = colors.map((color) => {
    const end = start + slice;
    const segment = `${color} ${start}% ${end}%`;
    start = end;
    return segment;
  });
  const title = claimantUsers
    .map((user) => String(user?.character?.name || user?.name || "Unknown"))
    .join(", ");

  return `<span class="darkfinder-random-loot-claim-pie" style="background: conic-gradient(${segments.join(", ")});" title="${escapeHtml(title)}"></span>`;
}

function buildSessionStatusText(session, role) {
  if (session.status === "resolving") {
    return "All submissions are in. Resolving contested items now...";
  }
  if (session.status === "resolved") {
    return "Loot claims have been resolved.";
  }
  if (session.status === "cancelled") {
    return "This loot claim session was cancelled.";
  }

  const participantIds = session.participantUserIds || [];
  const submittedIds = new Set(session.submittedUserIds || []);
  const waitingNames = participantIds
    .filter((userId) => !submittedIds.has(userId))
    .map((userId) => String(game.users.get(userId)?.character?.name || game.users.get(userId)?.name || "Unknown"));

  if (role === "gm") {
    if (!waitingNames.length) return "Every player is submitted. Finalizing now...";
    return `Waiting on: ${waitingNames.join(", ")}`;
  }

  const submittedText = submittedIds.has(game.user.id)
    ? "Your choices are locked in."
    : "Choose any items you want to claim, then submit when you are ready.";
  return waitingNames.length ? `${submittedText} Waiting on ${waitingNames.length} player(s).` : submittedText;
}

function openForceSubmitConfirmation(sessionId) {
  new Dialog({
    title: "Force Submit?",
    content: `<p>${escapeHtml(FORCE_SUBMIT_WARNING)}</p>`,
    buttons: {
      cancel: {
        label: "Cancel",
      },
      accept: {
        label: "Accept",
        callback: async () => {
          await broadcastLootSessionMessage({
            type: "request-force-submit",
            sessionId,
          });
        },
      },
    },
    default: "cancel",
  }).render(true);
}

function openPlayerSubmitConfirmation(sessionId) {
  new Dialog({
    title: "Submit Claims?",
    content: `<p>${escapeHtml(PLAYER_SUBMIT_WARNING)}</p>`,
    buttons: {
      cancel: {
        label: "Cancel",
      },
      accept: {
        label: "Accept",
        callback: async () => {
          await broadcastLootSessionMessage({
            type: "request-submit",
            sessionId,
            userId: game.user.id,
          });
        },
      },
    },
    default: "cancel",
  }).render(true);
}

function sessionAppliesToCurrentUser(session) {
  if (game.user?.isGM) return session.gmUserId === game.user.id;
  return (session.participantUserIds || []).includes(game.user.id);
}

function getResolvedClaimantUserIds(session, itemUuid) {
  const claimantIds = Array.isArray(session.claimsByItemUuid?.[itemUuid])
    ? session.claimsByItemUuid[itemUuid]
    : [];
  return claimantIds.filter((userId) => {
    const user = game.users.get(String(userId || "").trim());
    return !!resolveLootRecipientActor(user);
  });
}

function getLootParticipantUsers() {
  const activeEligible = (game.users?.contents || []).filter((user) => user.active && !user.isGM && !!resolveLootRecipientActor(user));
  if (activeEligible.length) return activeEligible;

  const registeredEligible = (game.users?.contents || []).filter((user) => !user.isGM && !!resolveLootRecipientActor(user));
  if (registeredEligible.length) return registeredEligible;

  const activeNonGm = (game.users?.contents || []).filter((user) => user.active && !user.isGM);
  if (activeNonGm.length) return activeNonGm;

  return (game.users?.contents || []).filter((user) => !user.isGM);
}

function getUserCharacterWealth(userId) {
  const user = game.users.get(String(userId || "").trim());
  return resolveActorWealth(resolveLootRecipientActor(user));
}

function normalizeSessionItems(items) {
  return (items || []).map((item) => ({
    id: String(item?.id || ""),
    uuid: String(item?.uuid || ""),
    name: String(item?.name || "Unnamed Item"),
    img: String(item?.img || "icons/svg/dice-target.svg"),
    price: Number(item?.price) || 0,
    description: String(item?.description || ""),
    typeLabel: String(item?.typeLabel || ""),
    quantity: Math.max(1, Number(item?.quantity) || 1),
  })).filter((item) => item.uuid && item.name);
}

function mergeAwardEntries(entries) {
  const merged = new Map();
  for (const entry of entries || []) {
    const userId = String(entry?.userId || "").trim();
    if (!userId) continue;
    const current = merged.get(userId) || { userId, quantity: 0, method: entry.method || "uncontested" };
    current.quantity += Math.max(1, Number(entry?.quantity) || 1);
    if (entry.method === "contested") current.method = "contested";
    merged.set(userId, current);
  }
  return Array.from(merged.values());
}

async function broadcastLootSessionMessage(message) {
  game.socket.emit(SOCKET_NAME, {
    ...message,
    moduleId: MODULE_ID,
  });
}

function getStoredLootSession() {
  return game.settings.get(MODULE_ID, SESSION_SETTING_KEY) || {};
}

function resolveSessionForClient(sessionId, fallbackSession = null) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return null;

  const storedSession = getStoredLootSession();
  if (storedSession?.id === normalizedSessionId) {
    cachePendingLootSession(storedSession);
    return storedSession;
  }

  const normalizedFallback = normalizeSocketSession(fallbackSession);
  if (normalizedFallback?.id === normalizedSessionId) {
    cachePendingLootSession(normalizedFallback);
    return normalizedFallback;
  }

  return lootSessionState.pendingSessionById.get(normalizedSessionId) || null;
}

function isLootSessionSettingDocument(setting) {
  const namespace = String(setting?.namespace || "").trim();
  const key = String(setting?.key || "").trim();
  const compositeKey = String(setting?.id || "").trim();

  if (namespace === MODULE_ID && key === SESSION_SETTING_KEY) return true;
  return compositeKey === `${MODULE_ID}.${SESSION_SETTING_KEY}`;
}

function closeAllLootSessionDialogs() {
  for (const sessionId of Array.from(lootSessionState.dialogStateBySessionId.keys())) {
    closeLootSessionDialog(sessionId);
  }
}

function closeAllLootResultsDialogs() {
  for (const sessionId of Array.from(lootSessionState.resultsDialogStateBySessionId.keys())) {
    closeLootResultsDialog(sessionId);
  }
}

function closeStaleLootSessionDialogs(activeSessionId) {
  for (const sessionId of Array.from(lootSessionState.dialogStateBySessionId.keys())) {
    if (sessionId !== activeSessionId) closeLootSessionDialog(sessionId);
  }
}

function closeStaleLootResultsDialogs(activeSessionId) {
  for (const sessionId of Array.from(lootSessionState.resultsDialogStateBySessionId.keys())) {
    if (sessionId !== activeSessionId) closeLootResultsDialog(sessionId);
  }
}

function cachePendingLootSession(session) {
  const normalizedSession = normalizeSocketSession(session);
  const sessionId = String(normalizedSession?.id || "").trim();
  if (!sessionId) return;
  lootSessionState.pendingSessionById.set(sessionId, normalizedSession);
}

function clearPendingLootSession(sessionId) {
  lootSessionState.pendingSessionById.delete(String(sessionId || "").trim());
}

function normalizeSocketSession(session) {
  return session && typeof session === "object" ? session : null;
}

function buildLootSessionSignature(session) {
  const normalizedSession = normalizeSocketSession(session);
  if (!normalizedSession) return "";

  return JSON.stringify({
    id: String(normalizedSession.id || ""),
    status: String(normalizedSession.status || ""),
    gmUserId: String(normalizedSession.gmUserId || ""),
    participantUserIds: [...(normalizedSession.participantUserIds || [])].map((userId) => String(userId || "")),
    submittedUserIds: [...(normalizedSession.submittedUserIds || [])].map((userId) => String(userId || "")),
    claimsByItemUuid: normalizedSession.claimsByItemUuid || {},
    resolution: normalizedSession.resolution || {},
    items: (normalizedSession.items || []).map((item) => ({
      uuid: String(item?.uuid || ""),
      quantity: Math.max(1, Number(item?.quantity) || 1),
    })),
  });
}

function resolveLootRecipientActor(user) {
  if (!user) return null;
  if (user.character) return user.character;

  const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const ownedActors = (game.actors?.contents || []).filter((actor) => actor?.testUserPermission?.(user, ownerLevel));
  if (ownedActors.length === 1) return ownedActors[0];
  return null;
}

async function setStoredLootSession(session) {
  await game.settings.set(MODULE_ID, SESSION_SETTING_KEY, session || {});
}

function isActiveSession(session) {
  return !!session?.id && ["collecting", "resolving"].includes(String(session.status || "").trim());
}

function resolveUserColor(user) {
  if (!user) return "#7b6650";
  const color = user.color;
  if (typeof color === "string" && color.trim()) return color;
  if (color && typeof color.css === "string" && color.css.trim()) return color.css;
  const fallback = String(color || "").trim();
  return fallback || "#7b6650";
}

function resolveActorWealth(actor) {
  if (!actor) return 0;
  return extractActorCurrencyValue(actor) + extractActorInventoryValue(actor);
}

function extractActorCurrencyValue(actor) {
  const denominations = [
    { key: "pp", multiplier: 10 },
    { key: "gp", multiplier: 1 },
    { key: "sp", multiplier: 0.1 },
    { key: "cp", multiplier: 0.01 },
  ];
  const currencyContainers = [
    foundry.utils.getProperty(actor, "system.currency") || {},
    foundry.utils.getProperty(actor, "system.altCurrency") || {},
  ];

  return currencyContainers.reduce((total, currency) => total + denominations.reduce((sum, denomination) => {
    const rawValue = currency?.[denomination.key];
    const quantity = extractNumericCount(rawValue);
    return sum + (quantity * denomination.multiplier);
  }, 0), 0);
}

function extractActorInventoryValue(actor) {
  return (actor.items || []).reduce((sum, item) => {
    if (!isWealthBearingItem(item)) return sum;
    const price = extractItemPrice(item);
    if (!Number.isFinite(price) || price <= 0) return sum;
    const quantity = extractItemQuantity(item);
    return sum + (price * quantity);
  }, 0);
}

function isWealthBearingItem(item) {
  const ignoredTypes = new Set(["class", "feat", "spell", "buff", "attack", "race", "aura", "condition"]);
  return !ignoredTypes.has(String(item?.type || "").toLowerCase());
}

function extractItemQuantity(item) {
  const quantityCandidates = [
    foundry.utils.getProperty(item, "system.quantity"),
    foundry.utils.getProperty(item, "system.quantity.value"),
    foundry.utils.getProperty(item, "quantity"),
    foundry.utils.getProperty(item, "data.quantity"),
  ];

  for (const candidate of quantityCandidates) {
    const quantity = extractNumericCount(candidate);
    if (quantity > 0) return quantity;
  }

  return 1;
}

function extractNumericCount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }
  if (typeof value === "string") {
    const numericText = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0] || "";
    const numeric = Number(numericText);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  }
  if (value && typeof value === "object") {
    const nestedCandidates = [value.value, value.amount, value.total, value.quantity];
    for (const nested of nestedCandidates) {
      const numeric = extractNumericCount(nested);
      if (numeric > 0) return numeric;
    }
  }
  return 0;
}

function extractItemPrice(document) {
  const candidatePaths = [
    foundry.utils.getProperty(document, "system.price"),
    foundry.utils.getProperty(document, "system.price.value"),
    foundry.utils.getProperty(document, "system.price.total"),
    foundry.utils.getProperty(document, "system.identified.price"),
    foundry.utils.getProperty(document, "system.identifiedPrice"),
    foundry.utils.getProperty(document, "system.unidentified.price"),
    foundry.utils.getProperty(document, "price"),
    foundry.utils.getProperty(document, "data.price"),
  ];

  for (const candidate of candidatePaths) {
    const numeric = normalizePriceValue(candidate);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }

  return NaN;
}

function normalizePriceValue(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === "string") {
    const numericText = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0] || "";
    const numeric = Number(numericText);
    return Number.isFinite(numeric) ? numeric : NaN;
  }
  if (value && typeof value === "object") {
    const nestedCandidates = [value.value, value.total, value.gp, value.base, value.amount];
    for (const nested of nestedCandidates) {
      const numeric = normalizePriceValue(nested);
      if (Number.isFinite(numeric)) return numeric;
    }
  }
  return NaN;
}

function showItemTooltip(eventRoot, session, itemUuid, event) {
  const tooltip = eventRoot.find("[data-role='item-tooltip']").first();
  if (!tooltip.length) return;

  const items = Array.isArray(session?.items) ? session.items : [];
  const item = items.find((entry) => entry.uuid === itemUuid) || null;
  if (!item) {
    hideItemTooltip(eventRoot);
    return;
  }

  tooltip.html(buildItemTooltipHtml(item));
  tooltip.addClass("is-visible");
  positionItemTooltip(eventRoot, event);
}

function positionItemTooltip(eventRoot, event) {
  const tooltip = eventRoot.find("[data-role='item-tooltip']").first();
  if (!tooltip.length || !tooltip.hasClass("is-visible")) return;

  const offsetX = 18;
  const offsetY = 18;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const tooltipWidth = tooltip.outerWidth() || 320;
  const tooltipHeight = tooltip.outerHeight() || 160;

  let left = (event?.clientX || 0) + offsetX;
  let top = (event?.clientY || 0) + offsetY;

  if (left + tooltipWidth > viewportWidth - 12) {
    left = Math.max(12, (event?.clientX || 0) - tooltipWidth - 12);
  }
  if (top + tooltipHeight > viewportHeight - 12) {
    top = Math.max(12, viewportHeight - tooltipHeight - 12);
  }

  tooltip.css({
    left: `${left}px`,
    top: `${top}px`,
  });
}

function hideItemTooltip(eventRoot) {
  const tooltip = eventRoot.find("[data-role='item-tooltip']").first();
  if (!tooltip.length) return;
  tooltip.removeClass("is-visible");
}

function buildItemTooltipHtml(item) {
  const descriptionHtml = normalizeTooltipDescriptionMarkup(item?.description);
  const typeOrSlotHtml = item?.typeLabel
    ? `<div class="darkfinder-random-loot-tooltip-meta">${escapeHtml(item.typeLabel)}</div>`
    : "";

  return `
    <div class="darkfinder-random-loot-tooltip-title">${escapeHtml(item?.name || "Unnamed Item")}</div>
    <div class="darkfinder-random-loot-tooltip-price">${formatGold(item?.price)} gp</div>
    ${typeOrSlotHtml}
    <div class="darkfinder-random-loot-tooltip-description">${descriptionHtml}</div>
  `;
}

function normalizeTooltipDescriptionMarkup(description) {
  const rawDescription = String(description || "").trim();
  if (!rawDescription) return "<p>No description available.</p>";

  return rawDescription
    .replace(/@(?:UUID|Compendium|Draw)\[[^\]]+\](?:\{([^}]+)\})?/g, (match, label) => {
      const fallbackLabel = resolveTooltipReferenceLabel(match);
      return escapeHtml(String(label || fallbackLabel || "Reference"));
    })
    .replace(/@(?:Check|Damage|Heal|Template|RollTable|Roll)\[[^\]]+\](?:\{([^}]+)\})?/g, (match, label) => {
      return escapeHtml(String(label || "Roll"));
    });
}

function resolveTooltipReferenceLabel(referenceText) {
  const pathText = String(referenceText || "").match(/\[([^\]]+)\]/)?.[1] || "";
  if (!pathText) return "Reference";

  const resolvedName = resolveTooltipDocumentName(pathText);
  if (resolvedName) return resolvedName;

  const segments = pathText.split(".");
  const lastSegment = segments[segments.length - 1] || "";
  if (lastSegment) {
    return lastSegment
      .replace(/[-_]+/g, " ")
      .replace(/\b([a-z])/g, (match) => match.toUpperCase());
  }

  return "Reference";
}

function resolveTooltipDocumentName(referencePath) {
  const normalizedPath = String(referencePath || "").trim();
  if (!normalizedPath) return "";

  try {
    if (typeof fromUuidSync === "function") {
      const document = fromUuidSync(normalizedPath);
      const name = String(document?.name || "").trim();
      if (name) return name;
    }
  } catch (error) {
    console.warn("Darkfinder loot session could not resolve tooltip reference synchronously.", error);
  }

  const compendiumMatch = normalizedPath.match(/^Compendium\.([^.]+\.[^.]+)\.([^.]+)\.([^.]+)$/);
  if (compendiumMatch) {
    const [, collection, documentType, documentId] = compendiumMatch;
    const pack = game.packs?.get(collection);
    if (pack) {
      const indexedEntry = pack.index?.get?.(documentId)
        || pack.index?.find?.((entry) => String(entry?._id || entry?.id || "") === documentId)
        || pack.contents?.find?.((entry) => String(entry?.id || entry?._id || "") === documentId);
      const indexedName = String(indexedEntry?.name || "").trim();
      if (indexedName) return indexedName;

      if (normalizeText(documentType) === "rolltable") {
        const worldTable = game.tables?.get(documentId);
        const worldTableName = String(worldTable?.name || "").trim();
        if (worldTableName) return worldTableName;
      }
    }
  }

  return "";
}

function sumItemPrices(items) {
  return (items || []).reduce((sum, item) => sum + ((Number(item?.price) || 0) * Math.max(1, Number(item?.quantity) || 1)), 0);
}

function formatGold(value) {
  return roundGold(value).toLocaleString("en-US");
}

function roundGold(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatSignedModifier(value) {
  const numeric = roundToHundredth(value);
  if (numeric > 0) return `+${numeric}`;
  if (numeric < 0) return `${numeric}`;
  return "0";
}

function clampNumber(value, min, max) {
  const numeric = Number(value) || 0;
  return Math.min(max, Math.max(min, numeric));
}

function roundToHundredth(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export {
  registerRandomLootSessionFeature,
};
