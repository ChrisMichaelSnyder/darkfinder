# Darkfinder Release Checklist

Use this checklist when you are ready to make the first manifest-URL installable release.

## 1. Finish module contents

- Confirm the shipped macro set is only:
  - `check-endurance`
  - `check-resolve`
  - `check-sanity`
  - `reload-firearm`
  - `short-rest`
  - `spell-crafter`
  - approved `gm-macros` content only
- Test each launcher in a clean PF1 world.
- Confirm `reload-firearm` behavior is ready for public use.

## 2. Maintain the module-owned packs

- Keep the module `Macro` compendium packs at ids `darkfinder.darkfinder-player-macros` and `darkfinder.darkfinder-gm-macros`.
- Keep the module `Item` compendium pack at id `darkfinder.spell-cores-augments`.
- Update the native pack contents in `packs/` when launcher macros or Spell Cores/Augments items change.
- Confirm the GM pack only contains GM-only macros and that its manifest ownership hides it from Players and Trusted Players.
- Ensure both packs remain declared in `module.json`.
- Run `npm run prepare:macro-packs` before release packaging.

Suggested manifest entries:

```json
{
  "name": "darkfinder-player-macros",
  "label": "Darkfinder Player Macros",
  "type": "Macro",
  "path": "packs/darkfinder-player-macros",
  "ownership": {
    "PLAYER": "OBSERVER",
    "TRUSTED": "OBSERVER",
    "ASSISTANT": "OWNER"
  }
},
{
  "name": "darkfinder-gm-macros",
  "label": "Darkfinder GM Macros",
  "type": "Macro",
  "path": "packs/darkfinder-gm-macros",
  "ownership": {
    "PLAYER": "NONE",
    "TRUSTED": "NONE",
    "ASSISTANT": "OWNER"
  }
},
{
  "name": "spell-cores-augments",
  "label": "Spell Cores/Augments",
  "type": "Item",
  "system": "pf1",
  "path": "packs/spell-cores-augments"
}
```

## 3. Publish the repo

- Push the repo to GitHub.
- Confirm `module.json` version and `download` URL match the release you are about to publish.
- If Spell Cores or Spell Augments changed, the combined deploy workflow can publish the managed spell sections automatically before the Foundry server update:
  - `npm run deploy:release-targets`
  - Optional preview first: `npm run deploy:release-targets -- --dry-run-wiki true`

## 4. Create a release artifact

- Zip the module contents so the archive extracts to a top-level `darkfinder/` folder containing `module.json`.
- Create a GitHub Release such as `v0.1.4`.
- Upload the zip asset.
- Update `module.json` with the matching `download` URL before publishing if needed.

## 5. Test installation

- In a separate Foundry install or clean test profile, install the module by manifest URL.
- Enable it in a PF1 world.
- Verify macro compendium and spell pack loading.
- If using the combined deploy flow, verify both the wiki spell page and the hosted Foundry servers updated successfully.
