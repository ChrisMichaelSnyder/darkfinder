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
- Test each launcher in a clean PF1 world.
- Confirm `reload-firearm` behavior is ready for public use.

## 2. Maintain the module-owned packs

- Keep the module `Macro` compendium pack at id `darkfinder.darkfinder-macros`.
- Keep the module `Item` compendium pack at id `darkfinder.spell-cores-augments`.
- Update the native pack contents in `packs/` when launcher macros or Spell Cores/Augments items change.
- Ensure both packs remain declared in `module.json`.

Suggested manifest entries:

```json
{
  "name": "darkfinder-macros",
  "label": "Darkfinder Macros",
  "type": "Macro",
  "path": "packs/darkfinder-macros"
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

## 4. Create a release artifact

- Zip the module contents so the archive extracts to a top-level `darkfinder/` folder containing `module.json`.
- Create a GitHub Release such as `v0.1.4`.
- Upload the zip asset.
- Update `module.json` with the matching `download` URL before publishing if needed.

## 5. Test installation

- In a separate Foundry install or clean test profile, install the module by manifest URL.
- Enable it in a PF1 world.
- Verify macro compendium and spell pack loading.
