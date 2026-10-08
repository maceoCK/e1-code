const path = require("node:path"),
  fs = require("node:fs");
require("./server.cjs")
  .startServer({
    dataDir: process.env.ASTER_DATA || path.join(__dirname, "../.dev-data"),
    port: process.env.ASTER_PORT || 0,
    settingsOnly: process.env.ASTER_PROTOTYPE !== "1",
  })
  .then((s) => {
    fs.writeFileSync(path.join(__dirname, "../.dev-url"), s.url, {
      mode: 0o600,
    });
    console.log("Aster listening:", s.origin);
    process.on("SIGTERM", () => {
      s.close();
      process.exit();
    });
  });
