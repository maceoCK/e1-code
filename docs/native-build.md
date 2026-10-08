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
E1_CAPTURE_ROOT=/absolute/path/to/capture-root npm run build
```

The public build script writes to `dist/E1 Code.app` and stages files in `.package/`. It does not default to replacing an installed app. `E1_APP_BUNDLE` can explicitly select another destination. The build requires macOS, Python 3, `iconutil`, and `codesign`. Close any app at the selected destination before rebuilding. If changing the supplied capture, start with a fresh staging directory.

The build applies the local model/workflow adapters, copies E1 source, updates branding, and signs the result. It uses ad-hoc signing unless a local E1 signing identity has already been configured. `scripts/setup-signing.cjs` creates a persistent local identity in the current user's Keychain; it is optional, changes local Keychain state, and is not part of installation or CI. Signing keys, certificates, and identity configuration are never included in this repository.

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
