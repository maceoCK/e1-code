const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
module.exports = function enginePath(version = "2.1.286") {
  for (const profile of ["Aster-Workspace-3p", "Claude"]) {
    const root = path.join(os.homedir(), "Library/Application Support", profile, "claude-code", version);
    if (!fs.existsSync(root)) continue;
    for (const build of fs.readdirSync(root).sort()) {
      const binary = path.join(root, build, "claude.app/Contents/MacOS/claude");
      if (fs.existsSync(binary)) return binary;
    }
  }
  throw Error(`Captured engine ${version} is unavailable in the Aster or Claude profile.`);
};
