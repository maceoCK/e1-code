'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Remove the E1 settings surface, not the native sandbox policy or IPC layer.
// Claude Desktop 3.1623.0 moved the Claude Code settings rows into
// c8b630735 (export `t`, rendered by the claude-code, notifications and
// full-page settings routes). `Le` mounts both the Local sandbox row and its
// nested Strict sandbox mode row (`Ie`), so unmounting `Le` hides both.
// The search descriptors live in cc7db14f1 (`localSandbox` / `strictSandbox`);
// the settings search indexer skips any descriptor with search.exclude.
const patches = {
  'assets/v1/c8b630735-B15lmU6Q.js': [
    ['f("local")&&n(Ne,{}),f("local")&&n(Le,{})]', 'f("local")&&n(Ne,{})]'],
  ],
  'assets/v1/cc7db14f1-Bfi7uClW.js': [
    ['api:"ClaudeCode.setLocalSandboxEnabled"},platform:"desktop",search:{localSessionRow:!0,codeDesktopRow:!0}',
     'api:"ClaudeCode.setLocalSandboxEnabled"},platform:"desktop",search:{exclude:!0}'],
    ['api:"ClaudeCode.setStrictSandboxMode"},platform:"desktop",search:{localSessionRow:!0,codeDesktopRow:!0}',
     'api:"ClaudeCode.setStrictSandboxMode"},platform:"desktop",search:{exclude:!0}'],
  ],
};
const files = Object.keys(patches);
function patch(file, source) {
  if (!Object.hasOwn(patches, file)) throw Error('Unexpected sandbox settings asset: ' + file);
  for (const [before, after] of patches[file]) {
    if (source.split(before).length !== 2) throw Error('Sandbox settings changed; expected one anchor: ' + file);
    source = source.replace(before, () => after);
  }
  return source;
}
function replacements(original) {
  return new Map(files.map(file => [file, patch(file, fs.readFileSync(path.join(original, file), 'utf8'))]));
}
function install(original, target) {
  const changes = replacements(original);
  for (const [file, source] of changes) fs.writeFileSync(path.join(target, file), source);
}
module.exports = { files, patch, replacements, install };
