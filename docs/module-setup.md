# Darkfinder Module Setup

This repo can now be loaded by Foundry as a module with id `darkfinder`.

## Install locally

1. Copy or symlink this repo into your Foundry user data at `Data/modules/darkfinder`.
2. Make sure the folder name matches the module id exactly: `darkfinder`.
3. Enable the module in a Pathfinder 1e world.

## Current module API

Once the module is enabled, these launchers are available:

- `game.modules.get("darkfinder")?.api?.runCheckEndurance()`
- `game.modules.get("darkfinder")?.api?.runCheckResolve()`
- `game.modules.get("darkfinder")?.api?.runCheckSanity()`
- `game.modules.get("darkfinder")?.api?.runReloadFirearm()`
- `game.modules.get("darkfinder")?.api?.runShortRest()`
- `game.modules.get("darkfinder")?.api?.openSpellcrafting()`
- `game.modules.get("darkfinder")?.api?.runSpellAttack()`

You can use the helper files in `scripts/macros/` as the command bodies for Foundry launcher macro documents:

- `scripts/macros/run-check-endurance.js`
- `scripts/macros/run-check-resolve.js`
- `scripts/macros/run-check-sanity.js`
- `scripts/macros/run-reload-firearm.js`
- `scripts/macros/run-short-rest.js`
- `scripts/macros/open-spellcrafting.js`
- `scripts/macros/run-spell-attack.js`

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
4. Optionally create a `Macro` compendium pack for launcher macros players can drag to hotbars.

## Install by URL release prep

For manifest-URL installation, this repo still needs three manual release-time values in `module.json`:

- `url`
- `manifest`
- `download`

Recommended GitHub pattern:

- `url`: repository homepage
- `manifest`: stable raw URL to `module.json`
- `download`: versioned GitHub Release zip asset

The module is intentionally left without placeholder URLs so the manifest does not advertise fake install metadata before you publish it.

## Why this is a first-pass migration

The current module launchers intentionally reuse the existing macro source files. That keeps behavior stable while giving you a real module entrypoint now. The next pass should move shared helpers, hook registration, and compendium access into proper ES module files under `scripts/`.

## Repo separation

Reusable module macros now live under `macros/module/`.

Campaign-specific or excluded content now lives under `macros/non-module/`.
