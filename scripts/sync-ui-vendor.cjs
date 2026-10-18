// Materialize browser dependencies from the locked npm packages, with licenses.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'src/ui/vendor');
const files = {
  'marked/lib/marked.umd.js': 'marked.umd.js',
  'marked/LICENSE.md': 'marked-LICENSE.md',
  'dompurify/dist/purify.min.js': 'purify.min.js',
  'dompurify/LICENSE': 'dompurify-LICENSE',
  'dompurify/LICENSE-MPL': 'dompurify-LICENSE-MPL',
};
fs.mkdirSync(output, { recursive: true });
for (const [source, name] of Object.entries(files))
  fs.copyFileSync(path.join(root, 'node_modules', source), path.join(output, name));
console.log('Prepared browser dependencies and license notices.');
