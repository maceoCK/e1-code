# Text-only image fallback

E1 Code's Messages gateway replaces image blocks for explicitly text-only models (and legacy abliterated model IDs without modality metadata) with descriptions from a configured vision connection, `gpt-6-luna` by default. Direct image attachments and nested tool-result screenshots are covered. Vision-capable models keep the original image inputs.

The helper receives bounded task context plus the image, not the full chat or tool definitions. Its output is labeled as delegated evidence. The primary model, original conversation, and tool IDs stay unchanged.

## Limits and failure handling

- An existing connected ChatGPT subscription is preferred. API delegation requires the existing `allowApiFallback` setting.
- There is no automatic switch to an unrelated provider or a different main model.
- 90-second total analysis deadline, at most eight new analyses per request, 12 MiB encoded image limit, 1 MiB response limit.
- The newest images are processed first, so old uncached history cannot starve current screenshots.
- Only completed descriptions are cached, in memory, for 15 minutes and at most 64 entries. Mutable URL images are not reused.
- Cancellation and account disconnection stop helper work. Errors become explicit text placeholders; unsupported image payloads never reach the text-only model on this path.

## Local Bash sandbox default

The same update sets `coworkEgressAllowedHosts: ["*"]` in E1's generated local deployment configuration. Without it, the supported setting's absence imposed an endpoint-only network policy that forced the Bash sandbox on even with the Local sandbox preference off. The **Local sandbox** and **Strict sandbox mode** rows are removed from Settings → Claude Code. The sandbox engine, explicit project settings, forced session constraints, and genuine managed policies are unchanged and can still require sandboxing.

## Code

`src/vision-fallback.cjs` and `src/vision-provider.cjs`, with tests in `test/vision-fallback*.test.cjs`. The one-shot updater for an existing install is `scripts/install-vision-fallback.cjs`; see [native builds](native-build.md#in-place-updaters).
