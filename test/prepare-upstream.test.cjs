const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const upstream = require('../scripts/prepare-upstream.cjs');
const { pins } = upstream;

test('upstream pins use official HTTPS hosts and complete Developer ID identities', () => {
  const hosts = { claude: 'downloads.claude.ai', chatgpt: 'persistent.oaistatic.com' };
  for (const key of ['claude', 'chatgpt']) {
    const pin = pins[key];
    const url = new URL(pin.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.host, hosts[key]);
    assert.match(pin.teamId, /^[A-Z0-9]{10}$/);
    assert.match(pin.asarHeaderSha256, /^[a-f0-9]{64}$/);
    assert.ok(pin.url.includes(pin.version), key + ' URL names its pinned version');
    assert.equal(pin.arch, 'arm64');
    assert.ok(pin.url.includes(key === 'claude' ? '/darwin/arm64/' : '-darwin-arm64-'), key + ' URL is the arm64 release the asar hash pins');
    assert.ok(pin.capture.startsWith('captures/'), key + ' capture stays in the gitignored captures/ tree');
  }
});

test('private release assets are pinned by SHA-256 and named for their pinned versions', () => {
  const { release } = pins;
  assert.match(release.repo, /^[\w.-]+\/[\w.-]+$/);
  assert.ok(release.tag.includes(pins.claude.version) && release.tag.includes(pins.chatgpt.version));
  for (const key of ['claude', 'chatgpt', 'cliproxyapi']) {
    const asset = release.assets[key];
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(asset.name.includes('darwin-arm64'));
  }
  assert.ok(release.assets.claude.name.includes(pins.claude.version));
  assert.ok(release.assets.chatgpt.name.includes(pins.chatgpt.version));
  const proxy = require('../third_party/cliproxyapi/manifest.json');
  assert.ok(release.assets.cliproxyapi.name.includes(proxy.version));
  assert.equal(release.assets.cliproxyapi.sha256, proxy.binarySha256);
});

test('patch adapters target the pinned upstream versions', () => {
  const dot = require('../scripts/patch-dot-native.cjs');
  assert.equal(dot.build, Number(pins.chatgpt.build));
  assert.ok(fs.readFileSync(path.join(__dirname, '../scripts/build.cjs'), 'utf8').includes('upstream.pins.claude.version'));
  assert.ok(fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8').split('\n').includes('captures/'));
});

test('verification refuses anything that is not the pinned signed app', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-upstream-'));
  try {
    assert.deepEqual(await upstream.verifyApp(directory, pins.chatgpt), ['not an application bundle']);
    const fake = path.join(directory, 'ChatGPT.app/Contents');
    fs.mkdirSync(fake, { recursive: true });
    fs.writeFileSync(path.join(fake, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${pins.chatgpt.bundleId}</string><key>CFBundleShortVersionString</key><string>${pins.chatgpt.version}</string><key>CFBundleVersion</key><string>${pins.chatgpt.build}</string></dict></plist>`);
    const problems = await upstream.verifyApp(path.dirname(fake), pins.chatgpt);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /code signature does not verify/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('an installed pinned app passes the same checks as a download', { skip: !fs.existsSync(pins.claude.installed) && 'Claude Desktop is not installed' }, async t => {
  const problems = await upstream.verifyApp(pins.claude.installed, pins.claude);
  if (problems.some(problem => /version|build/.test(problem))) return t.skip('installed Claude Desktop is a different version');
  assert.deepEqual(problems, []);
});
