(async () => {
  const MODULE_ID = "darkfinder";
  const PLAYER_PACK_ID = `${MODULE_ID}.darkfinder-player-macros`;
  const GM_PACK_ID = `${MODULE_ID}.darkfinder-gm-macros`;
  const DASHBOARD_PATH = "macros/player-macros/macro-dashboard/macro-dashboard.js";
  const DIALOG_KEY = "darkfinderMacroDashboardDialog";
  const PLAYER_DIALOG_WIDTH = 860;
  const GM_DIALOG_WIDTH = 1280;
  const DIALOG_HEIGHT = 820;
  const PLAYER_PANEL_WIDTH = 790;

  const moduleApi = game.modules.get(MODULE_ID)?.api || null;
  if (!moduleApi?.executeMacroFile) {
    return ui.notifications.error("Darkfinder's macro launcher API is unavailable.");
  }

  const existingDialog = globalThis[DIALOG_KEY];
  if (existingDialog?.rendered) {
    await existingDialog.close();
  }

  const playerMacros = await loadMacroEntries(PLAYER_PACK_ID);
  const isGm = game.user?.isGM === true;
  const gmMacros = isGm ? await loadMacroEntries(GM_PACK_ID) : [];
  if (!playerMacros.length && !gmMacros.length) {
    return ui.notifications.warn("No Darkfinder macros were available for this dashboard.");
  }

  const playerGroups = buildGroups(playerMacros, "player");
  const gmGroups = buildGroups(gmMacros, "gm");
  const dialogWidth = isGm ? GM_DIALOG_WIDTH : PLAYER_DIALOG_WIDTH;
  const dialog = new Dialog({
    title: "Macro Dashboard",
    content: buildDialogContent(playerGroups, gmGroups, isGm),
    buttons: {},
    width: dialogWidth,
    height: DIALOG_HEIGHT,
    resizable: false,
    render: async (html) => {
      applyDialogChrome(dialog, html, dialogWidth);
      bindDialogEvents(dialog, html);
    },
  });

  globalThis[DIALOG_KEY] = dialog;
  dialog.render(true);

  async function loadMacroEntries(packId) {
    const pack = game.packs.get(packId) || null;
    if (!pack) return [];

    const documents = await pack.getDocuments();
    return documents
      .map((document) => normalizeMacroEntry(document))
      .filter((entry) => entry && entry.relativePath !== DASHBOARD_PATH);
  }

  function normalizeMacroEntry(document) {
    const command = String(document?.command || "").trim();
    const relativePath = parseRelativePath(command);
    if (!relativePath) return null;

    return {
      id: String(document.id || document._id || relativePath),
      name: String(document.name || "Unnamed Macro"),
      img: String(document.img || "icons/svg/dice-target.svg"),
      relativePath,
    };
  }

  function parseRelativePath(command) {
    const match = String(command || "").match(/executeMacroFile\("([^"]+)"\)/);
    return match?.[1] ? String(match[1]) : "";
  }

  function buildGroups(entries, scope) {
    const categoryDefinitions = scope === "gm"
      ? [
          {
            key: "world",
            title: "World Tools",
            names: new Set([
              "Initiative Fix",
              "Repair Spell Attack Buttons (World)",
              "Switch Representative Characters",
            ]),
          },
          {
            key: "loot",
            title: "Treasure & Rewards",
            names: new Set(["Random Loot Generator"]),
          },
        ]
      : [
          {
            key: "spellcasting",
            title: "Spellcasting",
            names: new Set([
              "Concentration Tracker",
              "Spell Attack",
              "Spellcrafting",
            ]),
          },
          {
            key: "checks",
            title: "Checks & Recovery",
            names: new Set([
              "Endurance Check",
              "Resolve Check",
              "Sanity Check",
              "Short Rest",
            ]),
          },
          {
            key: "utility",
            title: "Utility",
            names: new Set([
              "Carried Light",
              "Fate Cards",
              "Reload Firearm",
            ]),
          },
        ];

    const grouped = [];
    const usedIds = new Set();
    for (const definition of categoryDefinitions) {
      const items = entries.filter((entry) => definition.names.has(entry.name));
      items.forEach((entry) => usedIds.add(entry.id));
      if (items.length) {
        grouped.push({
          key: definition.key,
          title: definition.title,
          items,
        });
      }
    }

    const uncategorized = entries.filter((entry) => !usedIds.has(entry.id));
    if (uncategorized.length) {
      grouped.push({
        key: "other",
        title: "Other",
        items: uncategorized,
      });
    }

    return grouped;
  }

  function buildDialogContent(playerGroupEntries, gmGroupEntries, isGm) {
    return `
      <style>
        .darkfinder-macro-dashboard {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          flex: 1 1 auto;
          width: 100%;
          height: 100%;
          min-height: 100%;
          overflow: hidden;
          background:
            radial-gradient(circle at top, rgba(176, 146, 89, 0.22), transparent 28%),
            linear-gradient(180deg, #2f281f 0%, #1e1812 100%);
          border: 1px solid #6d5a39;
          border-radius: 12px;
          padding: 0.9rem;
          box-sizing: border-box;
          color: #eadfbe;
        }

        .darkfinder-macro-dashboard-header {
          flex: 0 0 auto;
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.2rem 0.1rem 0.4rem;
          border-bottom: 1px solid rgba(142, 68, 58, 0.45);
        }

        .darkfinder-macro-dashboard-title {
          margin: 0;
          font-size: 1.6rem;
          line-height: 1.1;
          color: #f4e9ca;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .darkfinder-macro-dashboard-subtitle {
          margin: 0.2rem 0 0;
          color: rgba(239, 226, 191, 0.82);
          font-size: 0.95rem;
        }

        .darkfinder-macro-dashboard-badge {
          flex: 0 0 auto;
          padding: 0.35rem 0.7rem;
          border-radius: 999px;
          border: 1px solid rgba(190, 162, 103, 0.5);
          background: rgba(23, 18, 13, 0.72);
          color: #f2e6c4;
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .darkfinder-macro-dashboard-panels {
          display: grid;
          grid-template-columns: ${isGm ? `minmax(0, ${PLAYER_PANEL_WIDTH}px) minmax(0, 1fr)` : `minmax(0, ${PLAYER_PANEL_WIDTH}px)`};
          justify-content: ${isGm ? "stretch" : "center"};
          gap: 0.9rem;
          flex: 1 1 auto;
          min-height: 0;
        }

        .darkfinder-macro-dashboard-panel {
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          background:
            radial-gradient(circle at top, rgba(116, 88, 50, 0.18), transparent 34%),
            linear-gradient(180deg, rgba(59, 44, 29, 0.96), rgba(34, 25, 17, 0.98));
          border: 1px solid rgba(188, 157, 103, 0.42);
          border-radius: 12px;
          box-shadow: inset 0 0 0 1px rgba(255, 241, 210, 0.05);
          overflow: hidden;
        }

        .darkfinder-macro-dashboard-panel-header {
          flex: 0 0 auto;
          padding: 0.8rem 0.95rem 0.7rem;
          background: linear-gradient(180deg, rgba(33, 25, 18, 0.5), rgba(33, 25, 18, 0));
          border-bottom: 1px solid rgba(142, 68, 58, 0.36);
        }

        .darkfinder-macro-dashboard-panel-title {
          margin: 0;
          color: #f2e4bf;
          font-size: 1.15rem;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }

        .darkfinder-macro-dashboard-panel-subtitle {
          margin: 0.2rem 0 0;
          color: rgba(239, 226, 191, 0.72);
          font-size: 0.88rem;
        }

        .darkfinder-macro-dashboard-panel-body {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          padding: 0.9rem;
          flex: 1 1 auto;
          min-height: 0;
          overflow: auto;
        }

        .darkfinder-macro-dashboard-group {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
        }

        .darkfinder-macro-dashboard-group-title {
          margin: 0;
          font-size: 0.92rem;
          font-weight: 700;
          color: #efdfbb;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .darkfinder-macro-dashboard-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.6rem;
        }

        .darkfinder-macro-dashboard-grid--gm {
          grid-template-columns: minmax(0, 1fr);
        }

        .darkfinder-macro-dashboard-grid--single-remainder > .darkfinder-macro-dashboard-button:last-child {
          grid-column: 2;
        }

        .darkfinder-macro-dashboard-button {
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr);
          align-items: center;
          gap: 0.65rem;
          width: 100%;
          min-height: 70px;
          padding: 0.75rem 0.8rem;
          border-radius: 10px;
          border: 1px solid rgba(138, 118, 81, 0.85);
          background:
            linear-gradient(180deg, rgba(232, 213, 165, 0.26), rgba(150, 112, 58, 0.2)),
            rgba(72, 54, 34, 0.82);
          color: #f5e8c7;
          text-align: left;
          cursor: pointer;
          transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background 120ms ease;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
        }

        .darkfinder-macro-dashboard-button:hover {
          transform: translateY(-1px);
          border-color: rgba(140, 179, 112, 0.95);
          background:
            linear-gradient(180deg, rgba(215, 227, 178, 0.3), rgba(133, 175, 102, 0.22)),
            rgba(82, 64, 40, 0.92);
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.26);
        }

        .darkfinder-macro-dashboard-button:active {
          transform: translateY(0);
        }

        .darkfinder-macro-dashboard-button-icon {
          width: 42px;
          height: 42px;
          border-radius: 9px;
          border: 1px solid rgba(196, 171, 119, 0.35);
          background: rgba(16, 12, 9, 0.75);
          object-fit: cover;
          box-shadow: inset 0 0 0 1px rgba(255, 244, 220, 0.04);
        }

        .darkfinder-macro-dashboard-button-label {
          display: block;
          font-size: 0.98rem;
          font-weight: 700;
          line-height: 1.2;
          color: #f6ead1;
        }

        .darkfinder-macro-dashboard-empty {
          padding: 0.75rem 0.8rem;
          border-radius: 10px;
          border: 1px dashed rgba(188, 157, 103, 0.32);
          color: rgba(241, 228, 195, 0.72);
          background: rgba(17, 13, 10, 0.28);
        }
      </style>
      <div class="darkfinder-macro-dashboard">
        <div class="darkfinder-macro-dashboard-header">
          <div>
            <h2 class="darkfinder-macro-dashboard-title">Macro Dashboard</h2>
            <p class="darkfinder-macro-dashboard-subtitle">Launch any Darkfinder macro available to your current role.</p>
          </div>
          <div class="darkfinder-macro-dashboard-badge">${isGm ? "GM + Player Access" : "Player Access"}</div>
        </div>
        <div class="darkfinder-macro-dashboard-panels">
          ${buildPanelHtml({
            title: "Player Macros",
            subtitle: "Everyday checks, spell tools, and utility macros.",
            groups: playerGroupEntries,
            emptyText: "No player macros were available.",
          })}
          ${isGm ? buildPanelHtml({
            title: "GM Macros",
            subtitle: "World utilities and party-facing admin tools.",
            groups: gmGroupEntries,
            emptyText: "No GM macros were available.",
          }) : ""}
        </div>
      </div>
    `;
  }

  function buildPanelHtml({ title, subtitle, groups, emptyText }) {
    return `
      <section class="darkfinder-macro-dashboard-panel">
        <div class="darkfinder-macro-dashboard-panel-header">
          <h3 class="darkfinder-macro-dashboard-panel-title">${escapeHtml(title)}</h3>
          <p class="darkfinder-macro-dashboard-panel-subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <div class="darkfinder-macro-dashboard-panel-body">
          ${groups.length ? groups.map((group) => `
            <div class="darkfinder-macro-dashboard-group">
              <h4 class="darkfinder-macro-dashboard-group-title">${escapeHtml(group.title)}</h4>
              <div class="${buildGridClassName(group.items, title)}">
                ${group.items.map((entry) => buildMacroButtonHtml(entry)).join("")}
              </div>
            </div>
          `).join("") : `<div class="darkfinder-macro-dashboard-empty">${escapeHtml(emptyText)}</div>`}
        </div>
      </section>
    `;
  }

  function buildMacroButtonHtml(entry) {
    return `
      <button
        type="button"
        class="darkfinder-macro-dashboard-button"
        data-relative-path="${escapeHtml(entry.relativePath)}"
        data-macro-name="${escapeHtml(entry.name)}"
      >
        <img class="darkfinder-macro-dashboard-button-icon" src="${escapeHtml(entry.img)}" alt="">
        <span class="darkfinder-macro-dashboard-button-label">${escapeHtml(entry.name)}</span>
      </button>
    `;
  }

  function buildGridClassName(entries, panelTitle) {
    const isGmPanel = String(panelTitle || "").toLowerCase().includes("gm");
    const columns = isGmPanel ? 1 : 3;
    const remainder = entries.length % columns;
    const classes = ["darkfinder-macro-dashboard-grid"];
    if (isGmPanel) classes.push("darkfinder-macro-dashboard-grid--gm");
    if (remainder === 1 && entries.length > 1 && columns === 3) {
      classes.push("darkfinder-macro-dashboard-grid--single-remainder");
    }
    return classes.join(" ");
  }

  function bindDialogEvents(dialog, html) {
    html.on("click", ".darkfinder-macro-dashboard-button", async (event) => {
      const button = event.currentTarget;
      const relativePath = String(button?.dataset?.relativePath || "").trim();
      if (!relativePath) return;
      const hadLaunchNotifications = await executeMacroWithNotificationTracking(relativePath);
      if (!hadLaunchNotifications) {
        await dialog.close();
      }
    });
  }

  async function executeMacroWithNotificationTracking(relativePath) {
    const notificationsApi = ui?.notifications;
    if (!notificationsApi || typeof notificationsApi !== "object") {
      await moduleApi.executeMacroFile(relativePath);
      return false;
    }

    let notificationCount = 0;
    const originalMethods = {
      info: typeof notificationsApi.info === "function" ? notificationsApi.info.bind(notificationsApi) : null,
      warn: typeof notificationsApi.warn === "function" ? notificationsApi.warn.bind(notificationsApi) : null,
      error: typeof notificationsApi.error === "function" ? notificationsApi.error.bind(notificationsApi) : null,
    };

    const wrapMethod = (methodName) => {
      if (!originalMethods[methodName]) return;
      notificationsApi[methodName] = (...args) => {
        notificationCount += 1;
        return originalMethods[methodName](...args);
      };
    };

    wrapMethod("info");
    wrapMethod("warn");
    wrapMethod("error");

    try {
      await moduleApi.executeMacroFile(relativePath);
    } catch (error) {
      console.error(`${MODULE_ID} | Macro Dashboard could not execute macro "${relativePath}".`, error);
      notificationCount += 1;
      originalMethods.error?.(`Macro execution failed for ${relativePath}. Check the console for details.`);
    } finally {
      for (const [methodName, originalMethod] of Object.entries(originalMethods)) {
        if (originalMethod) notificationsApi[methodName] = originalMethod;
      }
    }

    return notificationCount > 0;
  }

  function applyDialogChrome(dialog, html, dialogWidth) {
    dialog.setPosition({ width: dialogWidth, height: DIALOG_HEIGHT });
    const appWindow = html.closest(".app.window-app");
    const dialogWindow = html.closest(".app.window-app, .dialog");
    let dialogContent = dialogWindow.find(".window-content");
    if (!dialogContent.length) dialogContent = html;

    if (appWindow.length) {
      appWindow.css({
        width: `${dialogWidth}px`,
        minWidth: `${dialogWidth}px`,
        maxWidth: `${dialogWidth}px`,
        height: `${DIALOG_HEIGHT}px`,
        minHeight: `${DIALOG_HEIGHT}px`,
        maxHeight: `${DIALOG_HEIGHT}px`,
      });
    }

    dialogWindow.css({
      width: `${dialogWidth}px`,
      minWidth: `${dialogWidth}px`,
      maxWidth: `${dialogWidth}px`,
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

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
