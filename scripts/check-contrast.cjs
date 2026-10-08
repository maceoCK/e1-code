const { chromium } = require("playwright"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
function luminance(c) {
  const rgb = c
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((n) => {
      n /= 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
(async () => {
  const b = await chromium.launch({ headless: true });
  try {
    const p = await b.newPage({ viewport: { width: 1240, height: 850 } });
    await p.goto(fs.readFileSync(".dev-url", "utf8"));
    await p.locator("#providers-nav").waitFor();
    const checks = [];
    for (const dark of [false, true]) {
      const isDark = await p
        .locator("body")
        .evaluate((e) => e.classList.contains("night"));
      if (isDark !== dark) await p.locator("#theme").click();
      await p.waitForFunction(
        (d) => document.body.classList.contains("night") === d,
        dark,
      );
      const colors = await p
        .locator("body")
        .evaluate((e) => ({
          ink: getComputedStyle(e).color,
          bg: getComputedStyle(e).backgroundColor,
        }));
      const vals = [luminance(colors.ink), luminance(colors.bg)].sort(
        (a, b) => b - a,
      );
      const contrast = (vals[0] + 0.05) / (vals[1] + 0.05);
      assert.ok(contrast >= 4.5, JSON.stringify({ dark, colors, contrast }));
      checks.push({ theme: dark ? "night" : "mist", ...colors, contrast });
      await p.screenshot({
        path: `evidence/contrast-${dark ? "night" : "mist"}.png`,
      });
    }
    await p.locator("#theme").click();
    fs.writeFileSync("evidence/contrast.json", JSON.stringify(checks, null, 2));
    console.log(checks);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
