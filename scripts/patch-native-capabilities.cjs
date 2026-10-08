// Extend the native catalog with our provider aliases. All policy/cap/default
// handling after this resolver remains in the captured client.
const fs = require("node:fs");
const path = require("node:path");
module.exports = function patchNativeCapabilities(capture, stage) {
  const file = ".vite/build/index.chunk-BZdcw7TE.js";
  const original = fs.readFileSync(path.join(capture, "extracted/app", file), "utf8");
  const needle = "function SUt(e){";
  if (original.split(needle).length !== 2) throw Error("Native thinking resolver changed; review capability patch before building.");
  const outputNeedle = "thinking:nw(t,n.id,e)";
  if (original.split(outputNeedle).length !== 2) throw Error("Native catalog output changed; review Ultracode integration before building.");
  const patched = original.replace(needle, needle + 'const asterThinking=require("../../aster/model-effort.cjs").nativeThinking(e);if(asterThinking)return asterThinking;')
    .replace(outputNeedle, 'thinking:require("../../aster/model-effort.cjs").withUltracode(t,n.id,nw(t,n.id,e))');
  fs.writeFileSync(path.join(stage, file), patched);
};
