(async () => {
  if (!game.user?.isGM) {
    return ui.notifications.warn("Only a GM can run this macro.");
  }

  const players = getPreferredPartyLevelPlayers();
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

  const content = `
    <style>
      .darkfinder-wealth-audit {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        color: #241d14;
      }
      .darkfinder-wealth-audit-summary {
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
        max-height: 28rem;
        overflow-y: auto;
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
        <div><strong>Total party wealth:</strong> ${formatGold(totalPartyWealth)} gp</div>
        <div><strong>Average per character:</strong> ${formatGold(averagePartyWealth)} gp</div>
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

  new Dialog({
    title: "Party Wealth Audit",
    content,
    buttons: {
      close: {
        label: "Close",
      },
    },
    width: 720,
  }).render(true);

  ui.notifications.info("Party wealth audit opened. Detailed totals were also written to the browser console.");

  function getPreferredPartyLevelPlayers() {
    const allAssignedNonGmPlayers = (game.users?.contents || []).filter((user) => !user.isGM && !!user.character);
    if (allAssignedNonGmPlayers.length) return allAssignedNonGmPlayers;

    return (game.users?.contents || []).filter((user) => !user.isGM);
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

  function roundGold(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function formatGold(value) {
    return roundGold(value).toLocaleString("en-US");
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
