import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const sourcePath = path.join(
  repoRoot,
  "macros",
  "gm-macros",
  "random-loot-generator",
  "random-loot-generator.js"
);

const outputPath = path.join(
  repoRoot,
  "macros",
  "non-module",
  "random-loot-generator",
  "test-random-loot-weighting.js"
);

const marker = "  function bindDialogEvents(eventRoot, dialog, state, wealthByLevel, settle) {";

const testHarness = String.raw`
  const TEST_CONFIG = {
    runCount: 20,
    partyLevel: 5,
    percentOfWbl: 20,
    characterCount: 4,
    maxItems: 10,
    enabledLootTypes: {
      coinsGemsArt: true,
      potion: true,
      scroll: true,
      wand: true,
      armsArmor: true,
      wondrous: true,
    },
  };

  return runConsoleWeightingTest({
    state,
    wealthByLevel,
    config: TEST_CONFIG,
  });

  async function runConsoleWeightingTest({ state, wealthByLevel, config }) {
    const runCount = clampMinInteger(config.runCount || 20, 1);
    const testState = {
      ...state,
      partyLevel: clampMinInteger(config.partyLevel ?? state.partyLevel, 1),
      percentOfWbl: clampMinInteger(config.percentOfWbl ?? state.percentOfWbl, 0),
      characterCount: clampMinInteger(config.characterCount ?? state.characterCount, 1),
      maxItems: clampMinInteger(config.maxItems ?? state.maxItems, 1),
      enabledLootTypes: {
        ...buildDefaultEnabledLootTypes(),
        ...(config.enabledLootTypes || {}),
      },
      rerolledItemCounts: new Map(),
      generatedItems: [],
      generationStatus: "",
      generationMeta: {
        totalValue: 0,
        count: 0,
      },
      isGenerating: false,
      activeLootSessionId: "",
      lootSessionWatcherId: null,
      isClosingForLootSession: false,
    };

    const aggregate = {
      runs: runCount,
      withPotion: 0,
      withAnyConsumable: 0,
      categoryCounts: {
        coinsGemsArt: 0,
        potion: 0,
        scroll: 0,
        wand: 0,
        armsArmor: 0,
        wondrous: 0,
        other: 0,
      },
      totalItems: 0,
      totalValue: 0,
    };

    const runRows = [];

    console.group("Darkfinder Random Loot Weighting Test");
    console.log("Config", {
      runCount,
      partyLevel: testState.partyLevel,
      percentOfWbl: testState.percentOfWbl,
      characterCount: testState.characterCount,
      maxItems: testState.maxItems,
      enabledLootTypes: testState.enabledLootTypes,
    });

    for (let index = 0; index < runCount; index += 1) {
      const generated = await generateLootItems({
        ...testState,
        rerolledItemCounts: new Map(),
        generatedItems: [],
        generationMeta: { totalValue: 0, count: 0 },
      }, wealthByLevel);

      const items = sortItemsByPriceDesc(generated.items || []);
      const groupedCounts = {
        coinsGemsArt: 0,
        potion: 0,
        scroll: 0,
        wand: 0,
        armsArmor: 0,
        wondrous: 0,
        other: 0,
      };

      let hasPotion = false;
      let hasConsumable = false;

      for (const item of items) {
        const groupKey = getLootTypeGroupKey(item);
        groupedCounts[groupKey] = (groupedCounts[groupKey] || 0) + 1;
        aggregate.categoryCounts[groupKey] = (aggregate.categoryCounts[groupKey] || 0) + 1;
        if (groupKey === "potion") hasPotion = true;
        if (["potion", "scroll", "wand"].includes(groupKey)) hasConsumable = true;
      }

      if (hasPotion) aggregate.withPotion += 1;
      if (hasConsumable) aggregate.withAnyConsumable += 1;
      aggregate.totalItems += items.length;
      aggregate.totalValue += Number(generated.totalValue) || 0;

      const itemLines = items.map((item) => ({
        type: getLootTypeGroupLabel(getLootTypeGroupKey(item)),
        name: buildDisplayItemName(item),
        priceGp: roundGold(getItemTotalPrice(item)),
      }));

      const runRow = {
        run: index + 1,
        totalGp: roundGold(generated.totalValue),
        items: items.length,
        potions: groupedCounts.potion,
        scrolls: groupedCounts.scroll,
        wands: groupedCounts.wand,
        consumables: groupedCounts.potion + groupedCounts.scroll + groupedCounts.wand,
        armsArmor: groupedCounts.armsArmor,
        wondrous: groupedCounts.wondrous,
        currency: groupedCounts.coinsGemsArt,
        status: generated.status,
      };
      runRows.push(runRow);

      console.groupCollapsed("Run " + (index + 1) + ": " + runRow.totalGp + " gp, " + runRow.items + " items");
      console.table(itemLines);
      console.log("Category counts", groupedCounts);
      console.log("Status", generated.status);
      console.groupEnd();
    }

    const summary = {
      runs: aggregate.runs,
      avgItemsPerRun: roundGold(aggregate.totalItems / Math.max(1, aggregate.runs)),
      avgValuePerRun: roundGold(aggregate.totalValue / Math.max(1, aggregate.runs)),
      potionRunRatePercent: roundGold((aggregate.withPotion / Math.max(1, aggregate.runs)) * 100),
      consumableRunRatePercent: roundGold((aggregate.withAnyConsumable / Math.max(1, aggregate.runs)) * 100),
      avgPotionsPerRun: roundGold((aggregate.categoryCounts.potion || 0) / Math.max(1, aggregate.runs)),
      avgScrollsPerRun: roundGold((aggregate.categoryCounts.scroll || 0) / Math.max(1, aggregate.runs)),
      avgWandsPerRun: roundGold((aggregate.categoryCounts.wand || 0) / Math.max(1, aggregate.runs)),
      avgPermanentPerRun: roundGold(((aggregate.categoryCounts.armsArmor || 0) + (aggregate.categoryCounts.wondrous || 0)) / Math.max(1, aggregate.runs)),
      avgWondrousPerRun: roundGold((aggregate.categoryCounts.wondrous || 0) / Math.max(1, aggregate.runs)),
      avgArmsArmorPerRun: roundGold((aggregate.categoryCounts.armsArmor || 0) / Math.max(1, aggregate.runs)),
    };

    console.table(runRows);
    console.table([summary]);
    console.table([aggregate.categoryCounts]);
    console.groupEnd();

    ui.notifications.info("Random Loot weighting test finished. Check the browser console for " + runCount + " run(s).");

    return {
      summary,
      categoryCounts: aggregate.categoryCounts,
      runs: runRows,
    };
  }
`;

const source = await fs.readFile(sourcePath, "utf8");
const markerIndex = source.indexOf(marker);
if (markerIndex < 0) {
  throw new Error("Could not instrument the Random Loot Generator source.");
}

const generated = `// Generated by scripts/admin/build-random-loot-weighting-test.mjs
// Copy this file's contents into a Foundry macro to test the current local loot weighting.

${source.slice(0, markerIndex)}${testHarness}
${source.slice(markerIndex)}`;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, generated, "utf8");

console.log(JSON.stringify({
  sourcePath: path.relative(repoRoot, sourcePath),
  outputPath: path.relative(repoRoot, outputPath),
}, null, 2));
