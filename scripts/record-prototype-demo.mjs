import {
  launchSession,
  EventLog,
  composeVideo,
  writeMetadata,
  deriveChapters,
} from "screencli";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const out = path.resolve(process.env.ASTER_DEMO_DIR || "../outputs/aster-desktop/demo-verified");
fs.mkdirSync(out, { recursive: true });
const native = path.join(
  os.homedir(),
  "Library/Application Support/Aster/local-ui.json",
);
const url = fs.existsSync(native)
  ? JSON.parse(fs.readFileSync(native)).url
  : fs.readFileSync(".dev-url", "utf8");
const viewport = { width: 1440, height: 1000 };
const session = await launchSession({
  viewport,
  headless: true,
  slowMo: 90,
  recordDir: out,
});
const log = new EventLog(path.join(out, "events.json")),
  page = session.page;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const event = (type, description, box) =>
  log.append({ type, description, viewport, bounding_box: box });
async function click(locator, description) {
  const box = await locator.boundingBox();
  event("click", description, box);
  await locator.click();
}
async function hold(ms, description) {
  event("wait", description);
  await page.waitForTimeout(ms);
}
async function send(text) {
  await page.locator("#message").fill(text);
  event("type", text, await page.locator("#message").boundingBox());
  await hold(900, "Read prompt");
  await click(
    page.getByRole("button", { name: "Send message" }),
    "Send to selected provider",
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".message.user").length > 0,
  );
  await page
    .getByRole("button", { name: "Stop response" })
    .waitFor({ state: "hidden", timeout: 180000 });
  if (await page.locator("#notice").isVisible())
    throw Error(await page.locator("#notice").innerText());
  event("done", "Real provider response complete");
  await hold(3000, "Read the model response");
}
try {
  await page.goto(url);
  await page.locator("#selected-model").waitFor();
  await page.locator("#new-chat").click();
  event("navigate", "Aster multi-model workspace");
  await hold(2000, "New Aster icon and mist theme");
  await page.screenshot({ path: path.join(out, "welcome.png") });
  await click(
    page.getByRole("button", { name: "Models & connections" }),
    "Open model connections",
  );
  await click(
    page.getByRole("button", { name: "Abliteration", exact: true }),
    "Choose Pi’s Abliteration connection",
  );
  await click(
    page.getByRole("button", { name: "Refresh models" }),
    "Discover live Abliteration models",
  );
  await page
    .locator("#settings-status")
    .filter({ hasText: "Connected." })
    .waitFor({ timeout: 30000 });
  await page.locator("#model-id").fill("abliterated-model-large-v2");
  await page.locator("#model-id").dispatchEvent("change");
  await click(page.locator("summary"), "Inspect the model-specific prompt");
  await hold(2200, "Abliterated prompt profile");
  await page.locator("#prompt-preview").scrollIntoViewIfNeeded();
  event("scroll", "Read the prompt profile");
  await hold(2200, "Direct prompt without Claude identity");
  await click(
    page.getByRole("button", { name: "Use this model" }),
    "Use Abliteration Large v2",
  );
  await page.locator("#settings").waitFor({ state: "hidden" });
  await send(
    "Write three short names for a quiet cabin by the sea. One line each.",
  );
  await page.screenshot({ path: path.join(out, "abliteration.png") });
  await click(
    page.getByRole("button", { name: "Change color theme" }),
    "Switch to the night palette",
  );
  await hold(1600, "Night theme");
  await click(
    page.locator("#model-button"),
    "Switch model in the same conversation",
  );
  await click(
    page.getByRole("button", { name: "Ollama", exact: true }),
    "Choose a local model",
  );
  await click(
    page.getByRole("button", { name: "Refresh models" }),
    "Discover models running on this Mac",
  );
  await page
    .locator("#settings-status")
    .filter({ hasText: "Connected." })
    .waitFor({ timeout: 30000 });
  await page.locator("#model-id").fill("qwen3.5:9b");
  await page.locator("#model-id").dispatchEvent("change");
  await hold(1500, "Local Qwen connection");
  await click(
    page.getByRole("button", { name: "Use this model" }),
    "Switch to Qwen 3.5",
  );
  await page.locator("#settings").waitFor({ state: "hidden" });
  await send(
    "Choose your favorite of those three names and explain why in one sentence.",
  );
  await page.screenshot({ path: path.join(out, "qwen.png") });
  await click(
    page.getByRole("button", { name: "Change color theme" }),
    "Return to mist",
  );
  await click(page.locator("#model-button"), "Show other model connections");
  await click(
    page.getByRole("button", { name: "OpenAI", exact: true }),
    "Show OpenAI Responses configuration",
  );
  await page.locator("#prompt-details").evaluate((e) => (e.open = false));
  await click(
    page.getByRole("button", { name: "Refresh models" }),
    "Discover available OpenAI models",
  );
  await page
    .locator("#settings-status")
    .filter({ hasText: "Connected." })
    .waitFor({ timeout: 30000 });
  await page.locator("#model-id").fill("gpt-5.4-mini");
  await page.locator("#model-id").dispatchEvent("change");
  await click(page.locator("summary"), "See the reasoning-model prompt");
  await page.locator("#effort").selectOption("low");
  await page.locator("#prompt-preview").scrollIntoViewIfNeeded();
  await hold(2200, "Short instructions tuned for a reasoning model");
  await page.screenshot({ path: path.join(out, "openai-setup.png") });
  await click(
    page.getByRole("button", { name: "Use this model" }),
    "Use OpenAI GPT-5.4 mini",
  );
  await page.locator("#settings").waitFor({ state: "hidden" });
  await send(
    "Write a welcoming five-word tagline for the cabin with the name just chosen.",
  );
  await page.screenshot({ path: path.join(out, "openai.png") });
  await hold(1500, "Conversation preserved across three providers");
  event("done", "Demo complete");
  log.flush();
  const duration = log.getDurationMs();
  const raw = await session.close();
  writeMetadata(path.join(out, "metadata.json"), {
    id: "aster-demo",
    created_at: new Date().toISOString(),
    url: new URL(url).origin,
    prompt:
      "Aster branding, model discovery, prompt adaptation, real Abliteration chat, local Qwen follow-up, theme change, and real OpenAI reasoning-model response.",
    model: "deterministic ScreenCLI walkthrough; real provider calls",
    viewport,
    duration_ms: duration,
    raw_video_path: raw,
    event_log_path: path.join(out, "events.json"),
    chapters: deriveChapters(log.getEvents()),
    agent_stats: {
      total_actions: log.getEvents().length,
      input_tokens: 0,
      output_tokens: 0,
    },
  });
  if (errors.length) throw Error(errors.join("; "));
  await composeVideo({
    rawVideoPath: raw,
    events: log.getEvents(),
    outputPath: path.join(out, "aster-demo.mp4"),
    viewport,
    zoom: false,
    highlight: true,
    cursor: true,
    background: {
      gradient: "forest",
      padding: 5,
      cornerRadius: 16,
      shadow: true,
    },
    preset: "veryfast",
  });
  console.log("DEMO_COMPLETE", path.join(out, "aster-demo.mp4"));
} catch (e) {
  await page.screenshot({ path: path.join(out, "error.png") }).catch(() => {});
  log.flush();
  await session.close().catch(() => {});
  throw e;
}
