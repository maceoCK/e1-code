'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Remove the E1 settings surface, not the native sandbox policy or IPC layer.
// _i mounts both Local sandbox and its nested Strict sandbox mode row.
const patches = {
  'assets/v1/c71860c77-CDc2iaLc.js': [
    ['l(wi,{}),l(yi,{}),l(mi,{}),l(_i,{})', 'l(wi,{}),l(yi,{}),l(mi,{})'],
  ],
  'assets/v1/c7357c32b-m4MxPvkb.js': [
    ['api:"ClaudeCode.setLocalSandboxEnabled"},platform:"desktop",search:{localSessionRow:!0}',
     'api:"ClaudeCode.setLocalSandboxEnabled"},platform:"desktop",search:{exclude:!0}'],
    ['api:"ClaudeCode.setStrictSandboxMode"},platform:"desktop",search:{localSessionRow:!0}',
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
