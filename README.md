# darkfinder

Scripts, compendiums, modules, and utilities for Darkfinder and its subsystems.

## Foundry module scaffold

This repo now includes a Foundry VTT module manifest at:

`https://raw.githubusercontent.com/ChrisMichaelSnyder/darkfinder/main/module.json`

It also includes a small runtime API under [scripts/module.js](/abs/path/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/scripts/module.js).

Current module launchers:

- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/check-endurance/check-endurance.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/check-resolve/check-resolve.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/check-sanity/check-sanity.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/reload-firearm/reload-firearm.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/short-rest/short-rest.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/spell-crafter/spellcrafting-ui-macro.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/spell-crafter/spell-attack.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/gm-macros/initiative-fix/initiative-fix.js")`

The supported Foundry-facing entrypoints are now the module API plus the shipped compendiums:

- `darkfinder-player-macros`
- `darkfinder-gm-macros`
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

## Macro pack enforcement

Shipped macro compendiums are derived from folder layout:

- `macros/player-macros/` -> `packs/darkfinder-player-macros`
- `macros/gm-macros/` -> `packs/darkfinder-gm-macros`
- `macros/non-module/` is never shipped

Useful commands:

```powershell
npm run sync:macro-compendiums
npm run check:macro-layout
npm run prepare:macro-packs
```

## Spell wiki sync

Spell Cores and Spell Augments are authored from the repo YAML files:

- `data/spell-cores-augments/spell-cores.yaml`
- `data/spell-cores-augments/spell-augments.yaml`

You can export the generated wiki sections locally with:

```powershell
npm run export:spell-wiki
```

That writes preview files under `generated/wiki/`.

To dry-run the live page replacement without publishing:

```powershell
npm run sync:spell-wiki -- --dry-run true
```

To publish the managed `Spell Augments` and `Spell Cores` sections on the Miraheze page:

```powershell
$env:WIKI_USER='your-username'
$env:WIKI_PASSWORD='your-password'
npm run sync:spell-wiki
```

The wiki sync only replaces the `==Spell Augments==` and `==Spell Cores==` section bodies on `Spell_System`; it leaves the rest of the page alone.

## Combined deploy

The full post-release target deploy can now run wiki sync and Foundry server updates in one command:

```powershell
npm run deploy:release-targets
```

That workflow runs in this order:

1. `sync-spell-wiki`
2. `update-foundry-modules`

Useful options:

```powershell
npm run deploy:release-targets -- --dry-run-wiki true
npm run deploy:release-targets -- --skip-wiki true
npm run deploy:release-targets -- --skip-foundry true
```

This repo also includes a tracked `.githooks/pre-push` hook. If you run:

```powershell
git config core.hooksPath .githooks
```

pushes will stop if the compendium packs are out of sync with the macro folder layout.

Setup notes are in [docs/module-setup.md](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/docs/module-setup.md).
Release prep notes for manifest-URL installation are in [docs/release-checklist.md](/c:/Users/csnyd/OneDrive/Desktop/Pathfinder/Darkfinder/docs/release-checklist.md).
