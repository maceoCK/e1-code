const fs = require('node:fs'), path = require('node:path');
const file = 'assets/v1/shared-14-CrWlqgDk.js';
const needle = 'function vD(e){return e.flatMap(e=>{let t=dD.safeParse(e.id);';
// The native effort hook uses xhigh to recognize workflow eligibility. A
// dedicated Ultracode entry supplies that local capability without inventing
// an Extra reasoning option for providers that do not implement one.
const replacement = 'function vD(e){const workflowOnly=e.some(t=>t.id==="ultracode")&&!e.some(t=>t.id==="xhigh");return e.flatMap(e=>{let t=dD.safeParse(workflowOnly&&e.id==="ultracode"?"xhigh":e.id);';
function patch(source) {
  if (source.split(needle).length !== 2) throw Error('Native effort hook changed; review workflow adapter before building.');
  return source.replace(needle, replacement);
}
module.exports = { patch, file, install(original, target) {
  fs.writeFileSync(path.join(target, file), patch(fs.readFileSync(path.join(original, file), 'utf8')));
} };
