# CLIProxyAPI bundled runtime

Pinned official upstream release: 8.0.30, Darwin ARM64. The binary is not forked.
`manifest.json` records the official archive and the verified binary hash. Download
that archive, verify its SHA-256, and extract `cli-proxy-api` into this directory
before packaging. The build verifies the binary hash, includes the MIT license,
and signs the executable with E1's application identity before sealing the bundle.

E1 launches a private loopback helper with a separate auth directory, not the
user's independently installed CLIProxyAPI services. E1 retains stable IDs,
conversation storage, explicit account pins, reset-first policy and persistent
session affinity. Per-account model prefixes keep attribution exact; CPA owns
provider protocols, token refresh, and credential-level cooldown. E1 handles
cross-account policy and retry before output is exposed. There is no model
substitution and no automatic paid fallback beyond the user's saved policy.

Run `python3 third_party/cliproxyapi/fetch.py` to reproduce the verified runtime.

The app's `Aster/cliproxyapi/auth` folder becomes authoritative for migrated
refresh tokens. The original CLI profiles and Keychain entries are retained for
recovery, but may contain old token generations after CPA refreshes. A rollback
to the old engine must transfer the current CPA credentials back into those
profiles (or reconnect); restoring just an old app bundle is insufficient.
