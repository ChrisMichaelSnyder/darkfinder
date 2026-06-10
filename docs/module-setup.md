# Darkfinder Module Setup

This repo can now be loaded by Foundry as a module with id `darkfinder`.

## Install locally

1. Copy or symlink this repo into your Foundry user data at `Data/modules/darkfinder`.
2. Make sure the folder name matches the module id exactly: `darkfinder`.
3. Enable the module in a Pathfinder 1e world.

## Current module API

Once the module is enabled, these launchers are available:

- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/check-endurance/check-endurance.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/check-resolve/check-resolve.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/check-sanity/check-sanity.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/reload-firearm/reload-firearm.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/short-rest/short-rest.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/spell-crafter/spellcrafting-ui-macro.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/player-macros/spell-crafter/spell-attack.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/gm-macros/initiative-fix/initiative-fix.js")`

## Macro compendium

The module now ships native `Macro` compendium packs:

- `darkfinder.darkfinder-player-macros`
- `darkfinder.darkfinder-gm-macros`

Use the player pack as the supported source for launcher macros players can drag to hotbars. The GM pack is intended for GM-only launcher macros.

## Setup-page updater

If you do not have SSH or filesystem access to the Foundry host, this repo includes a Playwright automation script that can log into a Foundry setup page and update a specific installed module through the normal UI.

Example:

```powershell
$env:FOUNDRY_SETUP_URL='https://example.com/setup'
$env:FOUNDRY_ADMIN_PASSWORD='your-admin-password'
npm run update:foundry-module -- --module darkfinder
```

Useful options:

- `--url https://example.com/setup`
- `--module darkfinder`
- `--headless false`
- `--timeout 45000`

## Spell Cores/Augments compendium

Spellcrafting now looks for a module-owned pack first:

- `darkfinder.spell-cores-augments`

If that pack does not exist yet, it falls back to a visible world compendium named `Spell Cores/Augments` inside a folder named `Darkfinder`.

Recommended target pack id:

- `darkfinder.spell-cores-augments`

Recommended migration steps:

1. Create an `Item` compendium pack inside the module named `spell-cores-augments`.
2. Export or import your existing Spell Cores/Augments items into that pack.
3. Keep the module pack id as `darkfinder.spell-cores-augments`.
4. Keep the module macro pack ids as `darkfinder.darkfinder-player-macros` and `darkfinder.darkfinder-gm-macros`.

## Runtime design

The current macro launchers intentionally reuse the existing macro source files through `executeMacroFile(...)`. That keeps behavior stable while avoiding duplicated wrapper functions in the module API.

## Repo separation

Reusable player-visible module macros now live under `macros/player-macros/`.

GM-only shipped module macros now live under `macros/gm-macros/`.

Campaign-specific or excluded content now lives under `macros/non-module/`.

## Macro pack maintenance

The shipped macro packs are regenerated from the folder layout:

- `macros/player-macros/` -> `packs/darkfinder-player-macros`
- `macros/gm-macros/` -> `packs/darkfinder-gm-macros`
- `macros/non-module/` is excluded

Commands:

- `npm run sync:macro-compendiums`
- `npm run check:macro-layout`
- `npm run prepare:macro-packs`

Optional local enforcement:

```powershell
git config core.hooksPath .githooks
```

That enables the tracked pre-push hook, which syncs and validates the shipped macro packs before a push is allowed to proceed.
