// PF1e — Auto re-roll initiative at the start of every round (Toggle, Option A)

// First, clear any old hook to prevent duplicates
if (window._pf1AutoInitHookId) {
  Hooks.off("updateCombat", window._pf1AutoInitHookId);
  window._pf1AutoInitHookId = null;
  ui.notifications.info("Auto re-roll initiative: OFF");
} else {
  // Register a single hook
  window._pf1AutoInitHookId = Hooks.on("updateCombat", async (combat, changed) => {
    if (changed.round !== undefined && changed.round > 0 && combat?.round === changed.round) {
      // Re-roll initiative for everyone once
      const ids = combat.combatants.map(c => c.id);
      await combat.rollInitiative(ids, { updateTurn: false, rerollInitiative: true, messageOptions: {} });

      // Ensure the tracker highlights the new top combatant
      await combat.update({ turn: 0 });

      ui.notifications.info(`Round ${combat.round}: initiatives re-rolled.`);
    }
  });
  ui.notifications.info("Auto re-roll initiative: ON (for this session)");
}