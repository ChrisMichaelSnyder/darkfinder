import { MODULE_ID } from "./api.js";

const SESSION_SETTING_KEY = "fateCardSession";
const SOCKET_NAME = `module.${MODULE_ID}`;
const DIALOG_REGISTRY_KEY = "darkfinderFateCardsDialog";
const DIALOG_WIDTH = 560;
const DIALOG_HEIGHT = 930;

const state = {
  hooksRegistered: false,
  settingWatcherIntervalId: null,
  lastObservedSessionSignature: "",
  lastOpenedSessionId: "",
};

function registerFateCardsSessionFeature(api) {
  if (!state.hooksRegistered) {
    Hooks.once("init", () => {
      game.settings.register(MODULE_ID, SESSION_SETTING_KEY, {
        name: "Fate Card Session",
        scope: "world",
        config: false,
        type: Object,
        default: {},
      });
    });

    Hooks.once("ready", () => {
      game.socket.on(SOCKET_NAME, handleSocketMessage);
      Hooks.on("updateSetting", handleFateCardSettingUpdate);
      startFateCardSettingWatcher();
    });

    state.hooksRegistered = true;
  }

  if (!api || typeof api !== "object") return;
  api.openFateCardsDialog = openFateCardsDialog;
  api.broadcastFateCardsDialog = broadcastFateCardsDialog;
}

async function broadcastFateCardsDialog(payload) {
  const session = buildSessionPayload(payload);
  if (!session) return null;

  if (game.user?.isGM) {
    await setStoredFateCardSession(session);
    broadcastSessionToClients(session);
    return session;
  }

  game.socket.emit(SOCKET_NAME, {
    moduleId: MODULE_ID,
    type: "request-show-dialog",
    sessionId: session.id,
    senderUserId: game.user.id,
    session,
  });

  return session;
}

async function handleSocketMessage(message) {
  const type = String(message?.type || "").trim();
  if (!message || typeof message !== "object") return;
  if (String(message.moduleId || "") !== MODULE_ID) return;

  if (type === "request-show-dialog") {
    if (!game.user?.isGM) return;
    const session = buildSessionPayload(message?.session);
    if (!session) return;
    await setStoredFateCardSession(session);
    broadcastSessionToClients(session);
    return;
  }

  if (type === "show-dialog") {
    const session = normalizeSession(message?.session);
    if (!session) return;
    if (state.lastOpenedSessionId === session.id) return;
    await openFateCardsDialog({
      ...(session.payload || {}),
      sessionId: session.id,
    });
  }
}

function handleFateCardSettingUpdate(setting) {
  if (!isFateCardSettingDocument(setting)) return;

  setTimeout(() => {
    void syncFateCardUiFromSetting(getStoredFateCardSession());
  }, 0);
}

function startFateCardSettingWatcher() {
  if (state.settingWatcherIntervalId) return;

  state.lastObservedSessionSignature = buildSessionSignature(getStoredFateCardSession());
  state.settingWatcherIntervalId = window.setInterval(() => {
    const storedSession = getStoredFateCardSession();
    const nextSignature = buildSessionSignature(storedSession);
    if (nextSignature === state.lastObservedSessionSignature) return;

    state.lastObservedSessionSignature = nextSignature;
    void syncFateCardUiFromSetting(storedSession);
  }, 350);
}

async function syncFateCardUiFromSetting(session) {
  const normalizedSession = normalizeSession(session);
  const sessionId = String(normalizedSession?.id || "").trim();
  if (!sessionId) return;
  if (state.lastOpenedSessionId === sessionId) return;

  await openFateCardsDialog(normalizedSession.payload || {});
  state.lastOpenedSessionId = sessionId;
}

function getStoredFateCardSession() {
  return game.settings.get(MODULE_ID, SESSION_SETTING_KEY) || {};
}

async function setStoredFateCardSession(session) {
  await game.settings.set(MODULE_ID, SESSION_SETTING_KEY, session || {});
}

function isFateCardSettingDocument(setting) {
  const namespace = String(setting?.namespace || "").trim();
  const key = String(setting?.key || "").trim();
  const compositeKey = String(setting?.id || "").trim();

  if (namespace === MODULE_ID && key === SESSION_SETTING_KEY) return true;
  return compositeKey === `${MODULE_ID}.${SESSION_SETTING_KEY}`;
}

function buildSessionSignature(session) {
  const normalized = normalizeSession(session);
  if (!normalized?.id) return "";
  return JSON.stringify({
    id: normalized.id,
    createdAt: Number(normalized.createdAt || 0),
  });
}

function buildSessionPayload(payload) {
  const normalizedPayload = normalizePayload(payload);
  if (!normalizedPayload?.card?.name || !normalizedPayload?.card?.image) return null;

  return {
    id: String(payload?.sessionId || randomID()),
    createdAt: Number(payload?.createdAt || Date.now()),
    senderUserId: String(game.user?.id || payload?.senderUserId || ""),
    payload: normalizedPayload,
  };
}

function broadcastSessionToClients(session) {
  const normalizedSession = normalizeSession(session);
  if (!normalizedSession?.id) return;

  game.socket.emit(SOCKET_NAME, {
    moduleId: MODULE_ID,
    type: "show-dialog",
    sessionId: normalizedSession.id,
    senderUserId: String(game.user?.id || normalizedSession.senderUserId || ""),
    session: normalizedSession,
  });
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;
  const payload = normalizePayload(session.payload);
  if (!payload?.card?.name || !payload?.card?.image) return null;

  return {
    id: String(session.id || ""),
    createdAt: Number(session.createdAt || 0),
    senderUserId: String(session.senderUserId || ""),
    payload,
  };
}

async function openFateCardsDialog(payload) {
  const normalized = normalizePayload(payload);
  if (!normalized?.card?.name || !normalized?.card?.image) {
    throw new Error("Fate Cards dialog payload was missing card data.");
  }

  const sessionId = String(payload?.sessionId || "").trim();
  const existingDialog = globalThis[DIALOG_REGISTRY_KEY];
  if (existingDialog?.rendered) {
    await existingDialog.close();
  }

  const actorAlignment = parseAlignment(normalized.actorContext?.alignment);
  const dialog = new Dialog({
    title: "Fate Cards",
    content: buildDialogContent(normalized.card),
    buttons: {},
    width: DIALOG_WIDTH,
    height: DIALOG_HEIGHT,
    resizable: false,
    render: async (html) => {
      applyDialogChrome(dialog, html);
      bindDialogEvents(html, normalized.card, normalized.actorContext, actorAlignment);
    },
  });

  globalThis[DIALOG_REGISTRY_KEY] = dialog;
  if (sessionId) state.lastOpenedSessionId = sessionId;
  dialog.render(true);
  return dialog;
}

function buildDialogContent(card) {
  return `
    <style>
      .fate-cards-root {
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
        flex: 1 1 auto;
        width: 100%;
        height: 100%;
        min-height: 100%;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(173, 145, 89, 0.24), transparent 30%),
          linear-gradient(180deg, #2c261e 0%, #1d1813 100%);
        border: 1px solid #6e5c3d;
        border-radius: 10px;
        padding: 0.75rem;
        box-sizing: border-box;
        color: #eadfc2;
      }

      .fate-cards-panel {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        background: linear-gradient(180deg, rgba(74, 57, 37, 0.78), rgba(41, 31, 20, 0.88));
        border: 1px solid rgba(183, 149, 98, 0.5);
        border-radius: 10px;
        padding: 0.75rem;
        box-shadow: inset 0 0 0 1px rgba(255, 241, 210, 0.06);
      }

      .fate-cards-frame {
        position: relative;
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: 10px;
        border: 1px solid rgba(196, 164, 111, 0.55);
        background:
          linear-gradient(135deg, rgba(20, 16, 12, 0.9), rgba(60, 48, 33, 0.7)),
          #15110d;
      }

      .fate-cards-image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #100d09;
      }

      .fate-cards-chip {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2;
        padding: 0.35rem 0.6rem;
        border-radius: 999px;
        background: rgba(17, 13, 10, 0.78);
        color: #f2e4bf;
        border: 1px solid rgba(201, 172, 117, 0.45);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(3px);
      }

      .fate-cards-chip--meta {
        bottom: 14px;
        font-size: 0.92rem;
        font-weight: 600;
      }

      .fate-cards-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.65rem;
        padding: 1rem;
        background:
          radial-gradient(circle at center, rgba(89, 24, 24, 0.12), rgba(10, 8, 6, 0.74) 72%),
          linear-gradient(180deg, rgba(18, 14, 10, 0.2), rgba(18, 14, 10, 0.82));
        opacity: 0;
        pointer-events: none;
        transition: opacity 180ms ease;
        z-index: 1;
      }

      .fate-cards-overlay.visible {
        opacity: 1;
      }

      .fate-cards-total {
        min-width: 180px;
        padding: 0.75rem 1.2rem;
        border-radius: 18px;
        border: 2px solid rgba(230, 211, 160, 0.82);
        background: linear-gradient(180deg, rgba(133, 29, 29, 0.92), rgba(83, 19, 19, 0.96));
        color: #fff6d8;
        text-align: center;
        font-size: 3.1rem;
        font-weight: 800;
        line-height: 1;
        letter-spacing: 0.04em;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
        box-shadow:
          0 20px 30px rgba(0, 0, 0, 0.45),
          inset 0 1px 0 rgba(255, 255, 255, 0.14);
      }

      .fate-cards-breakdown {
        max-width: 90%;
        padding: 0.55rem 0.8rem;
        border-radius: 12px;
        background: rgba(17, 13, 10, 0.8);
        border: 1px solid rgba(230, 211, 160, 0.28);
        color: #eadfc2;
        text-align: center;
        white-space: pre-line;
        font-size: 1rem;
        font-weight: 600;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34);
      }

      .fate-cards-footer {
        display: flex;
        flex: 0 0 auto;
        justify-content: center;
      }

      .fate-cards-button {
        flex: 0 0 auto;
        width: min(100%, 250px);
        min-height: 2.6rem;
        border-radius: 8px;
        border: 1px solid #8a7651;
        background: linear-gradient(180deg, #d9c08c 0%, #b0915d 100%);
        color: #2c2117;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.24);
      }

      .fate-cards-button:hover {
        filter: brightness(1.04);
        transform: translateY(-1px);
      }

      .fate-cards-button:active {
        transform: translateY(0);
      }

      .fate-cards-button--primary {
        background: linear-gradient(180deg, #d8d2af 0%, #b3a06a 100%);
      }
    </style>
    <div class="fate-cards-root">
      <div class="fate-cards-panel">
        <div class="fate-cards-frame">
          <img class="fate-cards-image" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}">
          <div class="fate-cards-chip fate-cards-chip--meta">${escapeHtml(card.abilityLabel)} • ${escapeHtml(card.alignmentLabel)}</div>
          <div class="fate-cards-overlay" data-role="overlay">
            <div class="fate-cards-total" data-role="total-bonus"></div>
            <div class="fate-cards-breakdown" data-role="breakdown"></div>
          </div>
        </div>
      </div>
      <div class="fate-cards-footer">
        <button type="button" class="fate-cards-button fate-cards-button--primary" data-action="calculate">Thinking is Hard</button>
      </div>
    </div>
  `;
}

function applyDialogChrome(dialog, html) {
  dialog.setPosition({ width: DIALOG_WIDTH, height: DIALOG_HEIGHT });
  const appWindow = html.closest(".app.window-app");
  const dialogWindow = html.closest(".app.window-app, .dialog");
  let dialogContent = dialogWindow.find(".window-content");
  if (!dialogContent.length) dialogContent = html;

  if (appWindow.length) {
    appWindow.css({
      width: `${DIALOG_WIDTH}px`,
      minWidth: `${DIALOG_WIDTH}px`,
      maxWidth: `${DIALOG_WIDTH}px`,
      height: `${DIALOG_HEIGHT}px`,
      minHeight: `${DIALOG_HEIGHT}px`,
      maxHeight: `${DIALOG_HEIGHT}px`,
    });
  }

  dialogWindow.css({
    width: `${DIALOG_WIDTH}px`,
    minWidth: `${DIALOG_WIDTH}px`,
    maxWidth: `${DIALOG_WIDTH}px`,
    height: `${DIALOG_HEIGHT}px`,
    minHeight: `${DIALOG_HEIGHT}px`,
    maxHeight: `${DIALOG_HEIGHT}px`,
  });

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
}

function bindDialogEvents(html, card, actorContext, actorAlignment) {
  html.on("click", '[data-action="calculate"]', () => {
    const overlay = html.find('[data-role="overlay"]');
    if (overlay.hasClass("visible")) {
      overlay.removeClass("visible");
      return;
    }

    const result = calculateCardBonus(actorContext, card, actorAlignment);
    overlay.addClass("visible");
    html.find('[data-role="total-bonus"]').text(formatModifier(result.totalBonus));
    html.find('[data-role="breakdown"]').text(
      `${card.abilityLabel} ${formatModifier(result.abilityBonus)}\n${card.alignmentLabel} ${formatModifier(result.alignmentBonus)}`,
    );
  });
}

function calculateCardBonus(actorContext, card, parsedAlignment) {
  const abilityBonus = Number(getAbilityModifier(actorContext, card.ability) || 0);
  const alignmentBonus = getAlignmentMatchBonus(parsedAlignment, parseAlignment(card.alignment));
  return {
    abilityBonus,
    alignmentBonus,
    totalBonus: abilityBonus + alignmentBonus,
  };
}

function getAlignmentMatchBonus(actorParsedAlignment, cardParsedAlignment) {
  if (!actorParsedAlignment || !cardParsedAlignment) return 0;
  let matchedAxes = 0;
  if (actorParsedAlignment.lawChaos === cardParsedAlignment.lawChaos) matchedAxes += 1;
  if (actorParsedAlignment.goodEvil === cardParsedAlignment.goodEvil) matchedAxes += 1;
  if (matchedAxes >= 2) return 3;
  if (matchedAxes === 1) return 1;
  return -2;
}

function getAbilityModifier(actorContext, abilityKey) {
  const normalizedKey = normalizeAbilityKey(abilityKey);
  if (!normalizedKey) return null;
  const value = Number(actorContext?.abilities?.[normalizedKey]);
  return Number.isFinite(value) ? value : null;
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const card = payload.card && typeof payload.card === "object" ? payload.card : {};
  const actorContext = payload.actorContext && typeof payload.actorContext === "object" ? payload.actorContext : {};

  return {
    card: {
      name: String(card.name || ""),
      ability: String(card.ability || ""),
      abilityLabel: String(card.abilityLabel || ""),
      alignment: String(card.alignment || ""),
      alignmentLabel: String(card.alignmentLabel || ""),
      image: String(card.image || ""),
    },
    actorContext: {
      name: String(actorContext.name || ""),
      alignment: String(actorContext.alignment || ""),
      abilities: {
        str: Number(actorContext?.abilities?.str || 0),
        dex: Number(actorContext?.abilities?.dex || 0),
        con: Number(actorContext?.abilities?.con || 0),
        int: Number(actorContext?.abilities?.int || 0),
        wis: Number(actorContext?.abilities?.wis || 0),
        cha: Number(actorContext?.abilities?.cha || 0),
      },
    },
  };
}

function parseAlignment(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const collapsed = raw.replace(/[^a-z]/g, "");
  const directMap = {
    lg: "lg",
    lawfulgood: "lg",
    ln: "ln",
    lawfulneutral: "ln",
    le: "le",
    lawfulevil: "le",
    ng: "ng",
    neutralgood: "ng",
    n: "n",
    truenatural: "n",
    trueneutral: "n",
    neutral: "n",
    ne: "ne",
    neutralevil: "ne",
    cg: "cg",
    chaoticgood: "cg",
    cn: "cn",
    chaoticneutral: "cn",
    ce: "ce",
    chaoticevil: "ce",
  };

  const code = directMap[collapsed];
  if (!code) {
    const lawChaos = collapsed.includes("lawful") ? "l" : collapsed.includes("chaotic") ? "c" : "n";
    const goodEvil = collapsed.includes("good") ? "g" : collapsed.includes("evil") ? "e" : "n";
    const derived = `${lawChaos}${goodEvil}`.replace(/^nn$/, "n");
    if (!directMap[derived]) return null;
    return toParsedAlignment(directMap[derived]);
  }

  return toParsedAlignment(code);
}

function toParsedAlignment(code) {
  const normalized = String(code || "").toLowerCase();
  const axisMap = {
    lg: ["l", "g"],
    ln: ["l", "n"],
    le: ["l", "e"],
    ng: ["n", "g"],
    n: ["n", "n"],
    ne: ["n", "e"],
    cg: ["c", "g"],
    cn: ["c", "n"],
    ce: ["c", "e"],
  };
  const axes = axisMap[normalized];
  if (!axes) return null;
  return {
    code: normalized,
    lawChaos: axes[0],
    goodEvil: axes[1],
  };
}

function normalizeAbilityKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const aliases = {
    str: "str",
    strength: "str",
    dex: "dex",
    dexterity: "dex",
    con: "con",
    constitution: "con",
    int: "int",
    intelligence: "int",
    wis: "wis",
    wisdom: "wis",
    cha: "cha",
    charisma: "cha",
  };
  return aliases[normalized] || null;
}

function formatModifier(value) {
  const numeric = Number(value || 0);
  return numeric >= 0 ? `+${numeric}` : `${numeric}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export {
  registerFateCardsSessionFeature,
};
