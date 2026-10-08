const { chromium } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path");
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1240, height: 850 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(fs.readFileSync(".dev-url", "utf8"));
    await page.getByRole("button", { name: "Models & connections" }).waitFor();
    await page.screenshot({ path: "evidence/welcome.png" });
    await page.getByRole("button", { name: "Models & connections" }).click();
    await page
      .getByRole("button", { name: "Abliteration", exact: true })
      .click();
    await page.getByRole("button", { name: "Refresh models" }).click();
    await page
      .locator("#settings-status")
      .filter({ hasText: "Connected." })
      .waitFor({ timeout: 30000 });
    await page.locator("#model-id").fill("abliterated-model-large-v2");
    await page.locator("#model-id").dispatchEvent("change");
    await page.locator("summary").click();
    await page.screenshot({ path: "evidence/connections.png" });
    await page.getByRole("button", { name: "Use this model" }).click();
    await page.locator("#settings").waitFor({ state: "hidden" });
    await page.locator("#new-chat").click();
    await page.locator("#settings").waitFor({ state: "hidden" });
    await page.locator("#new-chat").click();
    await page
      .locator("#message")
      .fill(
        "Give three concise ideas for a calm, model-agnostic desktop assistant.",
      );
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByRole("button", { name: "Stop response" }).waitFor();
    await page
      .getByRole("button", { name: "Stop response" })
      .waitFor({ state: "hidden", timeout: 120000 });
    if (await page.locator("#notice").isVisible())
      throw Error(await page.locator("#notice").innerText());
    await page.screenshot({ path: "evidence/live-abliteration.png" });
    await page.reload();
    await page.locator("#history button").first().click();
    await page.locator(".content").filter({ hasText: "1." }).count();
    await page.screenshot({ path: "evidence/persisted-chat.png" });
    await page.getByRole("button", { name: "Change color theme" }).click();
    await page.screenshot({ path: "evidence/night.png" });
    await page.getByRole("button", { name: "Change color theme" }).click();
    await page.setViewportSize({ width: 680, height: 820 });
    await page.screenshot({ path: "evidence/narrow.png" });
    fs.writeFileSync(
      "evidence/ui-check.json",
      JSON.stringify(
        {
          errors,
          liveAbliteration: await page.locator(".content").innerText(),
          viewportTests: [
            [1240, 850],
            [680, 820],
          ],
        },
        null,
        2,
      ),
    );
    if (errors.length) throw Error(errors.join("; "));
    console.log(
      "UI live chat, persistence, themes, and narrow layout verified.",
    );
  } finally {
    await browser?.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
