(async () => {
  if (!game.user?.isGM) {
    return ui.notifications.warn("Only a GM can run this macro.");
  }

  const DIALOG_WIDTH = 1080;
  const DIALOG_HEIGHT = 760;
  const PLAYER_DIALOG_WIDTH = 680;
  const PLAYER_DIALOG_HEIGHT = 760;
  const AUDIT_DIALOG_WIDTH = 720;
  const AUDIT_DIALOG_HEIGHT = 700;
  const MAX_REROLL_ITEMS = 8;
  const TARGET_TOLERANCE = 0.1;
  const CAP_RARITY_WEIGHT_STRENGTH = 1.5;
  const CONSUMABLE_WAND_CHARGE_OPTIONS = [50, 40, 30, 20, 10];
  const CONSUMABLE_CATEGORY_WEIGHTS = {
    permanent: 1,
    potion: 1.28,
    scroll: 1.16,
    wand: 1.12,
  };
  const HEALING_CATEGORY_WEIGHTS = {
    potion: 2.8,
    scroll: 1.7,
    wand: 2.05,
  };
  const CONSUMABLE_REPEAT_DAMPING = 0.93;
  const SAME_CONSUMABLE_TYPE_DAMPING = 0.86;
  const SAME_CONSUMABLE_SPELL_DAMPING = 0.38;
  const TARGET_PACK_NAMES = [
    "gear/wonderous",
    "gear/wondrous",
    "equipment/magic items",
  ];
  const LOOT_CACHE_KEY = "__darkfinderRandomLootCache";
  const LOOT_CACHE_VERSION = "v5";
  const wealthTablePayload = {
    source: {
      label: "Pathfinder 1e Character Wealth by Level",
      url: "https://www.d20pfsrd.com/gamemastering/",
      verifiedOn: "2026-07-03",
    },
    notes: {
      level1: "Level 1 uses a 150 gp baseline because the cited WBL chart begins at level 2.",
    },
    wealthByLevel: {
      1: 150,
      2: 1000,
      3: 3000,
      4: 6000,
      5: 10500,
      6: 16000,
      7: 23500,
      8: 33000,
      9: 46000,
      10: 62000,
      11: 82000,
      12: 108000,
      13: 140000,
      14: 185000,
      15: 240000,
      16: 315000,
      17: 410000,
      18: 530000,
      19: 685000,
      20: 880000,
    },
  };
  const wealthByLevel = wealthTablePayload.wealthByLevel || {};

  const registeredNonGmPlayers = getRegisteredNonGmPlayers();
  const partyLevelPlayers = getPreferredPartyLevelPlayers();
  const preloadPacks = resolveLootCompendiumPacks();
  const defaultCharacterCount = clampInteger(registeredNonGmPlayers.length || 1, 1, 12);
  const defaultPartyLevel = clampInteger(calculateAveragePartyLevel(partyLevelPlayers), 1, 20);
  const state = {
    partyLevel: defaultPartyLevel,
    percentOfWbl: 20,
    characterCount: defaultCharacterCount,
    maxItems: 10,
    rerolledItemCounts: new Map(),
    generatedItems: [],
    generationStatus: "Choose your budget settings, then click Generate to build a loot list.",
    generationMeta: {
      totalValue: 0,
      count: 0,
    },
    isGenerating: false,
    activeLootSessionId: "",
    lootSessionWatcherId: null,
    isClosingForLootSession: false,
  };

  const content = buildDialogContent(state, wealthTablePayload);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const dialog = new Dialog({
      title: "Random Loot Generator",
      content,
      buttons: {},
      width: DIALOG_WIDTH,
      height: DIALOG_HEIGHT,
      resizable: false,
      render: async function(html) {
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
        dialogWindow.addClass("darkfinder-random-loot-dialog darkfinder-random-loot-generator-dialog");

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
        bindDialogEvents(eventRoot, dialog, state, wealthByLevel, settle);
        renderState(eventRoot, state, wealthByLevel);
        startLootPreload(preloadPacks);
      },
      close: () => {
        stopLootSessionWatcher(state);
        if (!state.isClosingForLootSession && state.activeLootSessionId) {
          const randomLootApi = game.modules.get("darkfinder")?.api;
          if (typeof randomLootApi?.cancelRandomLootClaimSession === "function") {
            void randomLootApi.cancelRandomLootClaimSession(state.activeLootSessionId, { silent: true });
          }
        }
        settle(null);
      },
    }).render(true);
  });

  function bindDialogEvents(eventRoot, dialog, state, wealthByLevel, settle) {
    eventRoot.off("click", ".darkfinder-random-loot-stepper").on("click", ".darkfinder-random-loot-stepper", (event) => {
      event.preventDefault();
      const button = event.currentTarget;
      if (button.disabled) return;
      const field = String(button.dataset.field || "").trim();
      const delta = Number(button.dataset.delta || 0);
      adjustFieldValue(state, field, delta);
      renderState(eventRoot, state, wealthByLevel);
    });

    eventRoot.off("input", ".darkfinder-random-loot-input").on("input", ".darkfinder-random-loot-input", (event) => {
      const input = event.currentTarget;
      const field = String(input.dataset.field || "").trim();
      const normalizedText = String(input.value || "").replace(/[^\d-]/g, "");
      if (!normalizedText) return;
      const nextValue = Number.parseInt(normalizedText, 10);
      setFieldValue(state, field, nextValue);
      renderState(eventRoot, state, wealthByLevel, { preserveFocusField: field });
    });

    eventRoot.off("blur", ".darkfinder-random-loot-input").on("blur", ".darkfinder-random-loot-input", (event) => {
      const input = event.currentTarget;
      const field = String(input.dataset.field || "").trim();
      setFieldValue(state, field, Number(input.value || 0));
      renderState(eventRoot, state, wealthByLevel);
    });

    eventRoot.off("click", "[data-action='cancel']").on("click", "[data-action='cancel']", (event) => {
      event.preventDefault();
      dialog.close();
    });

    eventRoot.off("click", "[data-action='generate']").on("click", "[data-action='generate']", async (event) => {
      event.preventDefault();
      if (state.isGenerating) return;
      state.isGenerating = true;
      state.generationStatus = "Scanning compendiums and generating loot...";
      renderState(eventRoot, state, wealthByLevel);

      try {
        const generated = await generateLootItems(state, wealthByLevel);
        state.generatedItems = sortItemsByPriceDesc(generated.items);
        state.generationMeta = {
          totalValue: generated.totalValue,
          count: generated.items.length,
          targetBudget: generated.targetBudget,
        };
        state.generationStatus = generated.status;
      } catch (error) {
        console.warn("Random Loot Generator failed to generate loot.", error);
        state.generatedItems = [];
        state.generationMeta = {
          totalValue: 0,
          count: 0,
        };
        state.generationStatus = error?.message || "The loot list could not be generated.";
        ui.notifications.error(state.generationStatus);
      } finally {
        state.isGenerating = false;
        renderState(eventRoot, state, wealthByLevel);
      }
    });

    eventRoot.off("click", "[data-action='send-to-players']").on("click", "[data-action='send-to-players']", async (event) => {
      event.preventDefault();
      if (state.isGenerating || !state.generatedItems.length) return;

      const playerPayload = createPlayerLootPayload(state.generatedItems);
      const randomLootApi = game.modules.get("darkfinder")?.api;
      if (typeof randomLootApi?.openRandomLootClaimSession === "function") {
        const session = await randomLootApi.openRandomLootClaimSession(playerPayload, {
          title: "Party Loot",
        });
        state.activeLootSessionId = String(session?.id || "");
        state.isClosingForLootSession = false;
        startLootSessionWatcher(state, dialog);
        ui.notifications.info("Opened the loot claim session for all connected players.");
        return;
      }

      await openPlayerLootDialog(playerPayload, {
        title: "Party Loot",
      });
      ui.notifications.warn("Darkfinder's module-side loot session API was not available, so the local-only preview window was opened instead.");
    });

    eventRoot.off("click", ".darkfinder-random-loot-item-body").on("click", ".darkfinder-random-loot-item-body", async (event) => {
      event.preventDefault();
      const row = event.currentTarget;
      const itemUuid = String(row.dataset.itemUuid || "").trim();
      if (!itemUuid) return;

      try {
        const clickedItem = state.generatedItems.find((item) => item.uuid === itemUuid) || null;
        const document = await resolveLootItemDocument(clickedItem);
        if (!document?.sheet) {
          return ui.notifications.warn("That compendium item could not be opened.");
        }
        document.sheet.render(true);
      } catch (error) {
        console.warn("Random Loot Generator could not open compendium item.", error);
        ui.notifications.error("That compendium item could not be opened.");
      }
    });

    eventRoot.off("mouseenter", ".darkfinder-random-loot-item-body").on("mouseenter", ".darkfinder-random-loot-item-body", (event) => {
      const row = event.currentTarget;
      const itemUuid = String(row.dataset.itemUuid || "").trim();
      if (!itemUuid) return;
      showItemTooltip(eventRoot, state, itemUuid, event);
    });

    eventRoot.off("mousemove", ".darkfinder-random-loot-item-body").on("mousemove", ".darkfinder-random-loot-item-body", (event) => {
      positionItemTooltip(eventRoot, event);
    });

    eventRoot.off("mouseleave", ".darkfinder-random-loot-item-body").on("mouseleave", ".darkfinder-random-loot-item-body", () => {
      hideItemTooltip(eventRoot);
    });

    eventRoot.off("click", "[data-item-action='remove']").on("click", "[data-item-action='remove']", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const button = event.currentTarget;
      const itemUuid = String(button.dataset.itemUuid || "").trim();
      if (!itemUuid) return;

      const removedItem = state.generatedItems.find((item) => item.uuid === itemUuid) || null;
      state.generatedItems = sortItemsByPriceDesc(state.generatedItems.filter((item) => item.uuid !== itemUuid));
      syncGenerationMetaFromItems(state);
      state.generationStatus = removedItem
        ? `Removed ${removedItem.name}. Total is now ${formatGold(state.generationMeta.totalValue)} gp across ${state.generationMeta.count} item(s).`
        : "Removed an item from the generated list.";
      renderState(eventRoot, state, wealthByLevel);
    });

    eventRoot.off("click", "[data-item-action='reroll']").on("click", "[data-item-action='reroll']", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.isGenerating) return;

      const button = event.currentTarget;
      const itemUuid = String(button.dataset.itemUuid || "").trim();
      const itemToReplace = state.generatedItems.find((item) => item.uuid === itemUuid) || null;
      if (!itemToReplace) return;

      state.isGenerating = true;
      state.generationStatus = `Rerolling ${itemToReplace.name}...`;
      renderState(eventRoot, state, wealthByLevel);

      try {
        const replacementItems = await rerollGeneratedItem(itemToReplace, state, wealthByLevel);
        rememberRerolledItem(state, itemToReplace.uuid);
        state.generatedItems = sortItemsByPriceDesc([
          ...state.generatedItems.filter((item) => item.uuid !== itemUuid),
          ...replacementItems,
        ]);
        syncGenerationMetaFromItems(state);
        state.generationStatus = `Replaced ${itemToReplace.name} with ${replacementItems.length} item(s) totaling ${formatGold(sumItemPrices(replacementItems))} gp.`;
      } catch (error) {
        console.warn("Random Loot Generator could not reroll item.", error);
        state.generationStatus = error?.message || `Could not reroll ${itemToReplace.name}.`;
        ui.notifications.error(state.generationStatus);
      } finally {
        state.isGenerating = false;
        renderState(eventRoot, state, wealthByLevel);
      }
    });

    eventRoot.off("click", "[data-action='open-wealth-audit']").on("click", "[data-action='open-wealth-audit']", async (event) => {
      event.preventDefault();
      if (state.isGenerating) return;
      await openPartyWealthAuditDialog();
    });
  }

  function startLootSessionWatcher(state, dialog) {
    stopLootSessionWatcher(state);
    const sessionId = String(state.activeLootSessionId || "").trim();
    if (!sessionId) return;

    state.lootSessionWatcherId = window.setInterval(() => {
      const activeSession = getActiveRandomLootSession();
      if (activeSession?.id !== sessionId) {
        state.activeLootSessionId = "";
        stopLootSessionWatcher(state);
        return;
      }

      if (activeSession.status !== "collecting") {
        state.activeLootSessionId = "";
        stopLootSessionWatcher(state);
      }
    }, 500);
  }

  function stopLootSessionWatcher(state) {
    if (state.lootSessionWatcherId) {
      window.clearInterval(state.lootSessionWatcherId);
      state.lootSessionWatcherId = null;
    }
  }

  function getActiveRandomLootSession() {
    try {
      const session = game.settings.get("darkfinder", "randomLootSession");
      return session && typeof session === "object" ? session : {};
    } catch (error) {
      console.warn("Random Loot Generator could not read the active loot session.", error);
      return {};
    }
  }

  function renderState(eventRoot, state, wealthByLevel, options = {}) {
    const computed = buildGeneratedLootSettings(state, wealthByLevel);
    const inputs = {
      partyLevel: eventRoot.find("input[data-field='partyLevel']").first(),
      percentOfWbl: eventRoot.find("input[data-field='percentOfWbl']").first(),
      characterCount: eventRoot.find("input[data-field='characterCount']").first(),
      maxItems: eventRoot.find("input[data-field='maxItems']").first(),
    };

    inputs.partyLevel.val(String(state.partyLevel));
    inputs.percentOfWbl.val(String(state.percentOfWbl));
    inputs.characterCount.val(String(state.characterCount));
    inputs.maxItems.val(String(state.maxItems));

    if (options.preserveFocusField && inputs[options.preserveFocusField]?.length) {
      const input = inputs[options.preserveFocusField];
      const node = input.get(0);
      if (node && document.activeElement !== node) node.focus();
    }

    eventRoot.find("[data-value='party-vs-next-wbl']").html(buildPartyWealthDeltaHtml(
      computed.partyWealthDeltaFromNextWbl,
      computed.partyWealthVsNextWblPercent
    ));
    eventRoot.find("[data-value='per-player-share']").text(`${formatGold(computed.perPlayerShare)} gp`);
    eventRoot.find("[data-value='max-item-value']").text(`${formatGold(computed.maxSingleItemValue)} gp`);
    eventRoot.find("[data-value='budget-total']").text(`${formatGold(computed.totalGold)} gp`);
    eventRoot.find("[data-value='budget-total']").attr(
      "title",
      `${formatGold(computed.amountToNextWbl)} x ${computed.characterCount} x ${computed.percentOfWbl}%`
    );

    const generateButton = eventRoot.find("[data-action='generate']").first();
    const auditButton = eventRoot.find("[data-action='open-wealth-audit']").first();
    const sendButton = eventRoot.find("[data-action='send-to-players']").first();
    const stepperButtons = eventRoot.find(".darkfinder-random-loot-stepper");
    const textInputs = eventRoot.find(".darkfinder-random-loot-input");
    generateButton.prop("disabled", state.isGenerating);
    generateButton.text(state.isGenerating ? "Generating..." : "Generate");
    auditButton.prop("disabled", state.isGenerating);
    sendButton.prop("disabled", state.isGenerating || !state.generatedItems.length);
    stepperButtons.prop("disabled", state.isGenerating);
    textInputs.prop("disabled", state.isGenerating);
    hideItemTooltip(eventRoot);

    eventRoot.find("[data-value='results-status']").text(state.generationStatus || "");
    eventRoot.find("[data-value='results-total']").text(`${formatGold(state.generationMeta?.totalValue || 0)} gp`);
    eventRoot.find("[data-value='results-count']").text(String(state.generationMeta?.count || 0));
    eventRoot.find("[data-value='results-list']").html(buildGeneratedItemsHtml(state.generatedItems));
  }

  async function generateLootItems(state, wealthByLevel) {
    const settings = buildGeneratedLootSettings(state, wealthByLevel);
    const maxSingleItemValue = settings.maxSingleItemValue;
    if (maxSingleItemValue <= 0) {
      throw new Error("The selected party level does not have a usable wealth-by-level value.");
    }

    const targetBudget = settings.totalGold;
    const minimumTarget = Math.floor(targetBudget * (1 - TARGET_TOLERANCE));
    const maximumTarget = Math.ceil(targetBudget * (1 + TARGET_TOLERANCE));

    const packs = resolveLootCompendiumPacks();
    const candidateItems = await loadLootCandidates(packs, maxSingleItemValue);
    if (!candidateItems.length) {
      throw new Error(`No eligible loot candidates were found at or below ${formatGold(maxSingleItemValue)} gp.`);
    }

    const remainingCandidates = [...candidateItems];
    const selectedItems = [];
    let totalValue = 0;

    while (remainingCandidates.length && selectedItems.length < settings.maxItems) {
      if (totalValue >= minimumTarget && totalValue <= maximumTarget) break;

      const affordableCandidates = remainingCandidates.filter((candidate) => candidate.price <= Math.max(0, maximumTarget - totalValue));
      const choicePool = affordableCandidates.length ? affordableCandidates : remainingCandidates;
      const selectedCandidate = chooseWeightedRandomCandidate(choicePool, targetBudget - totalValue, {
        maxSingleItemValue,
        selectedItems,
      });
      if (!selectedCandidate) break;

      selectedItems.push(selectedCandidate);
      totalValue += selectedCandidate.price;

      const selectedIndex = remainingCandidates.findIndex((candidate) => candidate.uuid === selectedCandidate.uuid);
      if (selectedIndex >= 0) {
        remainingCandidates.splice(selectedIndex, 1);
      } else {
        break;
      }
    }

    const success = totalValue >= minimumTarget && totalValue <= maximumTarget;
    const reachedCap = selectedItems.length >= settings.maxItems;
    const noMoreItems = !remainingCandidates.length;
    const status = buildGenerationStatus({
      success,
      totalValue,
      targetBudget,
      count: selectedItems.length,
      maxSingleItemValue,
      maxItems: settings.maxItems,
      reachedCap,
      noMoreItems,
    });

    return {
      items: selectedItems,
      totalValue,
      targetBudget,
      status,
    };
  }

  async function rerollGeneratedItem(itemToReplace, state, wealthByLevel) {
    const settings = buildGeneratedLootSettings(state, wealthByLevel);
    const maxSingleItemValue = settings.maxSingleItemValue;
    const packs = resolveLootCompendiumPacks();

    const excludedUuids = new Set(state.generatedItems.map((item) => item.uuid));
    excludedUuids.delete(itemToReplace.uuid);

    const candidateItems = (await loadLootCandidates(packs, maxSingleItemValue))
      .filter((candidate) => !excludedUuids.has(candidate.uuid));

    if (!candidateItems.length) {
      throw new Error("No eligible replacement items were available for this reroll.");
    }

    const rerolled = buildItemBundleForTarget(itemToReplace.price, candidateItems, {
      maxItems: MAX_REROLL_ITEMS,
      maxSingleItemValue,
      rerolledItemCounts: state.rerolledItemCounts,
    });

    if (!rerolled.items.length) {
      throw new Error(`Could not find a replacement bundle within +/-10% of ${formatGold(itemToReplace.price)} gp.`);
    }

    return rerolled.items;
  }

  function buildGenerationStatus({ success, totalValue, targetBudget, count, maxSingleItemValue, maxItems, reachedCap, noMoreItems }) {
    const summary = `Generated ${count} item(s) totaling ${formatGold(totalValue)} gp against a ${formatGold(targetBudget)} gp budget.`;
    if (success) return `${summary} The total landed within the allowed +/-10% range.`;
    if (reachedCap) return `${summary} Stopped after reaching the ${maxItems}-item limit.`;
    if (noMoreItems) return `${summary} No more eligible items remained under the ${formatGold(maxSingleItemValue)} gp single-item cap.`;
    return `${summary} The available item pool could not land within the allowed +/-10% range.`;
  }

  function buildGeneratedItemsHtml(items) {
    if (!items?.length) {
      return "<div class=\"darkfinder-random-loot-results-empty\">No generated items yet.</div>";
    }

    return items.map((item) => `
      <div
        class="darkfinder-random-loot-item-row"
      >
        <span class="darkfinder-random-loot-item-actions darkfinder-random-loot-item-actions-left">
          <button
            type="button"
            class="darkfinder-random-loot-item-action darkfinder-random-loot-item-action-reroll"
            data-item-action="reroll"
            data-item-uuid="${escapeHtml(item.uuid)}"
            title="Reroll this item"
            aria-label="Reroll ${escapeHtml(item.name)}"
          ><img src="icons/svg/dice-target.svg" alt="" /></button>
          <button
            type="button"
            class="darkfinder-random-loot-item-action darkfinder-random-loot-item-action-remove"
            data-item-action="remove"
            data-item-uuid="${escapeHtml(item.uuid)}"
            title="Remove this item"
            aria-label="Remove ${escapeHtml(item.name)}"
          ><img src="icons/svg/cancel.svg" alt="" /></button>
        </span>
        <div
          class="darkfinder-random-loot-item-body"
          data-item-uuid="${escapeHtml(item.uuid)}"
        >
          <span class="darkfinder-random-loot-item-main">
            <img class="darkfinder-random-loot-item-icon" src="${escapeHtml(item.img || "icons/svg/dice-target.svg")}" alt="" loading="lazy" />
            <span class="darkfinder-random-loot-item-name">${escapeHtml(item.name)}</span>
          </span>
          <span class="darkfinder-random-loot-item-price">${formatGold(item.price)} gp</span>
        </div>
      </div>
    `).join("");
  }

  function buildPlayerGeneratedItemsHtml(items) {
    if (!items?.length) {
      return "<div class=\"darkfinder-random-loot-results-empty\">No items have been shared yet.</div>";
    }

    return items.map((item) => {
      const isClaimed = !!item?.claimed;

      return `
        <div class="darkfinder-random-loot-item-row">
          <span class="darkfinder-random-loot-item-actions darkfinder-random-loot-item-actions-left darkfinder-random-loot-player-item-actions-left">
            <input
              type="checkbox"
              class="darkfinder-random-loot-player-item-checkbox"
              data-player-item-action="toggle-claim"
              data-item-uuid="${escapeHtml(item.uuid)}"
              aria-label="Include ${escapeHtml(item.name)}"
              ${isClaimed ? "checked" : ""}
            />
          </span>
          <div
            class="darkfinder-random-loot-item-body"
            data-item-uuid="${escapeHtml(item.uuid)}"
          >
            <span class="darkfinder-random-loot-item-main">
              <img class="darkfinder-random-loot-item-icon" src="${escapeHtml(item.img || "icons/svg/dice-target.svg")}" alt="" loading="lazy" />
              <span class="darkfinder-random-loot-item-name">${escapeHtml(item.name)}</span>
            </span>
            <span class="darkfinder-random-loot-item-price">${formatGold(item.price)} gp</span>
          </div>
        </div>
      `;
    }).join("");
  }

  function createPlayerLootPayload(items) {
    return (items || []).map((item) => ({
      id: String(item?.id || ""),
      uuid: String(item?.uuid || ""),
      sourceUuid: String(item?.sourceUuid || ""),
      name: String(item?.name || "Unnamed Item"),
      img: String(item?.img || "icons/svg/dice-target.svg"),
      price: Number(item?.price) || 0,
      description: String(item?.description || ""),
      typeLabel: String(item?.typeLabel || ""),
      quantity: Math.max(1, Number(item?.quantity) || 1),
      sourceType: String(item?.sourceType || "permanent"),
      generationSource: cloneGenerationSource(item?.generationSource),
      claimed: false,
    }));
  }

  async function openPlayerLootDialog(items, options = {}) {
    const playerState = {
      items: createPlayerLootPayload(items),
      isSubmitting: false,
    };
    const content = buildPlayerDialogContent(playerState, options);

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const dialog = new Dialog({
        title: options.title || "Party Loot",
        content,
        buttons: {},
        width: PLAYER_DIALOG_WIDTH,
        height: PLAYER_DIALOG_HEIGHT,
        resizable: false,
        render: async function(html) {
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
          bindPlayerDialogEvents(eventRoot, dialog, playerState, settle);
          renderPlayerDialogState(eventRoot, playerState);
        },
        close: () => settle(null),
      }).render(true);
    });
  }

  function bindPlayerDialogEvents(eventRoot, dialog, state, settle) {
    eventRoot.off("click", ".darkfinder-random-loot-item-body").on("click", ".darkfinder-random-loot-item-body", async (event) => {
      event.preventDefault();
      const row = event.currentTarget;
      const itemUuid = String(row.dataset.itemUuid || "").trim();
      if (!itemUuid) return;

      try {
        const clickedItem = state.items.find((item) => item.uuid === itemUuid) || null;
        const document = await resolveLootItemDocument(clickedItem);
        if (!document?.sheet) {
          return ui.notifications.warn("That compendium item could not be opened.");
        }
        document.sheet.render(true);
      } catch (error) {
        console.warn("Random Loot Generator could not open compendium item.", error);
        ui.notifications.error("That compendium item could not be opened.");
      }
    });

    eventRoot.off("mouseenter", ".darkfinder-random-loot-item-body").on("mouseenter", ".darkfinder-random-loot-item-body", (event) => {
      const row = event.currentTarget;
      const itemUuid = String(row.dataset.itemUuid || "").trim();
      if (!itemUuid) return;
      showItemTooltip(eventRoot, state, itemUuid, event);
    });

    eventRoot.off("mousemove", ".darkfinder-random-loot-item-body").on("mousemove", ".darkfinder-random-loot-item-body", (event) => {
      positionItemTooltip(eventRoot, event);
    });

    eventRoot.off("mouseleave", ".darkfinder-random-loot-item-body").on("mouseleave", ".darkfinder-random-loot-item-body", () => {
      hideItemTooltip(eventRoot);
    });

    eventRoot.off("change", "[data-player-item-action='toggle-claim']").on("change", "[data-player-item-action='toggle-claim']", (event) => {
      event.stopPropagation();
      const checkbox = event.currentTarget;
      const itemUuid = String(checkbox.dataset.itemUuid || "").trim();
      if (!itemUuid) return;

      state.items = (state.items || []).map((item) => item.uuid === itemUuid
        ? { ...item, claimed: !!checkbox.checked }
        : item);
      renderPlayerDialogState(eventRoot, state);
    });

    eventRoot.off("click", "[data-action='submit-player-loot']").on("click", "[data-action='submit-player-loot']", (event) => {
      event.preventDefault();
      ui.notifications.info("Done is not wired up yet.");
    });
  }

  function renderPlayerDialogState(eventRoot, state) {
    hideItemTooltip(eventRoot);
    eventRoot.find("[data-value='player-results-total']").text(`${formatGold(sumItemPrices(state.items))} gp`);
    eventRoot.find("[data-value='player-results-count']").text(String((state.items || []).length));
    eventRoot.find("[data-value='player-results-list']").html(buildPlayerGeneratedItemsHtml(state.items));
  }

  async function openPartyWealthAuditDialog() {
    const players = getPartyWealthPlayers();
    const rows = players
      .filter((user) => !!user?.character)
      .map((user) => {
        const actor = user.character;
        const currencyWealth = extractActorCurrencyValue(actor);
        const inventoryWealth = extractActorInventoryValue(actor);
        const totalWealth = currencyWealth + inventoryWealth;

        return {
          playerName: String(user.name || "Unknown Player"),
          characterName: String(actor.name || "Unknown Character"),
          level: resolveActorLevel(actor),
          currencyWealth,
          inventoryWealth,
          totalWealth,
        };
      })
      .sort((left, right) => right.totalWealth - left.totalWealth);

    if (!rows.length) {
      return ui.notifications.warn("No player characters were found to audit.");
    }

    const totalPartyWealth = rows.reduce((sum, row) => sum + row.totalWealth, 0);
    const averagePartyWealth = totalPartyWealth / rows.length;

    console.group("Darkfinder Party Wealth Audit");
    console.table(rows.map((row) => ({
      player: row.playerName,
      character: row.characterName,
      level: row.level,
      currencyGp: roundGold(row.currencyWealth),
      inventoryGp: roundGold(row.inventoryWealth),
      totalGp: roundGold(row.totalWealth),
    })));
    console.log(`Tracked characters: ${rows.length}`);
    console.log(`Total party wealth: ${formatGold(totalPartyWealth)} gp`);
    console.log(`Average per character: ${formatGold(averagePartyWealth)} gp`);
    console.groupEnd();

    const content = buildPartyWealthAuditContent(rows, {
      totalPartyWealth,
      averagePartyWealth,
    });

    new Dialog({
      title: "Party Wealth Audit",
      content,
      buttons: {
        close: {
          label: "Close",
        },
      },
      width: AUDIT_DIALOG_WIDTH,
      height: AUDIT_DIALOG_HEIGHT,
      resizable: false,
      render: async function(html) {
        const dialog = this;
        dialog.setPosition({ width: AUDIT_DIALOG_WIDTH, height: AUDIT_DIALOG_HEIGHT });
        const appWindow = html.closest(".app.window-app");
        const dialogWindow = html.closest(".app.window-app, .dialog");
        let dialogContent = dialogWindow.find(".window-content");
        if (!dialogContent.length) dialogContent = html;

        if (appWindow.length) {
          appWindow.css({
            width: `${AUDIT_DIALOG_WIDTH}px`,
            minWidth: `${AUDIT_DIALOG_WIDTH}px`,
            maxWidth: `${AUDIT_DIALOG_WIDTH}px`,
            height: `${AUDIT_DIALOG_HEIGHT}px`,
            minHeight: `${AUDIT_DIALOG_HEIGHT}px`,
            maxHeight: `${AUDIT_DIALOG_HEIGHT}px`,
          });
        }

        dialogWindow.css({
          width: `${AUDIT_DIALOG_WIDTH}px`,
          minWidth: `${AUDIT_DIALOG_WIDTH}px`,
          maxWidth: `${AUDIT_DIALOG_WIDTH}px`,
          height: `${AUDIT_DIALOG_HEIGHT}px`,
          minHeight: `${AUDIT_DIALOG_HEIGHT}px`,
          maxHeight: `${AUDIT_DIALOG_HEIGHT}px`,
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
      },
    }).render(true);

    ui.notifications.info("Party wealth audit opened. Detailed totals were also written to the browser console.");
  }

  function buildPartyWealthAuditContent(rows, summary) {
    return `
      <style>
        .darkfinder-wealth-audit {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          width: 100%;
          height: 100%;
          min-height: 100%;
          overflow: hidden;
          color: #241d14;
        }
        .darkfinder-wealth-audit-summary {
          flex: 0 0 auto;
          display: grid;
          gap: 0.2rem;
          padding: 0.85rem 0.95rem;
          border: 1px solid #705447;
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(245,239,223,0.98) 0%, rgba(227,216,194,0.98) 100%);
        }
        .darkfinder-wealth-audit-summary strong {
          color: #503225;
        }
        .darkfinder-wealth-audit-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 0.2rem;
        }
        .darkfinder-wealth-audit-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.8rem;
          align-items: center;
          padding: 0.75rem 0.85rem;
          border: 1px solid rgba(143, 134, 115, 0.95);
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(241,235,219,0.98) 0%, rgba(224,214,194,0.98) 100%);
        }
        .darkfinder-wealth-audit-main {
          min-width: 0;
        }
        .darkfinder-wealth-audit-name {
          font-weight: 900;
          color: #2b2218;
        }
        .darkfinder-wealth-audit-meta {
          margin-top: 0.15rem;
          font-size: 0.84rem;
          color: #5f5548;
        }
        .darkfinder-wealth-audit-breakdown {
          margin-top: 0.25rem;
          font-size: 0.82rem;
          color: #4f463b;
        }
        .darkfinder-wealth-audit-total {
          font-weight: 900;
          color: #4d6632;
          white-space: nowrap;
        }
      </style>
      <div class="darkfinder-wealth-audit">
        <div class="darkfinder-wealth-audit-summary">
          <div><strong>Tracked characters:</strong> ${rows.length}</div>
          <div><strong>Total party wealth:</strong> ${formatGold(summary.totalPartyWealth)} gp</div>
          <div><strong>Average per character:</strong> ${formatGold(summary.averagePartyWealth)} gp</div>
        </div>
        <div class="darkfinder-wealth-audit-list">
          ${rows.map((row) => `
            <div class="darkfinder-wealth-audit-row">
              <div class="darkfinder-wealth-audit-main">
                <div class="darkfinder-wealth-audit-name">${escapeHtml(row.characterName)}</div>
                <div class="darkfinder-wealth-audit-meta">${escapeHtml(row.playerName)} | Level ${row.level}</div>
                <div class="darkfinder-wealth-audit-breakdown">
                  Currency: ${formatGold(row.currencyWealth)} gp | Inventory: ${formatGold(row.inventoryWealth)} gp
                </div>
              </div>
              <div class="darkfinder-wealth-audit-total">${formatGold(row.totalWealth)} gp</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function buildItemBundleForTarget(targetBudget, candidates, options = {}) {
    const maxItems = clampMinInteger(options.maxItems || 1, 1);
    const minimumTarget = Math.floor(targetBudget * (1 - TARGET_TOLERANCE));
    const maximumTarget = Math.ceil(targetBudget * (1 + TARGET_TOLERANCE));
    const remainingCandidates = [...(candidates || [])];
    const selectedItems = [];
    let totalValue = 0;

    while (remainingCandidates.length && selectedItems.length < maxItems) {
      if (totalValue >= minimumTarget && totalValue <= maximumTarget) break;

      const affordableCandidates = remainingCandidates.filter((candidate) => candidate.price <= Math.max(0, maximumTarget - totalValue));
      const choicePool = affordableCandidates.length ? affordableCandidates : remainingCandidates;
      const selectedCandidate = chooseWeightedRandomCandidate(choicePool, targetBudget - totalValue, {
        selectedItems,
        maxSingleItemValue: options.maxSingleItemValue,
        rerolledItemCounts: options.rerolledItemCounts,
      });
      if (!selectedCandidate) break;

      selectedItems.push(selectedCandidate);
      totalValue += selectedCandidate.price;

      const selectedIndex = remainingCandidates.findIndex((candidate) => candidate.uuid === selectedCandidate.uuid);
      if (selectedIndex >= 0) {
        remainingCandidates.splice(selectedIndex, 1);
      } else {
        break;
      }
    }

    if (!(totalValue >= minimumTarget && totalValue <= maximumTarget)) {
      return { items: [], totalValue: 0 };
    }

    return {
      items: selectedItems,
      totalValue,
    };
  }

  function buildGeneratedLootSettings(state, wealthByLevel) {
    const partyLevel = clampMinInteger(state.partyLevel, 1);
    const percentOfWbl = clampMinInteger(state.percentOfWbl, 0);
    const characterCount = clampMinInteger(state.characterCount, 1);
    const maxItems = clampMinInteger(state.maxItems, 1);
    const currentWealthPerCharacter = getCurrentWealthForLevel(wealthByLevel, partyLevel);
    const amountToNextWbl = getWealthIncreaseForLevel(wealthByLevel, partyLevel);
    const partyWealthPlayers = getPartyWealthPlayers();
    const totalPartyWealth = calculateTotalPartyWealth(partyWealthPlayers);
    const trackedCharacterCount = getTrackedCharacterCount(partyWealthPlayers);
    const averagePartyWealth = trackedCharacterCount > 0 ? totalPartyWealth / trackedCharacterCount : 0;
    const partyWealthDeltaFromNextWbl = calculatePartyWealthDeltaFromNextWbl(
      totalPartyWealth,
      currentWealthPerCharacter,
      amountToNextWbl,
      trackedCharacterCount
    );
    const partyWealthVsNextWblPercent = calculatePartyWealthVsNextWblPercent(
      totalPartyWealth,
      currentWealthPerCharacter,
      amountToNextWbl,
      trackedCharacterCount
    );
    const totalGold = Math.round(amountToNextWbl * characterCount * (percentOfWbl / 100));
    const perPlayerShare = characterCount > 0 ? Math.round(totalGold / characterCount) : 0;
    const maxSingleItemValue = Math.floor(amountToNextWbl);

    return {
      partyLevel,
      percentOfWbl,
      characterCount,
      maxItems,
      currentWealthPerCharacter,
      amountToNextWbl,
      trackedCharacterCount,
      totalPartyWealth,
      averagePartyWealth,
      partyWealthDeltaFromNextWbl,
      partyWealthVsNextWblPercent,
      totalGold,
      perPlayerShare,
      maxSingleItemValue,
    };
  }

  function calculateTotalPartyWealth(players) {
    const wealthValues = (players || [])
      .map((user) => resolveActorWealth(user?.character))
      .filter((value) => Number.isFinite(value) && value >= 0);

    return wealthValues.reduce((sum, value) => sum + value, 0);
  }

  function getTrackedCharacterCount(players) {
    return (players || []).filter((user) => !!user?.character).length;
  }

  function calculatePartyWealthDeltaFromNextWbl(totalPartyWealth, currentWealthPerCharacter, amountToNextWbl, characterCount) {
    const safeCharacterCount = clampMinInteger(characterCount, 1);
    const nextWealthPerCharacter = (Number(currentWealthPerCharacter) || 0) + (Number(amountToNextWbl) || 0);
    const nextPartyWealth = nextWealthPerCharacter * safeCharacterCount;
    return (Number(totalPartyWealth) || 0) - nextPartyWealth;
  }

  function calculatePartyWealthVsNextWblPercent(totalPartyWealth, currentWealthPerCharacter, amountToNextWbl, characterCount) {
    const safeCharacterCount = clampMinInteger(characterCount, 1);
    const currentPartyWealthTarget = (Number(currentWealthPerCharacter) || 0) * safeCharacterCount;
    const nextWealthPerCharacter = (Number(currentWealthPerCharacter) || 0) + (Number(amountToNextWbl) || 0);
    const nextPartyWealth = nextWealthPerCharacter * safeCharacterCount;
    const gapToNextPartyWealth = nextPartyWealth - currentPartyWealthTarget;
    if (gapToNextPartyWealth <= 0) return null;

    return ((Number(totalPartyWealth) || 0) - nextPartyWealth) / gapToNextPartyWealth * 100;
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
    const ignoredTypes = new Set([
      "class",
      "feat",
      "spell",
      "buff",
      "attack",
      "race",
      "aura",
      "condition",
    ]);
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

  function getCurrentWealthForLevel(wealthByLevel, level) {
    const currentLevel = clampMinInteger(level, 1);
    const highestDefinedLevel = getHighestDefinedWealthLevel(wealthByLevel);
    const resolvedLevel = Math.min(currentLevel, highestDefinedLevel || currentLevel);
    return Number(wealthByLevel?.[String(resolvedLevel)] || 0);
  }

  function getWealthIncreaseForLevel(wealthByLevel, level) {
    const currentLevel = clampMinInteger(level, 1);
    const currentWealth = getCurrentWealthForLevel(wealthByLevel, currentLevel);
    const nextWealth = Number(wealthByLevel?.[String(currentLevel + 1)] || 0);

    if (Number.isFinite(nextWealth) && nextWealth > currentWealth) {
      return nextWealth - currentWealth;
    }

    return 0;
  }

  function getHighestDefinedWealthLevel(wealthByLevel) {
    return Object.keys(wealthByLevel || {})
      .map((key) => Number(key))
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((highest, value) => Math.max(highest, value), 0);
  }

  function adjustFieldValue(state, field, delta) {
    if (field === "partyLevel") {
      state.partyLevel = clampMinInteger(state.partyLevel + delta, 1);
      return;
    }
    if (field === "percentOfWbl") {
      state.percentOfWbl = clampMinInteger(state.percentOfWbl + delta, 0);
      return;
    }
    if (field === "characterCount") {
      state.characterCount = clampMinInteger(state.characterCount + delta, 1);
      return;
    }
    if (field === "maxItems") {
      state.maxItems = clampMinInteger(state.maxItems + delta, 1);
    }
  }

  function setFieldValue(state, field, value) {
    if (field === "partyLevel") {
      state.partyLevel = clampMinInteger(value, 1);
      return;
    }
    if (field === "percentOfWbl") {
      state.percentOfWbl = clampMinInteger(value, 0);
      return;
    }
    if (field === "characterCount") {
      state.characterCount = clampMinInteger(value, 1);
      return;
    }
    if (field === "maxItems") {
      state.maxItems = clampMinInteger(value, 1);
    }
  }

  function buildDialogContent(state, wealthTablePayload) {
    const sourceLabel = escapeHtml(String(wealthTablePayload?.source?.label || "Character Wealth by Level"));
    const sourceUrl = escapeHtml(String(wealthTablePayload?.source?.url || ""));
    const levelOneNote = wealthTablePayload?.notes?.level1 || "";

    return `
      <style>
        .darkfinder-random-loot {
          display: flex;
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
        .darkfinder-random-loot p {
          margin: 0;
        }
        .darkfinder-random-loot-controls {
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
          flex: 0 0 430px;
          width: 430px;
          min-width: 430px;
          height: 100%;
          min-height: 0;
        }
        .darkfinder-random-loot-results {
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
          flex: 1 1 auto;
          min-width: 0;
          min-height: 0;
          height: 100%;
        }
        .darkfinder-random-loot-intro,
        .darkfinder-random-loot-summary,
        .darkfinder-random-loot-results-shell {
          flex: 0 0 auto;
          display: grid;
          gap: 0.35rem;
          padding: 0.85rem 0.95rem;
          border: 1px solid #705447;
          border-radius: 14px;
          background:
            linear-gradient(180deg, rgba(245, 239, 223, 0.98) 0%, rgba(227, 216, 194, 0.98) 100%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
        }
        .darkfinder-random-loot-kicker {
          font-size: 0.76rem;
          font-weight: 800;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #7b6650;
        }
        .darkfinder-random-loot-title {
          font-size: 1.28rem;
          font-weight: 900;
          letter-spacing: 0.03em;
          color: #5f3a2f;
        }
        .darkfinder-random-loot-help {
          color: #5b554a;
          font-size: 0.9rem;
        }
        .darkfinder-random-loot-source {
          color: #6f644f;
          font-size: 0.78rem;
        }
        .darkfinder-random-loot-source a {
          color: #6a3c34;
          font-weight: 700;
        }
        .darkfinder-random-loot-settings {
          flex: 1 1 auto;
          min-height: 0;
          display: grid;
          gap: 0.65rem;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 0.1rem;
          align-content: start;
        }
        .darkfinder-random-loot-card {
          display: grid;
          gap: 0.35rem;
          padding: 0.75rem 0.8rem;
          border: 1px solid rgba(149, 130, 95, 0.95);
          border-radius: 14px;
          background:
            linear-gradient(180deg, rgba(238, 230, 211, 0.98) 0%, rgba(220, 208, 183, 0.98) 100%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.5),
            0 5px 12px rgba(0,0,0,0.12);
        }
        .darkfinder-random-loot-card-header {
          display: block;
        }
        .darkfinder-random-loot-card-title {
          font-size: 0.94rem;
          font-weight: 850;
          color: #2b2218;
        }
        .darkfinder-random-loot-stepper-row {
          display: grid;
          grid-template-columns: 2.45rem minmax(0, 1fr) 2.45rem;
          align-items: center;
          gap: 0.4rem;
        }
        .darkfinder-random-loot-stepper {
          min-width: 0;
          min-height: 2.15rem;
          border: 1px solid #8f8673;
          border-radius: 10px;
          background: linear-gradient(180deg, #eee6d5 0%, #d4c5a5 100%);
          color: #2a2218;
          font-size: 1.2rem;
          font-weight: 900;
          cursor: pointer;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
          transition: transform 120ms ease, border-color 120ms ease, filter 120ms ease;
        }
        .darkfinder-random-loot-stepper:hover:not(:disabled) {
          border-color: #6f644f;
          filter: brightness(1.03);
        }
        .darkfinder-random-loot-stepper:active:not(:disabled) {
          transform: translateY(1px);
        }
        .darkfinder-random-loot-stepper:disabled,
        .darkfinder-random-loot-input:disabled,
        .darkfinder-random-loot-button:disabled {
          opacity: 0.65;
          cursor: wait;
        }
        .darkfinder-random-loot-input {
          width: 100%;
          min-height: 2.2rem;
          padding: 0.15rem 0.45rem;
          border: 1px solid #877960;
          border-radius: 10px;
          background: rgba(255,255,255,0.78);
          color: #1e1a14;
          font-size: 1.05rem;
          font-weight: 800;
          text-align: center;
          box-sizing: border-box;
        }
        .darkfinder-random-loot-input:focus {
          outline: none;
          border-color: #5f7346;
          box-shadow: 0 0 0 2px rgba(95,115,70,0.18);
        }
        .darkfinder-random-loot-summary {
          gap: 0.65rem;
        }
        .darkfinder-random-loot-summary-label {
          font-size: 0.82rem;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #746554;
          text-align: center;
        }
        .darkfinder-random-loot-budget {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          align-items: start;
          gap: 0.75rem;
        }
        .darkfinder-random-loot-budget-total {
          font-size: 1.8rem;
          font-weight: 900;
          letter-spacing: 0.02em;
          color: #4d6632;
          text-shadow: 0 1px 0 rgba(255,255,255,0.45);
          cursor: help;
          justify-self: center;
          text-align: center;
        }
        .darkfinder-random-loot-budget-side {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.7rem;
          text-align: center;
          width: 100%;
        }
        .darkfinder-random-loot-budget-side-group {
          display: grid;
          grid-template-rows: 2.2rem auto;
          gap: 0.18rem;
          align-content: start;
          justify-items: center;
        }
        .darkfinder-random-loot-budget-side-value {
          font-size: 0.95rem;
          font-weight: 800;
          color: #4c4337;
        }
        .darkfinder-random-loot-party-wealth-delta {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          line-height: 1.15;
        }
        .darkfinder-random-loot-party-wealth-delta-gp {
          font-size: 0.95rem;
          font-weight: 850;
          color: #4c4337;
          white-space: nowrap;
        }
        .darkfinder-random-loot-party-wealth-delta-percent {
          font-size: 0.82rem;
          font-weight: 750;
          color: #6a6051;
          white-space: nowrap;
        }
        .darkfinder-random-loot-budget-side-help {
          font-size: 0.82rem;
          color: #6a6051;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          justify-content: center;
          text-align: center;
          line-height: 1.15;
        }
        .darkfinder-random-loot-budget-side-help span {
          display: block;
          width: 100%;
        }
        .darkfinder-random-loot-actions {
          flex: 0 0 auto;
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
        }
        .darkfinder-random-loot-results-actions {
          flex: 0 0 auto;
          display: flex;
          justify-content: center;
          gap: 0.6rem;
        }
        .darkfinder-random-loot-button {
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
        .darkfinder-random-loot-button:hover:not(:disabled) {
          border-color: #6f644f;
          filter: brightness(1.02);
        }
        .darkfinder-random-loot-button:active:not(:disabled) {
          transform: translateY(1px);
        }
        .darkfinder-random-loot-button-primary {
          border-color: #5f7346;
          background: linear-gradient(180deg, #dce6c8 0%, #bccd9c 100%);
        }
        .darkfinder-random-loot-results-actions .darkfinder-random-loot-button {
          width: 50%;
          max-width: 14rem;
        }
        .darkfinder-random-loot-results-shell {
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
          flex: 1 1 auto;
          min-height: 0;
          height: 100%;
          overflow: hidden;
        }
        .darkfinder-random-loot-results-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
        }
        .darkfinder-random-loot-results-title {
          font-size: 1.12rem;
          font-weight: 900;
          color: #5f3a2f;
        }
        .darkfinder-random-loot-results-meta {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
          color: #5f5548;
          font-size: 0.86rem;
          font-weight: 700;
        }
        .darkfinder-random-loot-results-status {
          display: none;
        }
        .darkfinder-random-loot-results-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 0.2rem;
        }
        .darkfinder-random-loot-results-empty {
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
        .darkfinder-random-loot-item-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: stretch;
          gap: 0.55rem;
          width: 100%;
        }
        .darkfinder-random-loot-item-body {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 0.9rem;
          width: 100%;
          min-height: 4.85rem;
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
        .darkfinder-random-loot-item-body:hover {
          border-color: #6f644f;
          transform: translateY(-1px);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.5),
            0 6px 12px rgba(0,0,0,0.12);
        }
        .darkfinder-random-loot-item-main {
          display: flex;
          align-items: center;
          gap: 0.9rem;
          min-width: 0;
          min-height: 2.8rem;
        }
        .darkfinder-random-loot-item-icon {
          width: 2.65rem;
          height: 2.65rem;
          flex: 0 0 2.65rem;
          border-radius: 7px;
          object-fit: cover;
          border: 1px solid rgba(105, 89, 64, 0.35);
          background: rgba(255,255,255,0.7);
        }
        .darkfinder-random-loot-item-name {
          min-width: 0;
          font-weight: 800;
          font-size: 1rem;
          color: #2b2218;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .darkfinder-random-loot-item-price {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          text-align: right;
          font-weight: 900;
          color: #4d6632;
          white-space: nowrap;
          min-width: 6.5rem;
        }
        .darkfinder-random-loot-item-actions {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          flex: 0 0 auto;
        }
        .darkfinder-random-loot-item-actions-left {
          display: grid;
          grid-template-columns: repeat(2, 2.5rem);
          justify-content: flex-start;
          align-content: center;
          min-width: 5.35rem;
          min-height: 4.25rem;
        }
        .darkfinder-random-loot-item-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.5rem;
          height: 2.5rem;
          padding: 0;
          border: 1px solid rgba(105, 89, 64, 0.45);
          border-radius: 6px;
          background: linear-gradient(180deg, rgba(248,244,233,0.98) 0%, rgba(223,214,194,0.98) 100%);
          cursor: pointer;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.5);
          transition: transform 120ms ease, filter 120ms ease, border-color 120ms ease;
          flex: 0 0 2.5rem;
          overflow: hidden;
        }
        .darkfinder-random-loot-item-action:hover {
          transform: translateY(-1px);
          filter: brightness(1.03);
        }
        .darkfinder-random-loot-item-action img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          pointer-events: none;
        }
        .darkfinder-random-loot-item-action-reroll {
          border-color: rgba(63, 88, 43, 0.88);
          background: linear-gradient(180deg, rgba(113,146,81,0.98) 0%, rgba(73,104,49,0.98) 100%);
        }
        .darkfinder-random-loot-item-action-remove {
          border-color: rgba(122, 30, 30, 0.9);
          background: linear-gradient(180deg, rgba(185,72,72,0.98) 0%, rgba(126,36,36,0.98) 100%);
        }
        .darkfinder-random-loot-tooltip {
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
        .darkfinder-random-loot-tooltip.is-visible {
          opacity: 1;
          transform: translateY(0);
          visibility: visible;
        }
        .darkfinder-random-loot-tooltip-title {
          font-size: 1rem;
          font-weight: 900;
          color: #503225;
        }
        .darkfinder-random-loot-tooltip-price {
          margin-top: 0.2rem;
          font-size: 0.88rem;
          font-weight: 800;
          color: #4d6632;
        }
        .darkfinder-random-loot-tooltip-meta {
          margin-top: 0.2rem;
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: #746554;
        }
        .darkfinder-random-loot-tooltip-description {
          margin-top: 0.55rem;
          color: #4f463b;
          font-size: 0.82rem;
          line-height: 1.4;
          white-space: normal;
        }
        .darkfinder-random-loot-tooltip-description > :first-child {
          margin-top: 0;
        }
        .darkfinder-random-loot-tooltip-description > :last-child {
          margin-bottom: 0;
        }
        .darkfinder-random-loot-dialog .dialog-buttons {
          display: none !important;
        }
      </style>
      <div class="darkfinder-random-loot">
        <div class="darkfinder-random-loot-controls">
          <div class="darkfinder-random-loot-intro">
            <div class="darkfinder-random-loot-kicker">Darkfinder GM Tool</div>
            <div class="darkfinder-random-loot-title">Random Loot Budget Builder</div>
            <p class="darkfinder-random-loot-help">Tune the treasure budget, then generate a randomized item list from the target compendiums.</p>
            <div class="darkfinder-random-loot-source">Wealth source: <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${sourceLabel}</a>${levelOneNote ? ` | ${escapeHtml(levelOneNote)}` : ""}</div>
          </div>
          <div class="darkfinder-random-loot-settings">
            ${buildSettingCard({
              field: "partyLevel",
              title: "Party Level",
              value: state.partyLevel,
              step: 1,
            })}
            ${buildSettingCard({
              field: "percentOfWbl",
              title: "% of Next WBL",
              value: state.percentOfWbl,
              step: 5,
            })}
            ${buildSettingCard({
              field: "characterCount",
              title: "# of Characters",
              value: state.characterCount,
              step: 1,
            })}
            ${buildSettingCard({
              field: "maxItems",
              title: "Max # of Items",
              value: state.maxItems,
              step: 1,
            })}
          </div>
          <div class="darkfinder-random-loot-summary">
            <div class="darkfinder-random-loot-summary-label">Treasure Budget</div>
            <div class="darkfinder-random-loot-budget">
              <div
                class="darkfinder-random-loot-budget-total"
                data-value="budget-total"
                title="0 x 0 x 0%"
              >0 gp</div>
              <div class="darkfinder-random-loot-budget-side">
                <div class="darkfinder-random-loot-budget-side-group">
                  <div class="darkfinder-random-loot-budget-side-help"><span>Party vs</span><span>next WBL</span></div>
                  <div class="darkfinder-random-loot-budget-side-value" data-value="party-vs-next-wbl">${buildPartyWealthDeltaHtml(0, 0)}</div>
                </div>
                <div class="darkfinder-random-loot-budget-side-group">
                  <div class="darkfinder-random-loot-budget-side-help"><span>Share per</span><span>player</span></div>
                  <div class="darkfinder-random-loot-budget-side-value" data-value="per-player-share">0 gp</div>
                </div>
                <div class="darkfinder-random-loot-budget-side-group">
                  <div class="darkfinder-random-loot-budget-side-help"><span>Max item</span><span>value</span></div>
                  <div class="darkfinder-random-loot-budget-side-value" data-value="max-item-value">0 gp</div>
                </div>
              </div>
            </div>
          </div>
          <div class="darkfinder-random-loot-actions">
            <button type="button" class="darkfinder-random-loot-button" data-action="cancel">Cancel</button>
            <button type="button" class="darkfinder-random-loot-button" data-action="open-wealth-audit">Wealth Audit</button>
            <button type="button" class="darkfinder-random-loot-button darkfinder-random-loot-button-primary" data-action="generate">Generate</button>
          </div>
        </div>
        <div class="darkfinder-random-loot-results">
          <div class="darkfinder-random-loot-results-shell">
            <div class="darkfinder-random-loot-results-header">
              <div class="darkfinder-random-loot-results-title">Generated Items</div>
              <div class="darkfinder-random-loot-results-meta">
                <span>Total: <span data-value="results-total">0 gp</span></span>
                <span>Items: <span data-value="results-count">0</span></span>
              </div>
            </div>
            <div class="darkfinder-random-loot-results-status" data-value="results-status"></div>
            <div class="darkfinder-random-loot-results-list" data-value="results-list">
              <div class="darkfinder-random-loot-results-empty">No generated items yet.</div>
            </div>
          </div>
          <div class="darkfinder-random-loot-results-actions">
            <button type="button" class="darkfinder-random-loot-button" data-action="send-to-players" disabled>Send to Players</button>
          </div>
        </div>
        <div class="darkfinder-random-loot-tooltip" data-role="item-tooltip"></div>
      </div>
    `;
  }

  function buildSettingCard({ field, title, value, step }) {
    return `
      <div class="darkfinder-random-loot-card">
        <div class="darkfinder-random-loot-card-header">
          <div class="darkfinder-random-loot-card-title">${escapeHtml(title)}</div>
        </div>
        <div class="darkfinder-random-loot-stepper-row">
          <button
            type="button"
            class="darkfinder-random-loot-stepper"
            data-field="${escapeHtml(field)}"
            data-delta="${escapeHtml(String(-Math.abs(step)))}"
            aria-label="Decrease ${escapeHtml(title)}"
          >-</button>
          <input
            type="text"
            class="darkfinder-random-loot-input"
            inputmode="numeric"
            data-field="${escapeHtml(field)}"
            value="${escapeHtml(String(value))}"
            aria-label="${escapeHtml(title)}"
          />
          <button
            type="button"
            class="darkfinder-random-loot-stepper"
            data-field="${escapeHtml(field)}"
            data-delta="${escapeHtml(String(Math.abs(step)))}"
            aria-label="Increase ${escapeHtml(title)}"
          >+</button>
        </div>
      </div>
    `;
  }

  function buildPlayerDialogContent(state, options = {}) {
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
          grid-template-columns: 3.75rem minmax(0, 1fr);
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
        .darkfinder-random-loot-results-actions .darkfinder-random-loot-button,
        .darkfinder-random-loot-player .darkfinder-random-loot-actions .darkfinder-random-loot-button {
          width: 50%;
          max-width: 14rem;
        }
        .darkfinder-random-loot-player .darkfinder-random-loot-button:hover:not(:disabled) {
          border-color: #6f644f;
          filter: brightness(1.02);
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
          min-height: 4.85rem;
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
          gap: 0.9rem;
          min-width: 0;
          min-height: 2.8rem;
        }
        .darkfinder-random-loot-player .darkfinder-random-loot-item-icon {
          width: 2.65rem;
          height: 2.65rem;
          flex: 0 0 2.65rem;
          border-radius: 7px;
          object-fit: cover;
          border: 1px solid rgba(105, 89, 64, 0.35);
          background: rgba(255,255,255,0.7);
        }
        .darkfinder-random-loot-player .darkfinder-random-loot-item-name {
          min-width: 0;
          font-weight: 800;
          font-size: 1rem;
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
          gap: 0.35rem;
          flex: 0 0 auto;
        }
        .darkfinder-random-loot-player .darkfinder-random-loot-player-item-actions-left {
          display: flex;
          justify-content: center;
          align-items: center;
          min-width: 3.75rem;
          min-height: 4.25rem;
        }
        .darkfinder-random-loot-player .darkfinder-random-loot-player-item-checkbox {
          width: 1.55rem;
          height: 1.55rem;
          margin: 0;
          accent-color: #5f7346;
          cursor: pointer;
        }
        .darkfinder-random-loot-player .darkfinder-random-loot-player-item-checkbox:hover {
          filter: brightness(1.05);
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
            <div class="darkfinder-random-loot-results-title">${escapeHtml(options.title || "Party Loot")}</div>
            <div class="darkfinder-random-loot-results-meta">
              <span>Total: <span data-value="player-results-total">${formatGold(sumItemPrices(state.items))} gp</span></span>
              <span>Items: <span data-value="player-results-count">${String((state.items || []).length)}</span></span>
            </div>
          </div>
          <div class="darkfinder-random-loot-player-list-header" aria-hidden="true">
            <div class="darkfinder-random-loot-player-list-header-claim">Claim?</div>
            <div class="darkfinder-random-loot-player-list-header-item"></div>
          </div>
          <div class="darkfinder-random-loot-results-list" data-value="player-results-list">
            ${buildPlayerGeneratedItemsHtml(state.items)}
          </div>
        </div>
        <div class="darkfinder-random-loot-actions">
          <button type="button" class="darkfinder-random-loot-button darkfinder-random-loot-button-primary" data-action="submit-player-loot">Done</button>
        </div>
        <div class="darkfinder-random-loot-tooltip" data-role="item-tooltip"></div>
      </div>
    `;
  }

  function getLoggedInPlayers() {
    return (game.users?.contents || []).filter((user) => user.active && !user.isGM);
  }

  function getRegisteredNonGmPlayers() {
    return (game.users?.contents || []).filter((user) => !user.isGM);
  }

  function getAssignedNonGmPlayers() {
    return getRegisteredNonGmPlayers().filter((user) => !!user.character);
  }

  function getPreferredPartyLevelPlayers() {
    const activeNonGmPlayers = getLoggedInPlayers();
    const assignedActivePlayers = activeNonGmPlayers.filter((user) => !!user.character);
    if (assignedActivePlayers.length) return assignedActivePlayers;

    const allAssignedNonGmPlayers = getAssignedNonGmPlayers();
    if (allAssignedNonGmPlayers.length) return allAssignedNonGmPlayers;

    return [];
  }

  function getPartyWealthPlayers() {
    const assignedNonGmPlayers = getAssignedNonGmPlayers();
    if (assignedNonGmPlayers.length) return assignedNonGmPlayers;

    return getPreferredPartyLevelPlayers();
  }

  function calculateAveragePartyLevel(players) {
    const levels = (players || [])
      .map((user) => resolveActorLevel(user.character))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (!levels.length) return 1;
    return Math.max(1, Math.round(levels.reduce((sum, value) => sum + value, 0) / levels.length));
  }

  function resolveActorLevel(actor) {
    if (!actor) return 1;

    const directPaths = [
      foundry.utils.getProperty(actor, "system.attributes.hd.total"),
      foundry.utils.getProperty(actor, "system.attributes.hd.value"),
      foundry.utils.getProperty(actor, "system.attributes.hd"),
      foundry.utils.getProperty(actor, "system.details.level.value"),
      foundry.utils.getProperty(actor, "system.details.level.total"),
    ];

    for (const value of directPaths) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
    }

    const classLevels = (actor.items || [])
      .filter((item) => item.type === "class")
      .reduce((sum, cls) => sum + getClassLevel(cls), 0);

    if (classLevels > 0) return Math.floor(classLevels);
    return 1;
  }

  function getClassLevel(cls) {
    return (
      Number(cls.system?.levels) ||
      Number(cls.system?.level) ||
      Number(cls.system?.classLevel) ||
      Number(cls.system?.data?.levels) ||
      0
    );
  }

  function resolveLootCompendiumPacks() {
    const matchedPacks = [];
    const seenCollections = new Set();

    for (const targetName of TARGET_PACK_NAMES) {
      const pack = findCompendiumPackByPath(targetName);
      if (!pack) continue;
      const collection = String(pack.collection || "");
      if (!collection || seenCollections.has(collection)) continue;
      seenCollections.add(collection);
      matchedPacks.push(pack);
    }

    return matchedPacks;
  }

  function findCompendiumPackByPath(targetPath) {
    const normalizedTarget = normalizeText(targetPath);
    return Array.from(game.packs || []).find((pack) => {
      const folderName = normalizeText(getCompendiumFolderName(pack));
      const label = normalizeText(pack.metadata?.label || pack.title || pack.collection || "");
      const combined = [folderName, label].filter(Boolean).join("/");
      return combined === normalizedTarget;
    }) || null;
  }

  function getCompendiumFolderName(pack) {
    return pack?.folder?.name || pack?.metadata?.folder || pack?.folderName || "";
  }

  async function loadLootCandidates(packs, maxSingleItemValue) {
    const [permanentCandidates, consumableCandidates] = await Promise.all([
      loadAllLootCandidates(packs),
      loadConsumableLootCandidates(maxSingleItemValue),
    ]);

    return [...permanentCandidates, ...consumableCandidates]
      .filter((candidate) => candidate.price <= maxSingleItemValue)
      .sort((left, right) => left.price - right.price);
  }

  function startLootPreload(packs) {
    if (packs?.length) {
      loadAllLootCandidates(packs).catch((error) => {
        console.warn("Random Loot Generator preload failed.", error);
      });
    }
    loadAllSpellDocuments().catch((error) => {
      console.warn("Random Loot Generator spell preload failed.", error);
    });
  }

  async function loadAllLootCandidates(packs) {
    const cache = getLootCache();
    const cacheKey = packs
      .map((pack) => String(pack.collection || ""))
      .filter(Boolean)
      .sort()
      .join("|");
    const versionedCacheKey = `${LOOT_CACHE_VERSION}|${cacheKey}`;

    if (cache.candidatesByKey.has(versionedCacheKey)) {
      return cache.candidatesByKey.get(versionedCacheKey);
    }

    if (cache.promisesByKey.has(versionedCacheKey)) {
      return cache.promisesByKey.get(versionedCacheKey);
    }

    const pendingLoad = Promise.all(
      packs.map(async (pack) => {
        const documents = await pack.getDocuments();
        return documents.map((document) => {
          const price = extractItemPrice(document);
          if (!Number.isFinite(price) || price <= 0) return null;

          return {
            id: String(document.id || ""),
            uuid: String(document.uuid || ""),
            sourceUuid: String(document.uuid || ""),
            name: String(document.name || "Unnamed Item"),
            img: document.img || "icons/svg/dice-target.svg",
            price,
            description: extractItemDescription(document),
            typeLabel: extractItemTypeOrSlot(document),
            packCollection: String(pack.collection || ""),
            sourceType: "permanent",
            generationSource: null,
          };
        }).filter(Boolean);
      })
    ).then((results) => {
      const flattened = results.flat();
      cache.candidatesByKey.set(versionedCacheKey, flattened);
      cache.promisesByKey.delete(versionedCacheKey);
      return flattened;
    }).catch((error) => {
      cache.promisesByKey.delete(versionedCacheKey);
      throw error;
    });

    cache.promisesByKey.set(versionedCacheKey, pendingLoad);
    return pendingLoad;
  }

  async function loadConsumableLootCandidates(maxSingleItemValue) {
    const cache = getLootCache();
    const versionedCacheKey = `${LOOT_CACHE_VERSION}|consumables|cap:${Math.max(0, Math.floor(maxSingleItemValue || 0))}`;

    if (cache.consumableCandidatesByKey.has(versionedCacheKey)) {
      return cache.consumableCandidatesByKey.get(versionedCacheKey);
    }

    if (cache.consumablePromisesByKey.has(versionedCacheKey)) {
      return cache.consumablePromisesByKey.get(versionedCacheKey);
    }

    const pendingLoad = buildConsumableLootCandidates(maxSingleItemValue).then((candidates) => {
      cache.consumableCandidatesByKey.set(versionedCacheKey, candidates);
      cache.consumablePromisesByKey.delete(versionedCacheKey);
      return candidates;
    }).catch((error) => {
      cache.consumablePromisesByKey.delete(versionedCacheKey);
      throw error;
    });

    cache.consumablePromisesByKey.set(versionedCacheKey, pendingLoad);
    return pendingLoad;
  }

  async function buildConsumableLootCandidates(maxSingleItemValue) {
    const spells = await loadAllSpellDocuments();
    if (!spells.length) return [];

    const modelTarget = resolveSpellConsumableModelTarget(spells[0]);
    if (!modelTarget) {
      console.warn("Random Loot Generator could not resolve the PF1 consumable conversion helper.");
      return [];
    }

    const candidateSpecs = [];

    for (const spell of spells) {
      const spellData = spell?.toObject?.() || spell;
      const [spellLevel, casterLevel] = getSpellMinimumLevelAndCasterLevel(modelTarget, spellData);
      if (!(spellLevel >= 0) || !(casterLevel > 0)) continue;

      const spellType = resolveConsumableSpellType(spellData);
      const healing = isHealingSpell(spellData);

      if (spellLevel <= 3 && isPotionEligibleSpell(spellData, spellLevel)) {
        const potionPrice = getConsumablePriceFromModel(modelTarget, spellData, "potion", {
          sl: spellLevel,
          cl: casterLevel,
        });
        if (Number.isFinite(potionPrice) && potionPrice > 0 && potionPrice <= maxSingleItemValue) {
          candidateSpecs.push({
            spell,
            spellLevel,
            casterLevel,
            spellType,
            consumableType: "potion",
            uses: 1,
            healing,
          });
        }
      }

      const scrollPrice = getConsumablePriceFromModel(modelTarget, spellData, "scroll", {
        sl: spellLevel,
        cl: casterLevel,
      });
      if (Number.isFinite(scrollPrice) && scrollPrice > 0 && scrollPrice <= maxSingleItemValue) {
        candidateSpecs.push({
          spell,
          spellLevel,
          casterLevel,
          spellType,
          consumableType: "scroll",
          uses: 1,
          healing,
        });
      }

      if (spellLevel <= 4) {
        for (const uses of CONSUMABLE_WAND_CHARGE_OPTIONS) {
          const wandPrice = getConsumablePriceFromModel(modelTarget, spellData, "wand", {
            sl: spellLevel,
            cl: casterLevel,
            uses,
          });
          if (!Number.isFinite(wandPrice) || wandPrice <= 0 || wandPrice > maxSingleItemValue) continue;
          candidateSpecs.push({
            spell,
            spellLevel,
            casterLevel,
            spellType,
            consumableType: "wand",
            uses,
            healing,
          });
        }
      }
    }

    const results = await Promise.all(candidateSpecs.map((spec) => createConsumableCandidateFromSpec(modelTarget, spec)));
    return results.filter(Boolean).sort((left, right) => left.price - right.price);
  }

  async function createConsumableCandidateFromSpec(modelTarget, spec) {
    const spell = spec?.spell;
    if (!spell) return null;

    const itemData = await modelTarget.toConsumable.call(modelTarget.owner, spell, spec.consumableType, {
      spellType: spec.spellType,
      sl: spec.spellLevel,
      cl: spec.casterLevel,
      uses: spec.uses,
      identified: true,
    });
    if (!itemData) return null;

    const price = extractItemPrice(itemData);
    if (!Number.isFinite(price) || price <= 0) return null;

    const spellUuid = String(spell?.uuid || "").trim();
    const uses = spec.consumableType === "wand" ? Math.max(1, Number(spec.uses) || 50) : 1;

    return {
      id: buildSyntheticLootItemId(spec.consumableType, spellUuid, spec.spellLevel, spec.casterLevel, uses),
      uuid: buildSyntheticLootItemUuid(spec.consumableType, spellUuid, spec.spellLevel, spec.casterLevel, uses),
      sourceUuid: spellUuid,
      sourceType: spec.consumableType,
      name: String(itemData.name || `${toTitleCase(spec.consumableType)} of ${spell.name || "Spell"}`),
      img: itemData.img || "icons/svg/dice-target.svg",
      price,
      description: extractItemDescription(itemData),
      typeLabel: buildConsumableTypeLabel(spec.consumableType, uses),
      quantity: 1,
      isHealing: !!spec.healing,
      generationSource: {
        kind: "spell-consumable",
        spellUuid,
        consumableType: spec.consumableType,
        spellLevel: spec.spellLevel,
        casterLevel: spec.casterLevel,
        uses,
        spellType: spec.spellType,
        identified: true,
      },
    };
  }

  async function loadAllSpellDocuments() {
    const cache = getLootCache();
    const cacheKey = `${LOOT_CACHE_VERSION}|all-spells`;

    if (cache.spellDocumentsByKey.has(cacheKey)) {
      return cache.spellDocumentsByKey.get(cacheKey);
    }

    if (cache.spellPromisesByKey.has(cacheKey)) {
      return cache.spellPromisesByKey.get(cacheKey);
    }

    const pendingLoad = (async () => {
      const worldSpells = (game.items?.contents || []).filter((item) => item?.type === "spell");
      const spellPacks = resolveSpellCompendiumPacks();
      const packResults = await Promise.all(spellPacks.map(async (pack) => {
        const documents = await pack.getDocuments();
        return documents.filter((document) => document?.type === "spell");
      }));

      const deduped = new Map();
      for (const spell of [...worldSpells, ...packResults.flat()]) {
        const key = String(spell?.uuid || "").trim();
        if (!key || deduped.has(key)) continue;
        deduped.set(key, spell);
      }

      const result = Array.from(deduped.values());
      cache.spellDocumentsByKey.set(cacheKey, result);
      cache.spellPromisesByKey.delete(cacheKey);
      return result;
    })().catch((error) => {
      cache.spellPromisesByKey.delete(cacheKey);
      throw error;
    });

    cache.spellPromisesByKey.set(cacheKey, pendingLoad);
    return pendingLoad;
  }

  function resolveSpellCompendiumPacks() {
    const matchedPacks = [];
    const seenCollections = new Set();

    const directPack = game.packs?.get("pf1.spells");
    if (directPack?.collection) {
      matchedPacks.push(directPack);
      seenCollections.add(String(directPack.collection));
    }

    for (const pack of Array.from(game.packs || [])) {
      if (String(pack?.documentName || "").trim() !== "Item") continue;

      const collection = String(pack.collection || "").trim();
      if (!collection || seenCollections.has(collection)) continue;

      const normalizedCollection = normalizeText(collection);
      const normalizedLabel = normalizeText(pack.metadata?.label || pack.title || "");
      if (!normalizedCollection.includes("spell") && !normalizedLabel.includes("spell")) continue;

      seenCollections.add(collection);
      matchedPacks.push(pack);
    }

    return matchedPacks;
  }

  function getLootCache() {
    if (!globalThis[LOOT_CACHE_KEY]) {
      globalThis[LOOT_CACHE_KEY] = {
        candidatesByKey: new Map(),
        promisesByKey: new Map(),
        consumableCandidatesByKey: new Map(),
        consumablePromisesByKey: new Map(),
        spellDocumentsByKey: new Map(),
        spellPromisesByKey: new Map(),
      };
    }
    return globalThis[LOOT_CACHE_KEY];
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

  function extractItemDescription(document) {
    const candidatePaths = [
      foundry.utils.getProperty(document, "system.description.identified"),
      foundry.utils.getProperty(document, "system.identifiedDescription.value"),
      foundry.utils.getProperty(document, "system.identified.description.value"),
      foundry.utils.getProperty(document, "system.identified.description"),
      foundry.utils.getProperty(document, "system.identifiedDescription"),
      foundry.utils.getProperty(document, "system.identified.properties.value"),
      foundry.utils.getProperty(document, "system.identified.properties"),
      foundry.utils.getProperty(document, "system.identifiedProperties"),
      foundry.utils.getProperty(document, "system.properties.identified"),
      foundry.utils.getProperty(document, "system.description.value"),
      foundry.utils.getProperty(document, "system.description"),
      foundry.utils.getProperty(document, "system.details.description"),
      foundry.utils.getProperty(document, "system.description.chat"),
      foundry.utils.getProperty(document, "data.description.value"),
      foundry.utils.getProperty(document, "description"),
    ];

    for (const candidate of candidatePaths) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
      if (Array.isArray(candidate)) {
        const joined = candidate
          .map((entry) => {
            if (typeof entry === "string") return entry.trim();
            if (entry && typeof entry === "object") {
              return String(entry.name || entry.label || entry.value || "").trim();
            }
            return "";
          })
          .filter(Boolean)
          .join(", ");
        if (joined) return joined;
      }
      if (candidate && typeof candidate === "object") {
        const objectText = [
          candidate.value,
          candidate.text,
          candidate.description,
          candidate.name,
          candidate.label,
        ].map((entry) => String(entry || "").trim()).filter(Boolean).join(" ");
        if (objectText) return objectText;
      }
    }

    return "";
  }

  function extractItemTypeOrSlot(document) {
    const typeCandidates = [
      foundry.utils.getProperty(document, "system.equipmentType"),
      foundry.utils.getProperty(document, "system.equipmentType.value"),
      foundry.utils.getProperty(document, "system.subType"),
      foundry.utils.getProperty(document, "system.subtype"),
      foundry.utils.getProperty(document, "system.type"),
      foundry.utils.getProperty(document, "system.type.value"),
      foundry.utils.getProperty(document, "system.equipmentType.name"),
      foundry.utils.getProperty(document, "system.weaponType"),
      foundry.utils.getProperty(document, "system.weaponSubtype"),
      foundry.utils.getProperty(document, "system.armor.type"),
      foundry.utils.getProperty(document, "system.armor.subtype"),
      foundry.utils.getProperty(document, "system.consumableType"),
      foundry.utils.getProperty(document, "system.itemType"),
      foundry.utils.getProperty(document, "type"),
    ];

    let typeLabel = getFirstTooltipMetaValue(typeCandidates, { includeSlotField: false });

    if (!typeLabel) {
      typeLabel = toTitleCase(String(document?.type || "Item"));
    }

    if (normalizeText(typeLabel) === "wondrous") {
      const slotCandidates = [
        foundry.utils.getProperty(document, "system.slot"),
        foundry.utils.getProperty(document, "system.slot.value"),
        foundry.utils.getProperty(document, "system.equipmentSlot"),
        foundry.utils.getProperty(document, "system.equipment.slot"),
        foundry.utils.getProperty(document, "system.identified.slot"),
      ];

      const slotLabel = getFirstTooltipMetaValue(slotCandidates, { includeSlotField: true });
      if (slotLabel) return slotLabel;
      if (containsSlotlessValue(slotCandidates)) return "Slotless";
    }

    return typeLabel;
  }

  function getFirstTooltipMetaValue(candidates, options = {}) {
    for (const candidate of candidates || []) {
      const label = normalizeTooltipMetaValue(candidate, options);
      if (label) return label;
    }
    return "";
  }

  function normalizeTooltipMetaValue(value, options = {}) {
    if (typeof value === "string") {
      const normalized = value
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!normalized) return "";

      const lowered = normalized.toLowerCase();
      const ignoredValues = new Set([
        "none",
        "n/a",
        "na",
        "null",
        "undefined",
        "other",
      ]);
      if (!options.includeSlotField) {
        ignoredValues.add("slotless");
      }
      if (ignoredValues.has(lowered)) return "";

      return toTitleCase(normalized);
    }

    if (Array.isArray(value)) {
      const combined = value.map((entry) => normalizeTooltipMetaValue(entry, options)).filter(Boolean).join(", ");
      return combined || "";
    }

    if (value && typeof value === "object") {
      const objectCandidates = options.includeSlotField
        ? [value.slot, value.value, value.label, value.name, value.type]
        : [value.label, value.name, value.value, value.type];
      for (const candidate of objectCandidates) {
        const normalized = normalizeTooltipMetaValue(candidate, options);
        if (normalized) return normalized;
      }
    }

    return "";
  }

  function containsSlotlessValue(values) {
    for (const value of values || []) {
      if (value == null) continue;

      if (typeof value === "string") {
        if (normalizeText(value).includes("slotless")) return true;
        continue;
      }

      if (Array.isArray(value)) {
        if (containsSlotlessValue(value)) return true;
        continue;
      }

      if (typeof value === "object") {
        const nestedValues = Object.values(value);
        if (containsSlotlessValue(nestedValues)) return true;
      }
    }

    return false;
  }

  function toTitleCase(value) {
    return String(value || "").replace(/\b([a-z])/g, (match) => match.toUpperCase());
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

  function chooseWeightedRandomCandidate(candidates, remainingBudget, options = {}) {
    const safeCandidates = (candidates || []).filter(Boolean);
    if (!safeCandidates.length) return null;

    const weightedEntries = safeCandidates.map((candidate) => {
      const delta = Math.abs((Number(remainingBudget) || 0) - candidate.price);
      const score = 1 / (1 + delta);
      const rarityPenalty = computeSingleItemCapRarityPenalty(candidate.price, options.maxSingleItemValue);
      const rerollCount = getRememberedRerollCount(options.rerolledItemCounts, candidate.uuid);
      const rerollPenalty = rerollCount > 0 ? Math.pow(0.15, rerollCount) : 1;
      const categoryWeight = getCandidateCategoryWeight(candidate);
      const repeatPenalty = getCandidateRepeatPenalty(candidate, options.selectedItems);
      return {
        candidate,
        weight: Math.max(score * rarityPenalty * rerollPenalty * categoryWeight * repeatPenalty, 0.0001),
      };
    });

    const totalWeight = weightedEntries.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const entry of weightedEntries) {
      roll -= entry.weight;
      if (roll <= 0) return entry.candidate;
    }

    return weightedEntries[weightedEntries.length - 1]?.candidate || null;
  }

  function computeSingleItemCapRarityPenalty(itemPrice, maxSingleItemValue) {
    const safeCap = Number(maxSingleItemValue) || 0;
    const safePrice = Math.max(0, Number(itemPrice) || 0);
    if (!(safeCap > 0) || safePrice <= 0) return 1;

    const ratio = clampNumber(safePrice / safeCap, 0, 1);
    return 1 / (1 + (ratio * CAP_RARITY_WEIGHT_STRENGTH));
  }

  function getCandidateCategoryWeight(candidate) {
    const sourceType = normalizeText(candidate?.sourceType || "permanent");
    let weight = Number(CONSUMABLE_CATEGORY_WEIGHTS[sourceType] || CONSUMABLE_CATEGORY_WEIGHTS.permanent || 1);

    if (candidate?.isHealing && Object.prototype.hasOwnProperty.call(HEALING_CATEGORY_WEIGHTS, sourceType)) {
      weight *= Number(HEALING_CATEGORY_WEIGHTS[sourceType] || 1);
    }

    if (sourceType === "wand") {
      const uses = Math.max(1, Number(candidate?.generationSource?.uses) || 50);
      weight *= 0.82 + (0.18 * Math.min(1, uses / 50));
    }

    return Math.max(weight, 0.0001);
  }

  function getCandidateRepeatPenalty(candidate, selectedItems = []) {
    if (!isSpellConsumableCandidate(candidate)) return 1;

    const consumableSelections = (selectedItems || []).filter((item) => isSpellConsumableCandidate(item));
    const sameTypeSelections = consumableSelections.filter((item) => normalizeText(item?.sourceType) === normalizeText(candidate?.sourceType));
    const sameSpellSelections = consumableSelections.filter((item) => {
      return String(item?.generationSource?.spellUuid || "") === String(candidate?.generationSource?.spellUuid || "");
    });

    return Math.pow(CONSUMABLE_REPEAT_DAMPING, consumableSelections.length)
      * Math.pow(SAME_CONSUMABLE_TYPE_DAMPING, sameTypeSelections.length)
      * Math.pow(SAME_CONSUMABLE_SPELL_DAMPING, sameSpellSelections.length);
  }

  function isSpellConsumableCandidate(candidate) {
    return String(candidate?.generationSource?.kind || "") === "spell-consumable";
  }

  function clampInteger(value, min, max) {
    const numeric = Math.floor(Number(value) || 0);
    return Math.min(max, Math.max(min, numeric));
  }

  function clampMinInteger(value, min) {
    const numeric = Math.floor(Number(value) || 0);
    return Math.max(min, numeric);
  }

  function clampNumber(value, min, max) {
    const numeric = Number(value) || 0;
    return Math.min(max, Math.max(min, numeric));
  }

  function formatGold(value) {
    return roundGold(value).toLocaleString("en-US");
  }

  function roundGold(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function formatSignedPercent(value) {
    if (!Number.isFinite(value)) return "N/A";
    const rounded = Math.round(value);
    if (rounded > 0) return `+${rounded}%`;
    if (rounded < 0) return `${rounded}%`;
    return "0%";
  }

  function formatSignedGold(value) {
    if (!Number.isFinite(value)) return "N/A";
    const rounded = Math.round(value);
    if (rounded > 0) return `+${formatGold(rounded)} gp`;
    if (rounded < 0) return `-${formatGold(Math.abs(rounded))} gp`;
    return "0 gp";
  }

  function buildPartyWealthDeltaHtml(goldValue, percentValue) {
    if (!Number.isFinite(goldValue) || !Number.isFinite(percentValue)) return "N/A";

    return `
      <span class="darkfinder-random-loot-party-wealth-delta">
        <span class="darkfinder-random-loot-party-wealth-delta-gp">${escapeHtml(formatSignedGold(goldValue))}</span>
        <span class="darkfinder-random-loot-party-wealth-delta-percent">${escapeHtml(formatSignedPercent(percentValue))}</span>
      </span>
    `;
  }

  function sumItemPrices(items) {
    return (items || []).reduce((sum, item) => sum + (Number(item?.price) || 0), 0);
  }

  function sortItemsByPriceDesc(items) {
    return [...(items || [])].sort((left, right) => {
      const priceDelta = (Number(right?.price) || 0) - (Number(left?.price) || 0);
      if (priceDelta !== 0) return priceDelta;
      return String(left?.name || "").localeCompare(String(right?.name || ""), undefined, { sensitivity: "base" });
    });
  }

  function rememberRerolledItem(state, itemUuid) {
    const normalizedUuid = String(itemUuid || "").trim();
    if (!normalizedUuid) return;

    if (!(state.rerolledItemCounts instanceof Map)) {
      state.rerolledItemCounts = new Map();
    }

    state.rerolledItemCounts.set(normalizedUuid, getRememberedRerollCount(state.rerolledItemCounts, normalizedUuid) + 1);
  }

  function getRememberedRerollCount(rerolledItemCounts, itemUuid) {
    if (!(rerolledItemCounts instanceof Map)) return 0;
    return Number(rerolledItemCounts.get(String(itemUuid || "").trim()) || 0);
  }

  function showItemTooltip(eventRoot, state, itemUuid, event) {
    const tooltip = eventRoot.find("[data-role='item-tooltip']").first();
    if (!tooltip.length) return;

    const items = Array.isArray(state?.generatedItems)
      ? state.generatedItems
      : Array.isArray(state?.items)
        ? state.items
        : [];
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
      .replace(/@Embed\[([^\]\s]+)[^\]]*\]/g, (match, referencePath) => {
        return escapeHtml(resolveTooltipReferenceLabel(`[${referencePath}]`));
      })
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
      console.warn("Random Loot Generator could not resolve tooltip reference synchronously.", error);
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

  function syncGenerationMetaFromItems(state) {
    state.generationMeta = {
      ...state.generationMeta,
      totalValue: sumItemPrices(state.generatedItems),
      count: state.generatedItems.length,
    };
  }

  async function resolveLootItemDocument(item) {
    const openUuid = getLootItemOpenUuid(item);
    if (!openUuid) return null;
    return fromUuid(openUuid);
  }

  function getLootItemOpenUuid(item) {
    if (!item || typeof item !== "object") return "";
    return String(item?.sourceUuid || item?.generationSource?.spellUuid || item?.uuid || "").trim();
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function cloneGenerationSource(source) {
    if (!source || typeof source !== "object") return null;
    return {
      kind: String(source.kind || ""),
      spellUuid: String(source.spellUuid || ""),
      consumableType: String(source.consumableType || ""),
      spellLevel: Number(source.spellLevel) || 0,
      casterLevel: Number(source.casterLevel) || 0,
      uses: Math.max(1, Number(source.uses) || 1),
      spellType: String(source.spellType || "arcane"),
      identified: source.identified !== false,
    };
  }

  function resolveSpellConsumableModelTarget(spellDocument) {
    const candidates = [
      globalThis.pf1?.models?.item?.SpellModel,
      spellDocument?.constructor,
      globalThis.ItemSpellPF,
    ];
    const owner = candidates.find((candidate) => typeof candidate?.toConsumable === "function");
    if (!owner) return null;
    return {
      owner,
      toConsumable: owner.toConsumable,
      getMinCLFromData: owner.getMinCLFromData || owner.getMinimumCasterLevelBySpellData,
      getConsumablePrice: owner.getConsumablePrice || owner.getSpellPrice,
    };
  }

  function getSpellMinimumLevelAndCasterLevel(modelTarget, spellData) {
    const result = modelTarget?.getMinCLFromData?.call(modelTarget.owner, spellData);
    if (Array.isArray(result) && result.length >= 2) {
      return [Number(result[0]) || 0, Number(result[1]) || 1];
    }
    if (result && typeof result === "object") {
      const spellLevel = Number(result.spellLevel ?? result.sl ?? result.level ?? result[0]);
      const casterLevel = Number(result.casterLevel ?? result.cl ?? result.minimumCasterLevel ?? result[1]);
      if (Number.isFinite(spellLevel) && Number.isFinite(casterLevel)) {
        return [spellLevel, Math.max(1, casterLevel)];
      }
    }

    const derived = deriveMinimumSpellLevelAndCasterLevelFromLearnedAt(spellData);
    if (derived) return derived;

    const fallbackLevel = Number(foundry.utils.getProperty(spellData, "system.level")) || 0;
    return [fallbackLevel, Math.max(1, (fallbackLevel * 2) - 1)];
  }

  function getConsumablePriceFromModel(modelTarget, spellData, consumableType, overrides = {}) {
    if (typeof modelTarget?.getConsumablePrice === "function") {
      const helperPrice = Number(modelTarget.getConsumablePrice.call(modelTarget.owner, spellData, consumableType, overrides));
      if (Number.isFinite(helperPrice) && helperPrice > 0) return helperPrice;
    }

    const spellLevel = Math.max(0.5, Number(overrides.sl) || 0);
    const casterLevel = Math.max(1, Number(overrides.cl) || 1);
    const uses = Math.max(1, Number(overrides.uses) || 50);
    const materialCost = Math.max(0, Number(foundry.utils.getProperty(spellData, "system.materials.gpValue")) || 0);

    let basePrice = NaN;
    if (consumableType === "potion") basePrice = spellLevel * casterLevel * 50;
    if (consumableType === "scroll") basePrice = spellLevel * casterLevel * 25;
    if (consumableType === "wand") basePrice = spellLevel * casterLevel * 750 * (uses / 50);
    if (!Number.isFinite(basePrice) || basePrice <= 0) return NaN;

    const totalMaterialCost = consumableType === "wand" ? materialCost * uses : materialCost;
    return roundGold(basePrice + totalMaterialCost);
  }

  function resolveConsumableSpellType(spellData) {
    const learnedAtClasses = Object.keys(foundry.utils.getProperty(spellData, "system.learnedAt.class") || {});
    const divineClassIds = new Set(["adept", "cleric", "druid", "hunter", "inquisitor", "oracle", "paladin", "ranger", "shaman", "warpriest"]);
    if (learnedAtClasses.some((classId) => divineClassIds.has(normalizeText(classId)))) {
      return "divine";
    }
    return "arcane";
  }

  function isPotionEligibleSpell(spellData, spellLevel) {
    if (!(Number(spellLevel) >= 0 && Number(spellLevel) <= 3)) return false;
    if (!hasPotionLegalCastingTime(spellData)) return false;
    if (!hasPotionLegalTarget(spellData)) return false;
    return true;
  }

  function hasPotionLegalCastingTime(spellData) {
    const defaultAction = getPrimarySpellAction(spellData);
    const activationType = normalizeText(defaultAction?.activation?.type);
    if (!activationType) return false;

    if (new Set(["free", "swift", "immediate", "move", "standard", "full", "attack", "aoo"]).has(activationType)) {
      return true;
    }

    if (activationType === "round") {
      const cost = Math.max(1, Number(defaultAction?.activation?.cost) || 1);
      return cost < 10;
    }

    return false;
  }

  function hasPotionLegalTarget(spellData) {
    const targetTexts = getSpellTargetTexts(spellData);
    if (!targetTexts.length) return false;

    const targetMatchers = ["creature", "creatures", "object", "objects"];
    const disallowedMatchers = ["personal", "area", "burst", "cone", "line", "emanation", "spread", "radius"];

    return targetTexts.some((targetText) => {
      if (disallowedMatchers.some((value) => targetText.includes(value))) return false;
      return targetMatchers.some((value) => targetText.includes(value));
    });
  }

  function getPrimarySpellAction(spellData) {
    const actions = Object.values(foundry.utils.getProperty(spellData, "system.actions") || {});
    return [...actions].sort((left, right) => (Number(left?.sort) || 0) - (Number(right?.sort) || 0))[0] || null;
  }

  function getSpellTargetTexts(spellData) {
    return Object.values(foundry.utils.getProperty(spellData, "system.actions") || {})
      .sort((left, right) => (Number(left?.sort) || 0) - (Number(right?.sort) || 0))
      .map((action) => normalizeText(action?.target?.value))
      .filter(Boolean);
  }

  function isHealingSpell(spellData) {
    if (normalizeText(foundry.utils.getProperty(spellData, "system.subschool")) === "healing") return true;

    const actions = Object.values(foundry.utils.getProperty(spellData, "system.actions") || {});
    if (actions.some((action) => normalizeText(action?.actionType) === "heal")) return true;

    const spellName = normalizeText(spellData?.name);
    return ["cure ", "mass cure", "heal", "healing", "restoration", "rejuvenat", "vigor"].some((term) => spellName.includes(term));
  }

  function buildSyntheticLootItemId(consumableType, spellUuid, spellLevel, casterLevel, uses) {
    return `${consumableType}:${spellLevel}:${casterLevel}:${uses}:${spellUuid}`;
  }

  function buildSyntheticLootItemUuid(consumableType, spellUuid, spellLevel, casterLevel, uses) {
    const spellKey = String(spellUuid || "").replace(/[^A-Za-z0-9._:-]+/g, "_");
    return `Synthetic.RandomLoot.${consumableType}.${spellLevel}.${casterLevel}.${uses}.${spellKey}`;
  }

  function buildConsumableTypeLabel(consumableType, uses) {
    if (consumableType === "wand") {
      return `Wand • ${Math.max(1, Number(uses) || 50)} Charges`;
    }
    return toTitleCase(consumableType);
  }

  function deriveMinimumSpellLevelAndCasterLevelFromLearnedAt(spellData) {
    const learnedAt = Object.entries(foundry.utils.getProperty(spellData, "system.learnedAt.class") || {});
    if (!learnedAt.length) return null;

    const pf1Config = globalThis.pf1?.config || CONFIG?.PF1 || {};
    const casterTypes = pf1Config.classCasterType || {};
    const progressionTables = pf1Config.casterProgression?.spellsPreparedPerDay?.prepared || {};

    let spellLevel = Infinity;
    let casterLevel = Infinity;

    for (const [classId, levelValue] of learnedAt) {
      const level = Number(levelValue);
      if (!Number.isFinite(level) || level < 0) continue;

      spellLevel = Math.min(spellLevel, level);

      const casterType = String(casterTypes[classId] || "high");
      const table = progressionTables[casterType];
      const tableCl = Array.isArray(table)
        ? table.findIndex((entry) => Array.isArray(entry) && entry.length === level + 1) + 1
        : 0;

      if (tableCl > 0) {
        casterLevel = Math.min(casterLevel, tableCl);
        continue;
      }

      const fallbackCl = computeFallbackCasterLevelFromSpellLevel(level, casterType);
      casterLevel = Math.min(casterLevel, fallbackCl);
    }

    if (!Number.isFinite(spellLevel) || !Number.isFinite(casterLevel)) return null;
    return [spellLevel, Math.max(1, casterLevel)];
  }

  function computeFallbackCasterLevelFromSpellLevel(spellLevel, casterType) {
    const safeLevel = Math.max(0, Number(spellLevel) || 0);
    if (casterType === "medium") return Math.max(1, (safeLevel * 3) - 1);
    if (casterType === "low") return Math.max(1, (safeLevel * 3));
    return Math.max(1, (safeLevel * 2) - 1);
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
