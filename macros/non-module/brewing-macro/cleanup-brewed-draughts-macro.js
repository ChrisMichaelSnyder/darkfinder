// Foundry VTT 13 macro for Pathfinder 1e brewed draft cleanup

(async () => {
  try {
    const FLAG_SCOPE = "pf1-brewing";
    const OWNER_LEVEL = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;

    function getObjectPath(object, path) {
      return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), object);
    }

    function isBrewedDraft(item) {
      return getObjectPath(item, ["flags", FLAG_SCOPE, "deleteOnLongRest"]) === true;
    }

    function getItemQuantity(item) {
      const candidates = [
        getObjectPath(item, ["system", "quantity"]),
        getObjectPath(item, ["quantity"]),
        getObjectPath(item, ["data", "quantity"]),
        getObjectPath(item, ["data", "data", "quantity"]),
      ];
      for (const candidate of candidates) {
        const numeric = Number(candidate);
        if (candidate != null && candidate !== "" && !Number.isNaN(numeric)) return numeric;
      }
      return 0;
    }

    function canEditActor(actor) {
      if (!actor) return false;
      if (actor.isOwner === true) return true;
      if (typeof actor.testUserPermission === "function") {
        return actor.testUserPermission(game.user, OWNER_LEVEL);
      }
      return false;
    }

    function buildLockedDraftReport(lockedActors) {
      const sections = lockedActors.map(({ actorName, drafts }) => `
        <div style="margin-bottom:0.9rem;">
          <div style="font-weight:700; margin-bottom:0.3rem;">${actorName}</div>
          <div style="padding-left:0.6rem;">
            ${drafts.map((draft) => `<div>${draft.name} x${draft.quantity}</div>`).join("")}
          </div>
        </div>
      `).join("");

      return `
        <div style="max-height:420px; overflow:auto; line-height:1.35;">
          <p style="margin-top:0;">These character sheets still have brewed drafts you cannot delete:</p>
          ${sections}
        </div>
      `;
    }

    console.log("Brewing cleanup macro started.");

    const actors = Array.from(game.actors?.contents ?? game.actors ?? []).filter((actor) => {
      if (!actor?.items?.size && !Array.isArray(actor?.items)) return false;
      return String(actor.type || "").toLowerCase() === "character";
    });

    let deletedCount = 0;
    let affectedActorCount = 0;
    const lockedActorsWithDrafts = [];

    for (const actor of actors) {
      const brewedDrafts = actor.items.filter((item) => isBrewedDraft(item));
      if (!brewedDrafts.length) continue;

      if (canEditActor(actor)) {
        const draftIds = brewedDrafts.map((item) => item.id).filter(Boolean);
        if (!draftIds.length) continue;

        console.log(`Brewing cleanup: deleting ${draftIds.length} draft(s) from ${actor.name}.`);
        await actor.deleteEmbeddedDocuments("Item", draftIds);
        deletedCount += draftIds.length;
        affectedActorCount += 1;
        continue;
      }

      const visibleDrafts = brewedDrafts
        .map((item) => ({
          name: String(item.name || "Unnamed Draft"),
          quantity: getItemQuantity(item),
        }))
        .filter((draft) => draft.quantity >= 1);

      if (!visibleDrafts.length) continue;

      lockedActorsWithDrafts.push({
        actorName: String(actor.name || "Unknown Character"),
        drafts: visibleDrafts,
      });
    }

    if (lockedActorsWithDrafts.length) {
      new Dialog({
        title: "Brewed Drafts Need Manual Cleanup",
        content: buildLockedDraftReport(lockedActorsWithDrafts),
        buttons: {
          ok: {
            label: "OK",
          },
        },
      }).render(true);
    }

    if (!deletedCount) {
      const lockedCount = lockedActorsWithDrafts.length;
      console.log("Brewing cleanup macro finished: no deletions performed.");
      ui.notifications.info(
        lockedCount
          ? `No brewed drafts were deleted. ${lockedCount} locked character sheet${lockedCount === 1 ? "" : "s"} still need manual cleanup.`
          : "No brewed drafts were found to clean up.",
      );
      return;
    }

    const lockedCount = lockedActorsWithDrafts.length;
    console.log(`Brewing cleanup macro finished: deleted ${deletedCount} draft(s) from ${affectedActorCount} actor(s).`);
    ui.notifications.info(
      `Deleted ${deletedCount} brewed draft${deletedCount === 1 ? "" : "s"} from ${affectedActorCount} character sheet${affectedActorCount === 1 ? "" : "s"}`
      + `${lockedCount ? `. ${lockedCount} locked sheet${lockedCount === 1 ? "" : "s"} still need manual cleanup.` : "."}`,
    );
  } catch (err) {
    console.error("Brewing cleanup macro failed.", err);
    ui.notifications.error(err?.message || "Brewing cleanup macro failed.");
  }
})();
