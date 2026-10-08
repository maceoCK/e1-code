# Local native builds

The native adapter is specific to a local capture of Claude Desktop `2.19675.0`. This repository does not contain that app, its extracted code, its fonts, or its native execution engines. Supply only local inputs you are authorized to use. The build is a local integration workflow, not a redistributable app package.

Required capture layout:

```text
capture-root/
  full/original/Claude.app/
  extracted/app/
    package.json
    .vite/build/index.chunk-BZdcw7TE.js
    ...the rest of the extracted application...
  readable/resources/ion-dist/assets/v1/cf2613ee5-Btwr9m9F.js
```

The original app must include its complete `Contents/Resources/ion-dist` renderer. The readable JavaScript file is a local input to logo motion mapping. Generated frames and vendor source remain excluded from Git.

```sh
npm ci
node scripts/setup-signing.cjs
E1_CAPTURE_ROOT=/absolute/path/to/capture-root npm run build
```

The public build script writes to `dist/E1 Code.app` and stages files in `.package/`. It does not default to replacing an installed app. `E1_APP_BUNDLE` can explicitly select another destination. The build requires macOS, Python 3, `iconutil`, and `codesign`. Close any app at the selected destination before rebuilding. If changing the supplied capture, start with a fresh staging directory.

The build applies the local model/workflow adapters, copies E1 source, updates branding, and signs the result. The credential helper requires a persistent local signing identity. `scripts/setup-signing.cjs` creates that identity in the current user's Keychain; it changes local Keychain state and is not run by `npm ci` or CI. Signing keys, certificates, and identity configuration are never included in this repository.

### Keychain access across updates

macOS can bind legacy Keychain approvals to an executable's code hash, which changes on each local rebuild. E1 bundles a small **E1 Keychain Helper** and copies its cached, signed bytes unchanged into each new build. The helper verifies the live parent's bundle identifier and signing certificate before accessing the one canonical E1 storage key. The app also verifies the helper's SHA-256 from its signed resource manifest.

The helper handles application credential encryption. A native Node-API module initializes Chromium's browser storage inside the main app process: each signed build creates its own Keychain item with the original encryption password received through a private pipe. Existing encrypted cookies and credentials remain readable, and macOS can authorize each new browser item to its creating process. No system-wide trust settings, access groups, encryption settings, or existing Keychain items are changed. Earlier build items remain available for rollback.

Fresh installs create their own storage key. Upgrading from an earlier build may require **Always Allow** once for the helper's access to **E1 Code Safe Storage**. A locked Keychain or an explicit denial still requires user action. Routine rebuilds reuse the helper. A helper source/signing change deliberately stops the build; after review, `E1_UPDATE_KEYCHAIN_HELPER=1` allows an explicit update and preserves the old helper. macOS may require approval again for that exceptional change. Public distribution also requires appropriate Developer ID signing and notarization; the local development identity is not a release identity.

The native build needs Xcode Command Line Tools and Node-API headers. Install headers with `npx node-gyp install`, or set `E1_NODE_HEADERS` to the directory containing `node_api.h`.

`node scripts/verify-keychain-helper.cjs` checks two different signed parent builds, a fresh disposable Keychain item, cross-build decryption, native browser-key access without interaction, and rejection of an unrelated caller. The installed app accepts `--e1-check-keychain` to check existing credential readability without printing credentials. Add `--e1-cookie-write`, rebuild, then run with `--e1-cookie-read` to verify a synthetic encrypted browser cookie across builds. The check uses a separate `E1 Storage Verification` profile and removes its test cookie after reading it.

Application data uses the existing local `Aster` and `Aster-Workspace-3p` profile names for history continuity. Launching a build can use those existing profiles. Make a local backup before testing changes against an important chat library.

## Independent Electron workspace preview

`scripts/build-workspace-preview.cjs` can package the experimental standalone workspace using a separately installed compatible Electron runtime:

```sh
E1_ELECTRON_TEMPLATE=/absolute/path/to/Electron.app \
  node scripts/build-workspace-preview.cjs /absolute/path/to/NewPreview.app
```

The destination must not exist. The preview has separate chat data, but currently reads already-connected Claude subscription account metadata from the local E1 profile. It does not yet provide independent account setup. The Node/Electron ABI must match the installed `node-pty` build or prebuilt binary. Its UI and feature coverage differ from the captured native client.

## Local diagnostics

The manual scripts in `scripts/` preserve development utilities. Some expect an installed E1 app, local runtime logs, existing connections, or a specific CLI version. Inspect them before running. `qwen-context-diagnostic.cjs` requires `E1_DIAGNOSTIC_SESSION` pointing to a local session file and can copy its contents into private diagnostic output. All generated evidence is excluded from Git.
