# SkyAgent Web Asset Attribution

SkyAgent currently bundles no third-party Minecraft, Hypixel, SkyCrypt, SkyHanni, FurfSky, or Hypixel Plus texture files.

Bundled visuals:
- SkyAgent Generated Pixels: CSS-rendered item placeholders and profile shapes, MIT with this repository.
- Press Start 2P from `@fontsource/press-start-2p`, licensed under the SIL Open Font License 1.1, used for Minecraft-style labels and stat text.
- System UI fonts and monospace fallbacks are used for dense body copy.
- Lucide icons are provided by `lucide-react` under the ISC license.

Supported adapters:
- FurfSky Reborn adapter: disabled by default, user-provided pack required.
- Hypixel Plus adapter: disabled by default, user-provided pack required.

External resource-pack adapters use user-provided manifests and accepted license metadata before resolving item texture URLs. Missing manifests, missing item entries, stale manifests, and failed browser image loads fall back to generated SkyAgent textures instead of bundling or assuming third-party assets.

Any future bundled resource pack must add its license, source URL, author, covered asset classes, and redistribution permission here before merge.
