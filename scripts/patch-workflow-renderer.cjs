const fs = require('node:fs'), path = require('node:path');
// Captured client 3.1623.0: effort option mapper XM (was vD) with zod enum GM
// (was dD), exported from shared-6 and consumed by the workflow hook in
// c9543da06 (`P=Pt(v(h))`, `_e=P?.some(id==="xhigh")` gates ultracodeAvailable).
const file = 'assets/v1/shared-6-WOQhV7s4.js';
const needle = 'function XM(e){return e.flatMap(e=>{let t=GM.safeParse(e.id);';
// The native effort hook uses xhigh to recognize workflow eligibility. A
// dedicated Ultracode entry supplies that local capability without inventing
// an Extra reasoning option for providers that do not implement one.
const replacement = 'function XM(e){const workflowOnly=e.some(t=>t.id==="ultracode")&&!e.some(t=>t.id==="xhigh");return e.flatMap(e=>{let t=GM.safeParse(workflowOnly&&e.id==="ultracode"?"xhigh":e.id);';
function patch(source) {
  if (source.split(needle).length !== 2) throw Error('Native effort hook changed; review workflow adapter before building.');
  return source.replace(needle, replacement);
}
module.exports = { patch, file, install(original, target) {
  fs.writeFileSync(path.join(target, file), patch(fs.readFileSync(path.join(original, file), 'utf8')));
} };
