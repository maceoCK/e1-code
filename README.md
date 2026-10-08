# E1 Code

Experimental local AI workspace with multiple provider connections, account-independent chat history, exact-model account routing, and per-chat billing controls.

This repository contains E1 Code's integration layer, gateway, workspace source, tests, and branding. The Claude Desktop application, recovered vendor code, proprietary fonts, native engines, private chats, credentials, and local build outputs are **not included**. The desktop integration requires separately supplied compatible application files; cloning this repository alone does not reproduce the installed Claude-style desktop UI.

## What is here

- **Providers and accounts:** OpenAI Responses, Anthropic Messages, OpenAI-compatible endpoints, Ollama, Pi configuration discovery, ChatGPT plan sign-in, and a bridge to the official local Claude Code CLI.
- **Routing:** multiple accounts, same-model subscription failover, explicit API fallback settings, and separate chat storage that survives connection changes.
- **Per-chat controls:** Plan/API indicators with account details, preferred models and effort for native workflow children, and confirmed paid-API Fast/Ultrafast routing where supported.
- **Workspace components:** chats, Pages, file tools, PTY terminals, browser panels, child chats, and schedules. Native browser hosting requires Electron; schedules run while the host is open.
- **Desktop adapters:** a green theme, E1 branding, logo animation mapping, and narrow model/workflow hooks for one compatible local Claude Desktop capture.

These components have different integration maturity. This is not a claim of complete Claude Desktop feature parity. Model access, plan sharing, billing, speed modes, and CLI behavior depend on the provider and account. Unsupported premium modes fail rather than silently selecting another model.

## Local development

Use Node.js 22.12 or newer and npm. macOS is the primary development target. PTY installation can require the platform's C/C++ build tools.

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

This is a simpler development surface, not the native Claude-style client or the newer Electron workspace. The `src/workspace-preview.cjs` entry is a separate experimental Electron host that currently expects Claude subscription accounts already connected through the native E1 integration.

Development state is stored under `.dev-data/`. `ASTER_DATA` overrides that directory, and `ASTER_PORT` sets a port. Provider keys can be supplied with `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`; the application does not automatically load `.env` files. Browser development keeps entered keys in memory. The desktop host uses Electron's encrypted storage. Pi integration can also read the current user's local provider configuration.

## Native integration

See [native build inputs and commands](docs/native-build.md). The integration is pinned to the captured client version `2.19675.0`; its hooks deliberately reject incompatible layouts. No native app download or compiled desktop release is published here.

The public checkout uses system fonts. Browser dependencies are generated from locked npm packages by `scripts/sync-ui-vendor.cjs`, with their license notices copied alongside them.

## Source map

| Area | Files |
| --- | --- |
| Requests, streaming, and routing | `src/gateway*.cjs`, `src/providers.cjs`, `src/routing.cjs` |
| Account connections and chat persistence | `src/subscriptions.cjs`, `src/claude-*.cjs`, `src/store.cjs`, `src/library-identity.cjs` |
| Models, speed, and workflow preferences | `src/model-*.cjs`, `src/speed-*`, `src/workflow-*` |
| Native integration and billing UI | `src/main.cjs`, `src/recovered*`, `src/billing-*` |
| Standalone workspace | `src/workspace-*.cjs`, `src/ui/workspace/` |
| Settings and development chat UI | `src/server.cjs`, `src/ui/settings/`, `src/ui/` |
| Automated fixtures | `test/` |

`npm test` uses local fixtures and mocked provider responses. It does not verify access to a real subscription, charge an API account, or prove native desktop UI parity. Manual scripts with names such as `*-live`, `*-smoke`, `native-*`, and `record-*` may use locally configured accounts, execute tools, make billable requests, and produce private evidence. They are not run by CI and some require the original local development layout.

A GitHub Actions template is saved at `docs/ci/source-checks.yml`. Automated CI is not enabled in this snapshot. A maintainer with workflow-write access can move it to `.github/workflows/source-checks.yml` to run fixture tests, publication checks, and Gitleaks on pushes and pull requests.

## Publication scope

See [publication notes](docs/publication.md) for excluded material and checks. This is a public source snapshot; no project-wide open-source license has been selected. Third-party packages retain their own licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Provider and product names identify integrations and do not imply affiliation or endorsement.
