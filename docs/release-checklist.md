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

## 2. Create the module-owned spell pack

- Create a module `Item` compendium pack with id `darkfinder.spell-cores-augments`.
- Import/export your Spell Cores/Augments entries into that pack.
- After the pack exists, add its `packs` entry to `module.json`.

Suggested manifest entry:

```json
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
- Decide on your public repo URL.
- Add release metadata to `module.json`:
  - `url`
  - `manifest`
  - `download`

Suggested pattern:

```json
"url": "https://github.com/<owner>/darkfinder",
"manifest": "https://raw.githubusercontent.com/<owner>/darkfinder/main/module.json",
"download": "https://github.com/<owner>/darkfinder/releases/download/v0.1.0/darkfinder.zip"
```

## 4. Create a release artifact

- Zip the module contents so the archive extracts to a top-level `darkfinder/` folder containing `module.json`.
- Create a GitHub Release such as `v0.1.0`.
- Upload the zip asset.
- Update `module.json` with the matching `download` URL if needed.

## 5. Test installation

- In a separate Foundry install or clean test profile, install the module by manifest URL.
- Enable it in a PF1 world.
- Verify launchers and spell pack loading.
