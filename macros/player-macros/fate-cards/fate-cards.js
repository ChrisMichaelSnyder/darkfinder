(async () => {
  const MODULE_ID = "darkfinder";
  const CHAT_FLAG_KEY = "fateCardPopup";
  const DIALOG_REGISTRY_KEY = "darkfinderFateCardsDialog";
  const IMAGE_ROOT = `modules/${MODULE_ID}/assets/harrow-cards`;
  const DIALOG_WIDTH = 560;
  const DIALOG_HEIGHT = 930;
  const actor = game.user.character || canvas.tokens.controlled[0]?.actor || null;
  const moduleApi = game.modules.get(MODULE_ID)?.api || null;

  if (!actor) {
    return ui.notifications.warn("Since you have no default character sheet, please select a token to use.");
  }

  const existingDialog = globalThis[DIALOG_REGISTRY_KEY];
  if (existingDialog?.rendered) {
    await existingDialog.close();
  }

  const ALIGNMENT_ROWS = [
    {
      alignment: "LG",
      cards: [
        ["str", "The Paladin", "The_Paladin.jpg"],
        ["dex", "The Dance", "The_Dance.jpg"],
        ["con", "The Trumpet", "The_Trumpet.jpg"],
        ["int", "The Hidden Truth", "The_Hidden_Truth.jpg"],
        ["wis", "The Winged Serpent", "The_Winged_Serpent.jpg"],
        ["cha", "The Empty Throne", "The_Empty_Throne.jpg"],
      ],
    },
    {
      alignment: "NG",
      cards: [
        ["str", "The Keep", "The_Keep.jpg"],
        ["dex", "The Cricket", "The_Cricket.jpg"],
        ["con", "The Survivor", "The_Survivor.jpg"],
        ["int", "The Wanderer", "The_Wanderer.jpg"],
        ["wis", "The Midwife", "The_Midwife.jpg"],
        ["cha", "The Theater", "The_Theater.jpg"],
      ],
    },
    {
      alignment: "CG",
      cards: [
        ["str", "The Big Sky", "The_Big_Sky.jpg"],
        ["dex", "The Juggler", "The_Juggler.jpg"],
        ["con", "The Desert", "The_Desert.jpg"],
        ["int", "The Joke", "The_Joke.jpg"],
        ["wis", "The Publican", "The_Publican.jpg"],
        ["cha", "The Unicorn", "The_Unicorn.jpg"],
      ],
    },
    {
      alignment: "LN",
      cards: [
        ["str", "The Forge", "The_Forge.jpg"],
        ["dex", "The Locksmith", "The_Locksmith.jpg"],
        ["con", "The Brass Dwarf", "The_Brass_Dwarf.jpg"],
        ["int", "The Inquisitor", "The_Inquisitor.jpg"],
        ["wis", "The Queen Mother", "The_Queen_Mother.jpg"],
        ["cha", "The Marriage", "The_Marriage.jpg"],
      ],
    },
    {
      alignment: "N",
      cards: [
        ["str", "The Bear", "The_Bear.jpg"],
        ["dex", "The Peacock", "The_Peacock.jpg"],
        ["con", "The Teamster", "The_Teamster.jpg"],
        ["int", "The Foreign Trader", "The_Foreign_Trader.jpg"],
        ["wis", "The Owl", "The_Owl.jpg"],
        ["cha", "The Twin", "The_Twin.jpg"],
      ],
    },
    {
      alignment: "CN",
      cards: [
        ["str", "The Uprising", "The_Uprising.jpg"],
        ["dex", "The Rabbit Prince", "The_Rabbit_Prince.jpg"],
        ["con", "The Mountain Man", "The_Mountain_Man.jpg"],
        ["int", "The Vision", "The_Vision.jpg"],
        ["wis", "The Carnival", "The_Carnival.jpg"],
        ["cha", "The Courtesan", "The_Courtesan.jpg"],
      ],
    },
    {
      alignment: "LE",
      cards: [
        ["str", "The Fiend", "The_Fiend.jpg"],
        ["dex", "The Avalanche", "The_Avalanche.jpg"],
        ["con", "The Tangled Briar", "The_Tangled_Briar.jpg"],
        ["int", "The Rakshasa", "The_Rakshasa.jpg"],
        ["wis", "The Eclipse", "The_Eclipse.jpg"],
        ["cha", "The Tyrant", "The_Tyrant.jpg"],
      ],
    },
    {
      alignment: "NE",
      cards: [
        ["str", "The Beating", "The_Beating.jpg"],
        ["dex", "The Crows", "The_Crows.jpg"],
        ["con", "The Sickness", "The_Sickness.jpg"],
        ["int", "The Idiot", "The_Idiot.jpg"],
        ["wis", "The Mute Hag", "The_Mute_Hag.jpg"],
        ["cha", "The Betrayal", "The_Betrayal.jpg"],
      ],
    },
    {
      alignment: "CE",
      cards: [
        ["str", "The Cyclone", "The_Cyclone.jpg"],
        ["dex", "The Demon's Lantern", "The_Demon's_Lantern.jpg"],
        ["con", "The Waxworks", "The_Waxworks.jpg"],
        ["int", "The Snakebite", "The_Snakebite.jpg"],
        ["wis", "The Lost", "The_Lost.jpg"],
        ["cha", "The Liar", "The_Liar.jpg"],
      ],
    },
  ];

  const ABILITY_LABELS = {
    str: "Strength",
    dex: "Dexterity",
    con: "Constitution",
    int: "Intelligence",
    wis: "Wisdom",
    cha: "Charisma",
  };

  const HARROW_CARDS = ALIGNMENT_ROWS.flatMap((row) => row.cards.map(([ability, name, fileName]) => ({
    name,
    ability,
    abilityLabel: ABILITY_LABELS[ability] || ability.toUpperCase(),
    alignment: row.alignment,
    alignmentLabel: formatAlignmentLabel(row.alignment),
    image: `${IMAGE_ROOT}/${fileName}`,
  })));

  if (HARROW_CARDS.length !== 54) {
    return ui.notifications.error(`Fate Cards expected 54 mapped cards but found ${HARROW_CARDS.length}.`);
  }

  const drawnCard = HARROW_CARDS[Math.floor(Math.random() * HARROW_CARDS.length)];
  const actorContext = buildActorContext(actor);
  const actorAlignment = parseAlignment(actorContext?.alignment);
  if (!actorAlignment) {
    return ui.notifications.warn("Could not read your character's alignment for Fate Cards.");
  }
  const sessionId = createSessionId();

  if (moduleApi?.openFateCardsDialog) {
    await moduleApi.openFateCardsDialog({ card: drawnCard, actorContext, sessionId });
  } else {
    const dialog = new Dialog({
      title: "Fate Cards",
      content: buildDialogContent(drawnCard),
      buttons: {},
      width: DIALOG_WIDTH,
      height: DIALOG_HEIGHT,
      resizable: false,
      render: async (html) => {
        applyDialogChrome(html);
        bindDialogEvents(html);
      },
    });

    globalThis[DIALOG_REGISTRY_KEY] = dialog;
    dialog.render(true);
  }

  await createPublicRevealMessage(actorContext, drawnCard, sessionId);

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
          pointer-events: auto;
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

        .fate-cards-overlay-meta {
          position: absolute;
          left: 50%;
          bottom: 14px;
          transform: translateX(-50%);
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
            <div class="fate-cards-overlay" data-role="overlay">
              <div class="fate-cards-total" data-role="total-bonus"></div>
              <div class="fate-cards-breakdown" data-role="breakdown"></div>
              <div class="fate-cards-chip fate-cards-chip--meta fate-cards-overlay-meta">${escapeHtml(card.abilityLabel)} • ${escapeHtml(card.alignmentLabel)}</div>
            </div>
          </div>
        </div>
        <div class="fate-cards-footer">
          <button type="button" class="fate-cards-button fate-cards-button--primary" data-action="calculate">Thinking is Hard</button>
        </div>
      </div>
    `;
  }

  async function createPublicRevealMessage(targetActor, card, activeSessionId) {
    const content = `
      <div class="darkfinder-fate-card-chat" style="display:flex; flex-direction:column; gap:0.65rem; width:100%;">
        <div style="font-size:1rem; line-height:1.4;">
          <strong>${escapeHtml(targetActor?.name || game.user.name || "A character")}</strong> draws <strong>${escapeHtml(card.name)}</strong>.
        </div>
        <div style="width:100%; display:flex; justify-content:center;">
          <img
            src="${escapeHtml(card.image)}"
            alt="${escapeHtml(card.name)}"
            style="display:block; width:70%; max-width:70%; height:auto; border-radius:8px; border:3px solid rgba(24,18,14,0.92); box-shadow:0 8px 20px rgba(0,0,0,0.35);"
          />
        </div>
      </div>
    `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ alias: String(targetActor?.name || game.user.name || "A character") }),
      content,
      rollMode: CONST.DICE_ROLL_MODES.PUBLIC,
      whisper: [],
      blind: false,
      flags: {
        [MODULE_ID]: {
          [CHAT_FLAG_KEY]: {
            id: String(activeSessionId || ""),
            createdAt: Date.now(),
            senderUserId: String(game.user?.id || ""),
            payload: {
              card: {
                name: String(card?.name || ""),
                ability: String(card?.ability || ""),
                abilityLabel: String(card?.abilityLabel || ""),
                alignment: String(card?.alignment || ""),
                alignmentLabel: String(card?.alignmentLabel || ""),
                image: String(card?.image || ""),
              },
              actorContext: {
                name: String(targetActor?.name || ""),
                alignment: String(targetActor?.alignment || ""),
                abilities: {
                  str: Number(targetActor?.abilities?.str || 0),
                  dex: Number(targetActor?.abilities?.dex || 0),
                  con: Number(targetActor?.abilities?.con || 0),
                  int: Number(targetActor?.abilities?.int || 0),
                  wis: Number(targetActor?.abilities?.wis || 0),
                  cha: Number(targetActor?.abilities?.cha || 0),
                },
              },
            },
          },
        },
      },
    });
  }

  function applyDialogChrome(html) {
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

  function bindDialogEvents(html) {
    html.on("click", '[data-action="calculate"]', () => {
      const overlay = html.find('[data-role="overlay"]');
      if (overlay.hasClass("visible")) {
        overlay.removeClass("visible");
        return;
      }
      const result = calculateCardBonus(actorContext, drawnCard, actorAlignment);
      overlay.addClass("visible");
      html.find('[data-role="total-bonus"]').text(formatModifier(result.totalBonus));
      html.find('[data-role="breakdown"]').text(
        `${drawnCard.abilityLabel} ${formatModifier(result.abilityBonus)} • ${drawnCard.alignmentLabel} ${formatModifier(result.alignmentBonus)}`,
      );
      html.find('[data-role="breakdown"]').text(
        `${drawnCard.abilityLabel} ${formatModifier(result.abilityBonus)}\n${drawnCard.alignmentLabel} ${formatModifier(result.alignmentBonus)}`,
      );
    });
  }

  function calculateCardBonus(targetActor, card, parsedAlignment) {
    const abilityBonus = Number(getAbilityModifier(targetActor, card.ability) || 0);
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

  function getActorAlignmentValue(targetActor) {
    const paths = [
      ["system", "details", "alignment"],
      ["system", "traits", "alignment"],
      ["system", "alignment"],
      ["alignment"],
    ];

    for (const path of paths) {
      const value = getObjectPath(targetActor, path);
      const normalized = normalizeAlignmentSource(value);
      if (normalized) return normalized;
    }
    return "";
  }

  function normalizeAlignmentSource(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((entry) => normalizeAlignmentSource(entry)).find(Boolean) || "";
    if (typeof value === "object") {
      for (const key of ["value", "short", "long", "label", "name", "alignment"]) {
        const nested = normalizeAlignmentSource(value[key]);
        if (nested) return nested;
      }
    }
    return "";
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
      label: formatAlignmentLabel(normalized),
    };
  }

  function formatAlignmentLabel(value) {
    const labels = {
      lg: "Lawful Good",
      ln: "Lawful Neutral",
      le: "Lawful Evil",
      ng: "Neutral Good",
      n: "Neutral",
      ne: "Neutral Evil",
      cg: "Chaotic Good",
      cn: "Chaotic Neutral",
      ce: "Chaotic Evil",
    };
    return labels[String(value || "").toLowerCase()] || String(value || "").toUpperCase();
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

  function getActorAbilityModifier(targetActor, abilityKey) {
    const normalizedKey = normalizeAbilityKey(abilityKey);
    if (!normalizedKey) return null;
    const ability = getObjectPath(targetActor, ["system", "abilities", normalizedKey]);
    const explicit = parseNumericValue(ability?.mod ?? ability?.modifier ?? ability?.totalMod ?? ability?.abilityMod);
    if (explicit != null) return explicit;
    const score = parseNumericValue(ability?.total ?? ability?.value ?? ability?.score);
    return score == null ? null : Math.floor((score - 10) / 2);
  }

  function getAbilityModifier(target, abilityKey) {
    const normalizedKey = normalizeAbilityKey(abilityKey);
    if (!normalizedKey) return null;
    if (target?.abilities && typeof target.abilities === "object") {
      const value = Number(target.abilities[normalizedKey]);
      return Number.isFinite(value) ? value : null;
    }
    return getActorAbilityModifier(target, normalizedKey);
  }

  function buildActorContext(targetActor) {
    return {
      name: String(targetActor?.name || game.user.name || "A character"),
      alignment: String(getActorAlignmentValue(targetActor) || ""),
      abilities: {
        str: Number(getActorAbilityModifier(targetActor, "str") || 0),
        dex: Number(getActorAbilityModifier(targetActor, "dex") || 0),
        con: Number(getActorAbilityModifier(targetActor, "con") || 0),
        int: Number(getActorAbilityModifier(targetActor, "int") || 0),
        wis: Number(getActorAbilityModifier(targetActor, "wis") || 0),
        cha: Number(getActorAbilityModifier(targetActor, "cha") || 0),
      },
    };
  }

  function createSessionId() {
    if (foundry?.utils?.randomID) return foundry.utils.randomID();
    if (typeof randomID === "function") return randomID();
    return `fate-card-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function parseNumericValue(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      const match = value.trim().match(/[-+]?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    }
    if (typeof value === "object") {
      for (const key of ["total", "value", "mod", "bonus", "current"]) {
        const parsed = parseNumericValue(value[key]);
        if (parsed != null) return parsed;
      }
    }
    return null;
  }

  function formatModifier(value) {
    const numeric = Number(value || 0);
    return numeric >= 0 ? `+${numeric}` : `${numeric}`;
  }

  function getObjectPath(object, path) {
    return path.reduce((current, key) => (current && current[key] !== undefined ? current[key] : null), object);
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
