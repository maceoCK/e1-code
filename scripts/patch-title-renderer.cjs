const fs = require('node:fs'), path = require('node:path');
// Captured client 3.1623.0: the pane title guard moved out of the tile-layout
// module into c9543da06 (function pf({title,paneIndex,siteName})); the
// MutationObserver factory is `j` (was `Me`).
const file = 'assets/v1/c9543da06-CYXHevj2.js';
const needle = 'let e=document.title,n=document.head,r=new(j(n))';
// Secondary panes pin the document title with a MutationObserver. Capture the
// same branded title as the display adapter, otherwise the two observers keep
// restoring different strings and starve rendering and input indefinitely.
const replacement = 'let e=document.title.replace(/\\b(?:Claude|Aster)(?: Code)?(?=$| [—–-])/g,"E1 Code"),n=document.head,r=new(j(n))';
function patch(source) {
  if (source.split(needle).length !== 2) throw Error('Native split-pane title guard changed; review title adapter before building.');
  return source.replace(needle, replacement);
}
module.exports = { patch, file, install(original, target) {
  fs.writeFileSync(path.join(target, file), patch(fs.readFileSync(path.join(original, file), 'utf8')));
} };
