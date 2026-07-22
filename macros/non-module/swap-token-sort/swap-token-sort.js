(async () => {
  let selectedTokens = canvas?.tokens?.controlled ?? [];

  if (selectedTokens.length !== 2) {
    const ownedTokens = (canvas?.tokens?.placeables ?? []).filter(
      (token) => token.document?.isOwner,
    );

    if (ownedTokens.length !== 2) {
      ui.notifications.warn("Exactly 2 tokens must be selected.");
      return;
    }

    ownedTokens[0].control({ releaseOthers: true });
    ownedTokens[1].control({ releaseOthers: false });
    selectedTokens = canvas?.tokens?.controlled ?? ownedTokens;
  }

  const tokenDocuments = selectedTokens.map((token) => token.document);
  const unauthorizedToken = tokenDocuments.find((token) => !token.isOwner);
  if (unauthorizedToken) {
    ui.notifications.warn("You must own both selected tokens.");
    return;
  }

  const [firstToken, secondToken] = tokenDocuments;
  const firstSort = Number(firstToken.sort ?? 0);
  const secondSort = Number(secondToken.sort ?? 0);

  try {
    await canvas.scene.updateEmbeddedDocuments("Token", [
      { _id: firstToken.id, sort: secondSort },
      { _id: secondToken.id, sort: firstSort },
    ]);

    ui.notifications.info(
      `Swapped sort values for ${firstToken.name} and ${secondToken.name}.`,
    );
  } catch (err) {
    console.error(err);
    ui.notifications.error(`Failed to swap token sort values: ${err.message}`);
  }
})();
