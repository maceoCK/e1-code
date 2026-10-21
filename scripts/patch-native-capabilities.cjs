// Extend the native catalog with our provider aliases. All policy/cap/default
// handling after this resolver remains in the captured client.
// Captured client 3.1623.0: resolver L9t (was SUt), catalog row thinking Sw (was
// nw), managed CLI settings JJt (was _Tr; deps now injected via `t`, so the
// "needs update" set is `r=t.modelNamesNeedingUpdate?.(list)` and may be undefined).
const fs = require("node:fs");
const path = require("node:path");
const file = ".vite/build/index.chunk-BLvpT1n4.js";
const needle = "function L9t(e){";
const outputNeedle = "thinking:Sw(t,i.id,e)";
const pickerNeedle = "a=qJt(ZMe(e),n);return{...i?.length";
function patch(original) {
  if (original.split(needle).length !== 2) throw Error("Native thinking resolver changed; review capability patch before building.");
  if (original.split(outputNeedle).length !== 2) throw Error("Native catalog output changed; review Ultracode integration before building.");
  if (original.split(pickerNeedle).length !== 2) throw Error("Native managed model settings changed; review model picker integration before building.");
  return original.replace(needle, needle + 'const asterThinking=require("../../aster/model-effort.cjs").nativeThinking(e);if(asterThinking)return asterThinking;')
    .replace(outputNeedle, 'thinking:require("../../aster/model-effort.cjs").withUltracode(t,i.id,Sw(t,i.id,e))')
    .replace(pickerNeedle, 'a=qJt(ZMe(e),n);return{...require("../../aster/model-picker.cjs").nativePicker(e.models?.list,r),...i?.length');
}
module.exports = function patchNativeCapabilities(capture, stage) {
  const original = fs.readFileSync(path.join(capture, "extracted/app", file), "utf8");
  fs.writeFileSync(path.join(stage, file), patch(original));
};
module.exports.file = file;
module.exports.patch = patch;
