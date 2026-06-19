(async () => {
  if (!game.user?.isGM) {
    return ui.notifications.warn("Only a GM can run this macro.");
  }

  const PERIOD_OPTIONS = [
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ];

  const actorFolders = getActorFolders();
  if (!actorFolders.length) {
    return ui.notifications.warn("No Actor folders were found in this world.");
  }

  const availablePeriods = PERIOD_OPTIONS.filter((option) => findActorFoldersByName(actorFolders, option.value).length);
  if (!availablePeriods.length) {
    return ui.notifications.warn("No Actor folders named high, medium, or low were found.");
  }

  const selectedPeriod = await promptForPeriod(availablePeriods);
  if (!selectedPeriod) return;

  const matchingFolders = findActorFoldersByName(actorFolders, selectedPeriod);
  if (!matchingFolders.length) {
    return ui.notifications.warn(`No Actor folder named "${selectedPeriod}" was found.`);
  }
  if (matchingFolders.length > 1) {
    return ui.notifications.warn(`More than one Actor folder named "${selectedPeriod}" was found. Please make the folder name unique before running this macro.`);
  }

  const targetFolder = matchingFolders[0];
  const players = game.users?.contents?.filter((user) => !user.isGM) || [];
  if (!players.length) {
    return ui.notifications.info("No non-GM users were found to update.");
  }

  const folderActors = getActorsInFolder(targetFolder.id);
  for (const user of players) {
    const candidates = getOwnedCharacterCandidates(folderActors, user);
    const resolvedActor = resolveUserActorCandidate(user, candidates);

    if (!resolvedActor) {
      if (candidates.length > 1) {
        ui.notifications.error(`Multiple character sheets were found for ${getUserDisplayName(user)} in "${getFolderDisplayName(targetFolder)}": ${candidates.map((actor) => actor.name || actor.id).join(", ")}.`);
      } else {
        ui.notifications.error(`No character sheet was found for ${getUserDisplayName(user)} in "${getFolderDisplayName(targetFolder)}".`);
      }
      continue;
    }

    if (String(user.character?.id || user.character || "") === String(resolvedActor.id)) {
      ui.notifications.info(`${getUserDisplayName(user)} is already assigned to ${resolvedActor.name}.`);
      continue;
    }

    await user.update({ character: resolvedActor.id });
    ui.notifications.info(`Set ${getUserDisplayName(user)} to ${resolvedActor.name}.`);
  }

  function getActorFolders() {
    return (game.folders?.contents || []).filter((folder) => {
      const folderType = String(folder?.type || folder?.documentName || "").trim().toLowerCase();
      return folderType === "actor";
    });
  }

  function findActorFoldersByName(folders, folderName) {
    const normalizedSearch = normalizeText(folderName);
    const matches = (folders || []).filter((folder) => normalizeText(folder?.name) === normalizedSearch);
    if (matches.length <= 1) return matches;

    const preferredMatches = matches.filter((folder) => folderHasPreferredAncestor(folder));
    return preferredMatches.length ? preferredMatches : matches;
  }

  function getActorsInFolder(folderId) {
    return (game.actors?.contents || []).filter((actor) => String(actor?.folder?.id || actor?.folder || "") === String(folderId));
  }

  function folderHasPreferredAncestor(folder) {
    let current = folder?.folder || null;
    while (current) {
      const normalizedName = normalizeText(current.name);
      if (normalizedName === "players" || normalizedName === "characters") return true;
      current = current.folder || null;
    }
    return false;
  }

  function getOwnedCharacterCandidates(actors, user) {
    const characterActors = (actors || []).filter((actor) => String(actor?.type || "").trim().toLowerCase() === "character");
    const ownedCharacters = characterActors.filter((actor) => hasOwnerPermission(actor, user));
    if (ownedCharacters.length) return ownedCharacters;
    return (actors || []).filter((actor) => hasOwnerPermission(actor, user));
  }

  function resolveUserActorCandidate(user, candidates) {
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const currentCharacterId = String(user.character?.id || user.character || "");
    const exactCurrentMatch = candidates.find((actor) => String(actor.id) === currentCharacterId);
    if (exactCurrentMatch) return exactCurrentMatch;

    return null;
  }

  function hasOwnerPermission(actor, user) {
    if (!actor || !user) return false;
    if (typeof actor.testUserPermission === "function") {
      return actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
    }
    const level = typeof actor.getUserLevel === "function" ? Number(actor.getUserLevel(user)) : 0;
    return level >= Number(CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER || 3);
  }

  async function promptForPeriod(periodOptions) {
    const defaultPeriod = String(periodOptions[0]?.value || "").trim();
    const content = `
      <style>
        .darkfinder-time-switcher {
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
          width: 100%;
          height: 100%;
          min-height: 100%;
          line-height: 1.35;
          color: #241d14;
          overflow: hidden;
        }
        .darkfinder-time-switcher p {
          margin: 0;
        }
        .darkfinder-time-switcher-intro {
          flex: 0 0 auto;
          display: grid;
          gap: 0.45rem;
          padding: 0.9rem 1rem;
          border: 1px solid #705447;
          border-radius: 12px;
          background:
            linear-gradient(180deg, rgba(245, 239, 223, 0.98) 0%, rgba(228, 217, 195, 0.98) 100%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
        }
        .darkfinder-time-switcher-title {
          font-size: 1.1rem;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #6a3c34;
        }
        .darkfinder-time-switcher-help {
          color: #5a554a;
          font-size: 0.92rem;
        }
        .darkfinder-time-switcher-options {
          flex: 1 1 auto;
          min-height: 0;
          display: grid;
          gap: 0.7rem;
          overflow: hidden;
        }
        .darkfinder-time-switcher-option {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.9rem;
          flex: 1 1 0;
          min-height: 0;
          padding: 0.95rem 1rem;
          border: 1px solid #8f8673;
          border-radius: 12px;
          background:
            linear-gradient(180deg, rgba(241, 235, 219, 0.98) 0%, rgba(224, 214, 194, 0.98) 100%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.5),
            0 3px 8px rgba(0,0,0,0.08);
          cursor: pointer;
          transition: border-color 120ms ease, background 120ms ease, transform 120ms ease, box-shadow 120ms ease;
        }
        .darkfinder-time-switcher-option:hover {
          border-color: #7f684f;
          transform: translateY(-1px);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.55),
            0 6px 12px rgba(0,0,0,0.12);
        }
        .darkfinder-time-switcher-option input[type="radio"] {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }
        .darkfinder-time-switcher-option-marker {
          flex: 0 0 1rem;
          width: 1rem;
          height: 1rem;
          border: 2px solid #8a7b64;
          border-radius: 999px;
          background: rgba(255,255,255,0.7);
          box-sizing: border-box;
        }
        .darkfinder-time-switcher-option-copy {
          display: grid;
          gap: 0.18rem;
          min-width: 0;
        }
        .darkfinder-time-switcher-option-label {
          font-size: 1.02rem;
          font-weight: 800;
          color: #2b2218;
        }
        .darkfinder-time-switcher-option-detail {
          font-size: 0.9rem;
          color: #5d5346;
        }
        .darkfinder-time-switcher-option.selected {
          border-color: #57703b;
          background:
            linear-gradient(180deg, rgba(219, 229, 202, 0.98) 0%, rgba(194, 211, 171, 0.98) 100%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.52),
            0 6px 14px rgba(53,74,34,0.16);
        }
        .darkfinder-time-switcher-option.selected .darkfinder-time-switcher-option-marker {
          border-color: #4d6632;
          background: radial-gradient(circle at center, #4d6632 0 42%, #f2f0e8 45% 100%);
        }
        .darkfinder-time-switcher-actions {
          flex: 0 0 auto;
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
          padding-top: 0.1rem;
        }
        .darkfinder-time-switcher-button {
          min-width: 6.5rem;
          min-height: 2.15rem;
          padding: 0.4rem 0.95rem;
          border: 1px solid #8f8673;
          border-radius: 8px;
          background: linear-gradient(180deg, #e7dfce 0%, #cec2a7 100%);
          color: #1a1712;
          font-weight: 700;
          cursor: pointer;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
        }
        .darkfinder-time-switcher-button:hover {
          border-color: #6f644f;
          filter: brightness(1.02);
        }
        .darkfinder-time-switcher-button:active {
          transform: translateY(1px);
        }
        .darkfinder-time-switcher-button-primary {
          border-color: #5f7346;
          background: linear-gradient(180deg, #dce6c8 0%, #bccd9c 100%);
        }
        .darkfinder-time-switch-dialog .dialog-buttons {
          display: none !important;
        }
      </style>
      <div class="darkfinder-time-switcher">
        <div class="darkfinder-time-switcher-intro">
          <div class="darkfinder-time-switcher-title">Choose Time Period</div>
          <p>Select the timeline folder to make each player's representative character point at their owned sheet in that folder.</p>
          <div class="darkfinder-time-switcher-help">Folders must exist in the Actor directory and should contain one owned character per player.</div>
        </div>
        <div class="darkfinder-time-switcher-options" role="radiogroup" aria-label="Time Period">
          ${periodOptions.map((option) => {
            const isSelected = option.value === defaultPeriod;
            return `
              <label class="darkfinder-time-switcher-option${isSelected ? " selected" : ""}" data-time-period-option="${escapeHtml(option.value)}">
                <input type="radio" name="darkfinder-time-period" value="${escapeHtml(option.value)}" ${isSelected ? "checked" : ""} />
                <span class="darkfinder-time-switcher-option-marker" aria-hidden="true"></span>
                <span class="darkfinder-time-switcher-option-copy">
                  <span class="darkfinder-time-switcher-option-label">${escapeHtml(option.label)}</span>
                  <span class="darkfinder-time-switcher-option-detail">Switch all player representative sheets to the ${escapeHtml(option.label.toLowerCase())} timeline.</span>
                </span>
              </label>
            `;
          }).join("")}
        </div>
        <div class="darkfinder-time-switcher-actions">
          <button type="button" class="darkfinder-time-switcher-button" data-action="cancel">Cancel</button>
          <button type="button" class="darkfinder-time-switcher-button darkfinder-time-switcher-button-primary" data-action="accept">Accept</button>
        </div>
      </div>
    `;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const dialog = new Dialog({
        title: "Switch Representative Characters",
        content,
        buttons: {},
        width: 470,
        height: 455,
        resizable: false,
        render: async function(html) {
          dialog.setPosition({ width: 470, height: 455 });
          const appWindow = html.closest(".app.window-app");
          const dialogWindow = html.closest(".app.window-app, .dialog");
          let dialogContent = dialogWindow.find(".window-content");
          if (!dialogContent.length) dialogContent = html;

          if (appWindow.length) {
            appWindow.css({
              width: "470px",
              minWidth: "470px",
              maxWidth: "470px",
              height: "455px",
              minHeight: "455px",
              maxHeight: "455px",
            });
          }

          dialogWindow.css({
            width: "470px",
            minWidth: "470px",
            maxWidth: "470px",
            height: "455px",
            minHeight: "455px",
            maxHeight: "455px",
          });
          dialogWindow.addClass("darkfinder-time-switch-dialog");

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
          const updateSelectionState = () => {
            eventRoot.find(".darkfinder-time-switcher-option").each((_, element) => {
              const option = $(element);
              const isChecked = option.find("input[type='radio']").prop("checked");
              option.toggleClass("selected", !!isChecked);
            });
          };

          eventRoot.off("click", ".darkfinder-time-switcher-option").on("click", ".darkfinder-time-switcher-option", (event) => {
            const option = $(event.currentTarget);
            option.find("input[type='radio']").prop("checked", true).trigger("change");
          });
          eventRoot.off("change", "input[name='darkfinder-time-period']").on("change", "input[name='darkfinder-time-period']", updateSelectionState);
          eventRoot.off("click", "[data-action='accept']").on("click", "[data-action='accept']", () => {
            settle(String(eventRoot.find("input[name='darkfinder-time-period']:checked").val() || "").trim());
            dialog.close();
          });
          eventRoot.off("click", "[data-action='cancel']").on("click", "[data-action='cancel']", () => {
            settle(null);
            dialog.close();
          });
          updateSelectionState();
        },
        close: () => settle(null),
      }).render(true);
    });
  }

  function getFolderDisplayName(folder) {
    if (!folder) return "";
    const ancestry = [];
    let current = folder;
    while (current) {
      ancestry.unshift(String(current.name || ""));
      current = current.folder || null;
    }
    return ancestry.join(" / ");
  }

  function getUserDisplayName(user) {
    return String(user?.name || user?.id || "Unknown User");
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
})();
