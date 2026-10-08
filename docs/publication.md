# Public source snapshot

The initial publication includes the E1 runtime source, UI source, supplied E1/Aster logo, fixture tests, model configuration example, and development/build tools.

Excluded from this repository:

- Original or extracted Claude Desktop/Claude Code applications, native binaries, and proprietary fonts.
- Recovered vendor bundles, generated sprite data, build stages, and compiled apps.
- API credentials, OAuth records, Keychain material, signing identities, local provider configuration, and token-bearing development URLs.
- Chat histories, screenshots, recordings, logs, evidence reports, and backup copies.
- Three historical verification scripts tied to private history snapshots and outdated local evidence: `final-audit.cjs`, `verify-account-library.cjs`, and `verify-claude-billing.cjs`.

The public copy uses system fonts, installs browser dependencies from npm, accepts an explicit local capture path for native builds, and replaces a hardcoded diagnostic session path with an environment variable. Other source was copied from the working E1 project. The original working project and installed application are separate from this checkout.

Before the initial push, the staged Git tree is checked for excluded file classes, scanned with Gitleaks, installed with `npm ci`, and tested with `npm test`. These checks reduce accidental publication risk; they are not a full security audit of the application.

Initial local verification passed: 93 tests, no Gitleaks findings in tracked source, successful development HTTP asset checks, and a native-build preflight that requires explicit local capture inputs. The publishing credential did not have GitHub's separate workflow-write permission, so the CI configuration is included as a template rather than an active workflow.

For future changes, review `git diff --cached` before pushing. Keep runtime data outside the checkout or in ignored paths. `.gitignore` and `npm run check:public` protect common paths, but cannot identify every form of sensitive information. Do not attach private logs or token-bearing URLs to public issues.
