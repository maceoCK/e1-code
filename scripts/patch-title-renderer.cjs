const fs = require('node:fs'), path = require('node:path');
const file = 'assets/v1/cc924f832-BZLL41oT.js';
const needle = 'let t=document.title,r=document.head,i=new(Me(r))';
// Secondary panes pin the document title with a MutationObserver. Capture the
// same branded title as the display adapter, otherwise the two observers keep
// restoring different strings and starve rendering and input indefinitely.
const replacement = 'let t=document.title.replace(/\\b(?:Claude|Aster)(?: Code)?(?=$| [—–-])/g,"E1 Code"),r=document.head,i=new(Me(r))';
function patch(source) {
  if (source.split(needle).length !== 2) throw Error('Native split-pane title guard changed; review title adapter before building.');
  return source.replace(needle, replacement);
}
module.exports = { patch, file, install(original, target) {
  fs.writeFileSync(path.join(target, file), patch(fs.readFileSync(path.join(original, file), 'utf8')));
} };
