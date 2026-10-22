// Review the Git index so force-added local artifacts cannot evade .gitignore.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
if (!files.length) throw Error('No tracked files to check. Stage the source first.');
const forbidden = /(^|\/)(?:node_modules|vendor|dist|outputs|evidence|captures?|work|recovered-runtime|signing|\.package|\.icon\.iconset|\.dev-data|\.demo-data|\.claude|\.codex|\.pi)(?:\/|$)|(?:^|\/)\.env(?:\..*)?$|\.(?:app|asar|dmg|ipa|woff2?|pem|key|p12|pfx|keychain(?:-db)?|jsonl|log)(?:\/|$)|(?:^|\/)(?:\.dev-url|workspace\.json|chat-library\.json|subscription-accounts\.json|claude-accounts\.json|settings-ui\.json|library-identity\.json|aster-gateway\.json|auth\.json|credentials\.json|secrets\.json)$/i;
const problems = [];
for (const file of files) {
  // The repository ships the app's bundled UI fonts, vendored browser libraries,
  // and the pinned upstream vendor archives as hash-checked split parts.
  const shipped = /^src\/ui\/(?:fonts\/[\w-]+\.woff2|vendor\/[\w.-]+)$/.test(file)
    || /^upstream\/[^/]+\.parts\/(?:manifest\.json|part-\d{2})$/.test(file);
  if (forbidden.test(file) && !shipped && file !== '.env.example') problems.push(file + ': excluded artifact or private data path');
  const item = path.join(root, file);
  if (!fs.existsSync(item)) { problems.push(file + ': tracked file missing'); continue; }
  if (fs.lstatSync(item).isSymbolicLink()) { problems.push(file + ': symlinks are not allowed in the public snapshot'); continue; }
  if (/^upstream\/[^/]+\.parts\//.test(file)) continue; // binary parts: skip size and content checks
  const content = fs.readFileSync(item);
  if (content.length > 1024 * 1024) problems.push(file + ': unexpectedly large source file');
  if (/\/(?:Users|home)\/[\w.-]+\//.test(content.toString('utf8'))) problems.push(file + ': absolute personal home path');
}
// The committed parts must reassemble into exactly the pinned upstream archives.
if (files.some(file => /^upstream\//.test(file))) {
  try { execFileSync('node', [path.join(root, 'scripts/verify-committed-upstream.cjs')], { stdio: 'inherit' }); }
  catch { problems.push('committed upstream parts do not verify'); }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else console.log(`Checked ${files.length} tracked files; no excluded artifacts or personal home paths.`);
