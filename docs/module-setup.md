# Darkfinder Module Setup

This repo can now be loaded by Foundry as a module with id `darkfinder`.

## Install locally

1. Copy or symlink this repo into your Foundry user data at `Data/modules/darkfinder`.
2. Make sure the folder name matches the module id exactly: `darkfinder`.
3. Enable the module in a Pathfinder 1e world.

## Current module API

Once the module is enabled, these launchers are available:

- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/check-endurance/check-endurance.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/check-resolve/check-resolve.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/check-sanity/check-sanity.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/reload-firearm/reload-firearm.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/short-rest/short-rest.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/spell-crafter/spellcrafting-ui-macro.js")`
- `game.modules.get("darkfinder")?.api?.executeMacroFile("macros/module/spell-crafter/spell-attack.js")`

## Macro compendium

The module now ships a native `Macro` compendium pack:

- `darkfinder.darkfinder-macros`

Use that compendium as the supported source for launcher macros players can drag to hotbars.

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
4. Keep the module macro pack id as `darkfinder.darkfinder-macros`.

## Runtime design

The current macro launchers intentionally reuse the existing macro source files through `executeMacroFile(...)`. That keeps behavior stable while avoiding duplicated wrapper functions in the module API.

## Repo separation

Reusable module macros now live under `macros/module/`.

Campaign-specific or excluded content now lives under `macros/non-module/`.
