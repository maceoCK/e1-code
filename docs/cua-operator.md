# Vision-grounded CUA operator

Lets a text-only planner model operate native windows through the CUA driver, using a vision model only to ground and verify one action at a time.

## Architecture

The selected text-only model remains the planner. When its latest tool result is a usable native CUA window capture, the gateway advertises a virtual `E1CuaStep` tool with a goal, the observation call ID, and an expected outcome. The vision helper (`gpt-6-luna` by default) sees the original screenshot, bounded UI evidence, and the available action schemas, then proposes one action or declines.

The gateway validates the proposal and compiles it into an ordinary native CUA tool call. **It never clicks or types itself.** The virtual tool never reaches the native executor; the compiled call goes through the existing permission and approval path.

After the action result, the gateway requests a fresh capture of the same window through the normal tool loop. The helper checks the expected outcome and answers `satisfied`, `unsatisfied`, or `unknown`. A successful dispatch is not treated as a successful task.

## Scope

- Explicitly text-only routes over OpenAI Responses, Chat-compatible, and Ollama protocols.
- `mcp__cua-driver__get_window_state` observations with background click, typing, key, and scroll primitives.
- Exact process/window/session binding and observed element tokens. Pixel targeting needs known screenshot dimensions and in-bounds coordinates; desktop AX frames are never treated as screenshot pixels.

Browser-specific, full-desktop, foreground/escalation, and scripting actions are not compiled. Their ordinary native tools stay available, and the planner is never forced to use the operator.

## Boundaries

- No new executor, MCP service, credentials, runtime, Electron fuse change, or permission-mode change.
- Eligible planner responses are buffered until validated; unrelated turns keep normal streaming.
- No persisted screenshots or cached action proposals. Pending verifications and exact-retry verdicts are RAM-only and bounded.
- Incomplete, filtered, cancelled, stale, mismatched, or malformed proposals produce no action.
- Semantic targets need an explicit, acyclic ancestry to the captured window. Other windows, separate menu-bar roots, and orphaned nodes cannot become targets.
- A permission denial does not trigger an alternate delivery route.
- Screenshots and UI text are evidence, not instructions.

## Limits

Each helper inference has a 45-second deadline. Pending verifications and exact-retry verdicts are each capped at 64 entries and 120 seconds. Exact history and schema matching deliberately yields `unknown` after compaction or changed tool definitions rather than associating a result with the wrong action. Helper usage is not itemized separately in the usage display.

## Code

`src/cua-operator.cjs` and `src/cua-evidence.cjs`, with tests in `test/cua-*.test.cjs`. The one-shot updater for an existing install is `scripts/install-cua-operator.cjs`; see [native builds](native-build.md#in-place-updaters).
