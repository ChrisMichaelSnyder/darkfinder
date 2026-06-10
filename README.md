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

## Setup automation

This repo also includes a Playwright-based admin updater for Foundry setup pages when you do not have SSH or filesystem access to the host machine.

Example:

```powershell
$env:FOUNDRY_SETUP_URL='https://carrion.davidleepatrick.com/setup'
$env:FOUNDRY_ADMIN_PASSWORD='your-admin-password'
npm run update:foundry-module -- --module darkfinder
```

The updater logs into the Foundry setup page, opens the Add-on Modules tab, and clicks the update control for the selected module.

To update all three hosted servers in one pass:

```powershell
$env:FOUNDRY_ADMIN_PASSWORD='your-admin-password'
npm run update:foundry-modules -- --module darkfinder
```

The multi-server wrapper targets these setup URLs by default:

- `https://carrion.davidleepatrick.com/setup`
- `https://nightfall.davidleepatrick.com/setup`
- `https://whatif.davidleepatrick.com/setup`

Setup notes are in [docs/module-setup.md](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/docs/module-setup.md).
Release prep notes for manifest-URL installation are in [docs/release-checklist.md](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/docs/release-checklist.md).
