const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
module.exports = function buildBrowserStorage(base, destination) {
  const candidates = [process.env.E1_NODE_HEADERS,
    path.resolve(process.execPath, '../../include/node'),
    path.join(os.homedir(), 'Library/Caches/node-gyp', process.versions.node, 'include/node'),
    path.join(os.homedir(), '.cache/node-gyp', process.versions.node, 'include/node')].filter(Boolean);
  const headers = candidates.find(directory => fs.existsSync(path.join(directory, 'node_api.h')));
  if (!headers) throw Error('Node-API headers are required. Run npx node-gyp install, or set E1_NODE_HEADERS to the directory containing node_api.h.');
  execFileSync('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-O2', '-Wno-deprecated-declarations', '-bundle', '-undefined', 'dynamic_lookup',
    '-framework', 'Foundation', '-framework', 'Security', '-I', headers, path.join(base, 'native/browser-storage.m'), '-o', destination], { stdio: 'pipe' });
};
