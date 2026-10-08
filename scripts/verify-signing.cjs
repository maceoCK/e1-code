const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const signing = require('./signing.cjs').configuration();

assert.notEqual(signing.identity, '-', 'Configure a persistent signing identity first.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-sign-check-'));
function command(args) {
  const result = cp.spawnSync('/usr/bin/codesign', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout + result.stderr;
}
try {
  const versions = [];
  for (const version of [1, 2]) {
    const source = path.join(temporary, 'check.c');
    const binary = path.join(temporary, 'check');
    fs.writeFileSync(source, `int main(void) { return ${version}; }\n`);
    cp.execFileSync('/usr/bin/clang', [source, '-o', binary]);
    command(['--force', '--sign', signing.identity, ...signing.args,
      '--identifier', 'local.aster.signing-check', binary]);
    command(['--verify', '--strict', binary]);
    const detail = command(['--display', '--verbose=4', binary]);
    const requirementOutput = command(['--display', '--requirements', '-', binary]);
    const cdhash = detail.match(/^CDHash=(\S+)/m)?.[1];
    const requirement = requirementOutput.match(/^designated => (.+)$/m)?.[1];
    assert.ok(cdhash, 'Missing CDHash diagnostic.');
    assert.ok(requirement, 'Missing designated requirement.');
    assert.ok(!requirement.includes('cdhash'), 'Requirement must not depend on a build hash.');
    versions.push({ version, cdhash, requirement, strictVerification: true });
  }
  assert.notEqual(versions[0].cdhash, versions[1].cdhash);
  assert.equal(versions[0].requirement, versions[1].requirement);
  const evidence = { checkedAt: new Date().toISOString(), identity: signing.identity,
    changedCodeRetainsIdentity: true, versions };
  fs.writeFileSync(path.resolve(__dirname, '../evidence/signing-continuity.json'),
    JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
