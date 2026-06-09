# darkfinder

Scripts, compendiums, modules, and utilities for Darkfinder and its subsystems.

## Foundry module scaffold

This repo now includes a Foundry VTT module manifest at [module.json](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/module.json) and a small runtime API under [scripts/module.js](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/scripts/module.js).

Current module launchers:

- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/check-endurance/check-endurance.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/check-resolve/check-resolve.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/check-sanity/check-sanity.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/reload-firearm/reload-firearm.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/short-rest/short-rest.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/spell-crafter/spellcrafting-ui-macro.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/spell-crafter/spell-attack.js")`

The supported Foundry-facing entrypoints are now the module API plus the shipped compendiums:

- `darkfinder-macros`
- `spell-cores-augments`

Setup notes are in [docs/module-setup.md](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/docs/module-setup.md).
Release prep notes for manifest-URL installation are in [docs/release-checklist.md](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/docs/release-checklist.md).
