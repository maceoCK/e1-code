# Local native builds

```sh
npm ci
npm run setup:signing   # optional, once per Mac
npm run build
```

`npm run build` writes `dist/E1 Code.app`. Builds target Apple silicon (arm64): the pinned upstream releases and the bundled runtimes are arm64, and each release's signed `app.asar` hash is architecture-specific. It never replaces an installed app; `E1_APP_BUNDLE` can explicitly select another destination. The build requires macOS, Node 22.12+, Python 3, the Xcode Command Line Tools (`clang`, `codesign`, `iconutil`) and Node-API headers (found in your Node installation, or fetched once with `npx node-gyp install`; `E1_NODE_HEADERS` overrides).

## Upstream inputs

E1 is a set of patches and modules applied to specific third-party releases. This repository contains none of their files. `scripts/prepare-upstream.cjs` (run automatically by the build, or `npm run prepare:upstream`) prepares them under the gitignored `captures/`:

| Input | Pinned release | Source |
| --- | --- | --- |
| Claude Desktop | `3.1623.0`, Developer ID team `Q6L2SF6YDW` | `/Applications/Claude.app` if it is this release, otherwise the arm64 release from `downloads.claude.ai` (~250 MB) |
| ChatGPT (Dot renderer) | `26.1013.40934` build `20770`, team `2DC432GLL2` | `/Applications/ChatGPT.app` if it is this release, otherwise the arm64 release from `persistent.oaistatic.com` (~690 MB) |
| CLIProxyAPI | `8.0.30` (MIT) | GitHub release archive, SHA-256 pinned in `third_party/cliproxyapi/manifest.json` |

Pins live in `third_party/upstream.json`. An app is used only after `codesign --verify --deep --strict`, the pinned Developer ID team, bundle id, version and build, and the signed `ElectronAsarIntegrity` hash of its `app.asar` all match; a download that fails is deleted. Completed downloads are kept in `captures/.downloads/` and reused.

- `E1_UPSTREAM_SOURCE=installed|download|auto` forces a source (default `auto`).
- `E1_UPSTREAM_APP_CLAUDE` / `E1_UPSTREAM_APP_CHATGPT` point at another local copy of the pinned app.
- `E1_UPSTREAM_URL_CLAUDE` / `E1_UPSTREAM_URL_CHATGPT` use a mirror of the official zip; its contents are verified the same way.
- `E1_CAPTURE_ROOT` / `E1_CHATGPT_CAPTURE` skip preparation and use an existing capture with the same layout (`full/original/Claude.app` + `extracted/app`, and a webview directory containing `assets/`).

Updating to a newer Claude or ChatGPT release means re-porting the needle patches (`scripts/patch-*.cjs`) and then updating the pins. Each patch throws if its anchor no longer matches exactly once.

## What the build does

The build applies the model/workflow, model-picker, tab, browser, Settings and Dot adapters, copies E1 source into the archive as `aster/`, updates branding, embeds CLIProxyAPI, and signs the result. It packages into a staged copy and replaces the destination only after the archive hash, Keychain helper checksum, and code signature verify. The credential helper requires a persistent local signing identity for stable Keychain access; `scripts/setup-signing.cjs` creates that identity in the current user's Keychain. It changes local Keychain state and is not run by `npm ci`, the build, or CI. Without it the build is ad-hoc signed. Signing keys, certificates, and identity configuration are never included in this repository. Public distribution would require Developer ID signing and notarization; the local identity is not a release identity.

### Keychain access across updates

macOS can bind legacy Keychain approvals to an executable's code hash, which changes on each local rebuild. E1 bundles a small **E1 Keychain Helper** and copies its cached, signed bytes unchanged into each new build. The helper verifies the live parent's bundle identifier and signing certificate before accessing the one canonical E1 storage key. The app also verifies the helper's SHA-256 from its signed resource manifest.

The helper handles application credential encryption. A native Node-API module initializes Chromium's browser storage inside the main app process: each signed build creates its own Keychain item with the original encryption password received through a private pipe. Existing encrypted cookies and credentials remain readable, and macOS can authorize each new browser item to its creating process. No system-wide trust settings, access groups, encryption settings, or existing Keychain items are changed. Earlier build items remain available for rollback.

Fresh installs create their own storage key. Upgrading from an earlier build may require **Always Allow** once for the helper's access to **E1 Code Safe Storage**. A locked Keychain or an explicit denial still requires user action. Routine rebuilds reuse the helper. A helper source/signing change deliberately stops the build; after review, `E1_UPDATE_KEYCHAIN_HELPER=1` allows an explicit update and preserves the old helper. macOS may require approval again for that exceptional change. Public distribution also requires appropriate Developer ID signing and notarization; the local development identity is not a release identity.

`node scripts/verify-keychain-helper.cjs` checks two different signed parent builds, a fresh disposable Keychain item, cross-build decryption, native browser-key access without interaction, and rejection of an unrelated caller. The installed app accepts `--e1-check-keychain` to check existing credential readability without printing credentials. Add `--e1-cookie-write`, rebuild, then run with `--e1-cookie-read` to verify a synthetic encrypted browser cookie across builds. The check uses a separate `E1 Storage Verification` profile and removes its test cookie after reading it.

Application data uses the existing local `Aster` and `Aster-Workspace-3p` profile names for history continuity. Launching a build can use those existing profiles. Make a local backup before testing changes against an important chat library.

## Dot renderer input

Dot hosts the ChatGPT desktop renderer from the pinned ChatGPT release (26.1013.40934, build 20770), prepared like the Claude input above. The build copies its webview `assets/` into the local bundle and adds export bindings at the host boundary, plus one status-placeholder adjustment in the header atom; component bodies are not modified. `node scripts/verify-dot-native.cjs` compares a built app's Dot assets with the capture (`E1_DOT_ION` selects the build).

## In-place updaters

`scripts/install-vision-fallback.cjs` and `scripts/install-cua-operator.cjs` are one-shot updaters for an already-installed local build. Each patches only its own entries, re-signs with the existing identity, verifies every unrelated bundle file before replacing the bundle, and keeps a rollback copy. The CUA updater accepts only its pinned baseline hashes; the vision updater refuses an app that already contains it. Use the full build for a fresh install.

## Local diagnostics

The manual scripts in `scripts/` preserve development utilities. Some expect an installed E1 app, local runtime logs, existing connections, or a specific CLI version. Inspect them before running. `qwen-context-diagnostic.cjs` requires `E1_DIAGNOSTIC_SESSION` pointing to a local session file and can copy its contents into private diagnostic output. All generated evidence is excluded from Git.
