# E1 Code

Experimental local AI workspace with multiple provider connections, account-independent chat history, exact-model account routing, and per-chat billing controls.

This repository contains E1 Code's integration layer, gateway, tests, and branding. The Claude Desktop and ChatGPT applications, recovered vendor code, proprietary fonts, native engines, private chats, credentials, and local build outputs are **not included**. The desktop integration requires separately supplied compatible application files; cloning this repository alone does not reproduce the installed Claude-style desktop UI.

## What is here

- **Providers and accounts:** OpenAI Responses, Anthropic Messages, OpenAI-compatible endpoints, Ollama, Pi configuration discovery, ChatGPT/Codex plan sign-in (one Keychain entry per account), and a bridge to the official local Claude Code CLI.
- **Routing:** multiple accounts, same-model subscription failover, explicit API fallback settings, per-chat plan pinning, and separate chat storage that survives connection changes.
- **Per-chat controls:** Plan/API indicators with account details and plan usage, published list prices for API routes, preferred models and effort for native workflow children, and confirmed paid-API Fast/Ultrafast routing where supported.
- **Model picker:** provider groups, newest versions first, and search by model, version, provider, or connection. Configured routes register with the CLI's curated picker, so selecting one does not send a probe request. Verified 1M-context Claude routes get a native ` 1M` variant; unknown limits are never guessed. Older generations are hidden by default (**Show legacy models**).
- **Tool search for other providers:** non-Anthropic adapters receive ordinary tools plus only the deferred tools discovered in the current conversation, instead of every MCP schema on every turn. See `src/deferred-tools.cjs`.
- **Text-only image fallback:** images sent to text-only models are replaced with bounded descriptions from a configured vision connection. See [docs/vision-fallback.md](docs/vision-fallback.md).
- **Vision-grounded computer use:** a text-only planner can drive the native CUA driver through a one-action vision operator with fresh post-action verification. See [docs/cua-operator.md](docs/cua-operator.md).
- **Dot:** an account-bound tab that hosts a locally captured ChatGPT renderer through E1's own sidebar and transport. Credentials stay in the main process.
- **Desktop adapters:** native Settings pages for accounts, models and fallback, a universal new-tab picker, mixed browser/file/terminal tool tabs, a browser start page, a green theme, E1 branding, and narrow model/workflow hooks for one compatible local Claude Desktop capture.

These components have different integration maturity. This is not a claim of complete Claude Desktop feature parity. Model access, plan sharing, billing, speed modes, and CLI behavior depend on the provider and account. Unsupported premium modes fail rather than silently selecting another model.

## Local development

Use Node.js 22.12 or newer and npm. macOS is the primary development target.

```sh
npm ci
npm run test:browser:install
npm test
npm run dev
```

`dev` starts the accounts/settings surface on a random loopback port. Open the full URL stored in `.dev-url` locally. Its fragment is an authentication token, so do not share or commit it. Subscription sign-in needs the desktop host's encrypted storage and browser integration; it is not enabled by the browser-only dev server.

For the earlier standalone chat prototype:

```sh
npm run dev:chat
```

This is a simpler development surface, not the native Claude-style client.

Development state is stored under `.dev-data/`. `ASTER_DATA` overrides that directory, and `ASTER_PORT` sets a port. Provider keys can be supplied with `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`; the application does not automatically load `.env` files. Browser development keeps entered keys in memory. The desktop host uses Electron's encrypted storage. Pi integration can also read the current user's local provider configuration.

## Build the app

On an Apple silicon Mac with Node 22.12+, Python 3 and the Xcode Command Line Tools:

```sh
npm ci
npm run build
```

The result is `dist/E1 Code.app`. The build fetches what this repository does not contain: Claude Desktop `3.1623.0` and ChatGPT `26.1013.40934`, the exact releases E1's hooks are written against. It uses your installed copies when they are those versions, otherwise the official arm64 downloads (about 950 MB the first time). It also fetches the pinned CLIProxyAPI runtime. Each app must pass its Developer ID signature, pinned team, bundle id, version and signed `app.asar` hash before it is used (`third_party/upstream.json`, `scripts/prepare-upstream.cjs`). Nothing proprietary is committed or published here; prepared inputs live in the gitignored `captures/`.

Optional: `npm run setup:signing` creates a persistent local signing identity so Keychain approvals survive rebuilds; without it the build is ad-hoc signed. See [native build details](docs/native-build.md). The integration is pinned to Claude Desktop `3.1623.0` (ported from `2.19675.0` on 2026-10-20); its hooks deliberately reject incompatible layouts.

The public checkout uses system fonts. Browser dependencies are generated from locked npm packages by `scripts/sync-ui-vendor.cjs`, with their license notices copied alongside them.

## Source map

| Area | Files |
| --- | --- |
| Requests, streaming, and routing | `src/gateway*.cjs`, `src/providers.cjs`, `src/routing.cjs`, `src/deferred-tools.cjs` |
| Account connections and chat persistence | `src/subscriptions.cjs`, `src/codex-*.cjs`, `src/claude-*.cjs`, `src/store.cjs`, `src/library-identity.cjs` |
| Models, limits, pricing, speed, and workflow preferences | `src/model-*`, `src/native-model-browser.js`, `src/speed-*`, `src/workflow-*` |
| Plans and billing UI | `src/plan-*.cjs`, `src/billing-*` |
| Image fallback and computer use | `src/vision-*.cjs`, `src/cua-*.cjs` |
| Dot | `src/dot-*`, `src/dot-native/` |
| Native integration, Settings, and tabs | `src/main.cjs`, `src/recovered*`, `src/settings-*`, `src/native-settings-*`, `src/new-tab*`, `src/mixed-tab*`, `src/browser-start.js` |
| Settings and development chat UI | `src/server.cjs`, `src/ui/settings/`, `src/ui/` |
| Automated fixtures | `test/` |

Native integration and Dot renderer tests use the inputs prepared by `npm run prepare:upstream` (or `npm run build`); `E1_CAPTURE_ROOT` and `E1_CHATGPT_CAPTURE` point them elsewhere. They are reported as skipped until the inputs exist; upstream files are never copied into the repository.

`npm test` uses local fixtures and mocked provider responses. It does not verify access to a real subscription, charge an API account, or prove native desktop UI parity. Manual scripts with names such as `*-live`, `*-smoke`, `native-*`, and `record-*` may use locally configured accounts, execute tools, make billable requests, and produce private evidence. They are not run by CI and some require the original local development layout.

A GitHub Actions template is saved at `docs/ci/source-checks.yml`. Automated CI is not enabled in this snapshot. A maintainer with workflow-write access can move it to `.github/workflows/source-checks.yml` to run fixture tests, publication checks, and Gitleaks on pushes and pull requests.

## Publication scope

See [publication notes](docs/publication.md) for excluded material and checks. This is a public source snapshot; no project-wide open-source license has been selected. Third-party packages retain their own licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Provider and product names identify integrations and do not imply affiliation or endorsement.
