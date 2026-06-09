# darkfinder

Scripts, compendiums, modules, and utilities for Darkfinder and its subsystems.

## Foundry module scaffold

This repo now includes a Foundry VTT module manifest at [module.json](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/module.json) and a small runtime API under [scripts/module.js](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/scripts/module.js).

Current module launchers:

- `game.modules.get("darkfinder")?.api?.runCheckEndurance()`
- `game.modules.get("darkfinder")?.api?.runCheckResolve()`
- `game.modules.get("darkfinder")?.api?.runCheckSanity()`
- `game.modules.get("darkfinder")?.api?.runReloadFirearm()`
- `game.modules.get("darkfinder")?.api?.runShortRest()`
- `game.modules.get("darkfinder")?.api?.openSpellcrafting()`
- `game.modules.get("darkfinder")?.api?.runSpellAttack()`

Setup notes and the compendium migration plan are in [docs/module-setup.md](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/docs/module-setup.md).
Release prep notes for manifest-URL installation are in [docs/release-checklist.md](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/docs/release-checklist.md).
