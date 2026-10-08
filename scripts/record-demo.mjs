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
  "Library/Application Support/Aster/settings-ui.json",
);
const url = process.env.ASTER_DEMO_URL_FILE ? fs.readFileSync(process.env.ASTER_DEMO_URL_FILE, "utf8").trim() : fs.existsSync(native)
  ? JSON.parse(fs.readFileSync(native)).url
  : fs.readFileSync(".dev-url", "utf8");
const viewport = { width: 840, height: 790 };
const session = await launchSession({
  viewport,
  headless: true,
  slowMo: 90,
  recordDir: out,
});
const log = new EventLog(path.join(out, "events.json")),
  page = session.page;
page.setDefaultNavigationTimeout(45000);
page.setDefaultTimeout(45000);
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
try {
  await page.goto(url);
  await page.locator('#provider-name').waitFor();
  event('navigate', 'Aster model settings in the native workspace');
  await hold(1800, 'Aster model settings');
  for (const [provider, model, frame] of [
    ['Abliteration', 'abliterated-model-large-v2', 'abliteration'],
    ['Ollama', 'qwen3.5:9b-aster-128k', 'qwen'],
    ['OpenAI', 'gpt-5.4-mini', 'openai'],
  ]) {
    await click(page.getByRole('button', {name: provider, exact: true}), `Choose ${provider}`);
    await click(page.getByRole('button', {name: 'Refresh models'}), `Discover ${provider} models`);
    await page.locator('#settings-status').filter({hasText: 'Connected.'}).waitFor({timeout: 30000});
    await page.locator('#model-id').fill(model);
    await page.locator('#model-id').dispatchEvent('change');
    await page.locator('#prompt-details').evaluate(element => { element.open = true; });
    await page.locator('#prompt-preview').scrollIntoViewIfNeeded();
    event('scroll', `Read ${provider} prompt profile`);
    await hold(2500, `${provider} model and prompt settings`);
    await page.screenshot({path: path.join(out, frame + '.png')});
  }
  await page.locator('#prompt-details').evaluate(element => { element.open = false; });
  await click(page.getByRole('button', {name: 'Save changes'}), 'Save OpenAI workspace configuration');
  await page.locator('#settings-status').filter({hasText: 'Saved.'}).waitFor();
  await hold(2200, 'Saved configuration for the recovered native workspace');
  await page.screenshot({path: path.join(out, 'settings-saved.png')});
  event('done', 'Model settings demo complete');
  log.flush();
  const duration = log.getDurationMs();
  const raw = await session.close();
  writeMetadata(path.join(out, "metadata.json"), {
    id: "aster-demo",
    created_at: new Date().toISOString(),
    url: new URL(url).origin,
    prompt:
      "Aster model settings: live model discovery and prompt profiles for Abliteration, local Qwen, and OpenAI. Chat occurs only in the recovered native workspace, not in this settings window.",
    model: "deterministic ScreenCLI settings walkthrough; real model discovery",
    runtime: process.env.ASTER_DEMO_URL_FILE ? "isolated settings preview" : "native app backend",
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
  throw new Error(String(e.message).replaceAll(new URL(url).hash, "#[redacted]"));
}
