// Native fixture: two differently signed application builds use one stable
// helper and a disposable Keychain item. No real E1 credentials are accessed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const base = path.resolve(__dirname, '..');
const signing = require('./signing.cjs').configuration();
if (signing.identity === '-') throw Error('This check requires the local signing identity.');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-keychain-fixture-'));
const service = 'E1-Keychain-Fixture-' + crypto.randomUUID();
const helper = path.join(directory, 'helper');
const browserServices = [];
const run = (file, args, input) => execFileSync(file, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
const sign = (file, identifier) => run('/usr/bin/codesign', ['--force', '--sign', signing.identity, ...signing.args, '--identifier', identifier, '--timestamp=none', file]);
try {
  run('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-O2', '-Wno-deprecated-declarations', '-framework', 'Foundation', '-framework', 'Security',
    '-DE1_KEYCHAIN_SERVICE="' + service + '"', '-DE1_KEYCHAIN_ACCOUNT="Fixture"', path.join(base, 'native/keychain-helper.m'), '-o', helper]);
  sign(helper, 'local.aster.keychain-helper-fixture');
  const parentSource = path.join(directory, 'parent.m');
  fs.writeFileSync(parentSource, `#import <Foundation/Foundation.h>
#import <Security/Security.h>
extern NSString *E1PrepareBrowserStorage(NSString *, NSError **);
int main() { @autoreleasepool {
  NSData *input = [[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
  NSDictionary *request = [NSJSONSerialization JSONObjectWithData:input options:0 error:NULL];
  if ([request[@"operation"] isEqual:@"prepare"]) {
    NSError *error=nil;
    NSString *name=E1PrepareBrowserStorage(@${JSON.stringify(helper)}, &error);
    if (!name) { fprintf(stderr,"%s",error.localizedDescription.UTF8String); return 3; }
    NSData *result=[NSJSONSerialization dataWithJSONObject:@{@"data":[[name dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0]} options:0 error:NULL];
    [[NSFileHandle fileHandleWithStandardOutput] writeData:result];
    return 0;
  }
  NSTask *task = [NSTask new]; task.executableURL = [NSURL fileURLWithPath:@${JSON.stringify(helper)}];
  NSPipe *pipe = [NSPipe pipe]; task.standardInput = pipe;
  NSPipe *output = [NSPipe pipe]; task.standardOutput = output; task.standardError = [NSFileHandle fileHandleWithStandardError];
  if (![task launchAndReturnError:NULL]) return 2;
  [[pipe fileHandleForWriting] writeData:input]; [[pipe fileHandleForWriting] closeFile];
  NSData *result = [[output fileHandleForReading] readDataToEndOfFile];
  [task waitUntilExit];
  if (task.terminationStatus) return task.terminationStatus;
  [[NSFileHandle fileHandleWithStandardOutput] writeData:result];
  return PHASE == 1 ? 0 : 0;
} }
const char *fixtureBuild = BUILD_LABEL;
`);
  const parents = [1, 2].map(version => {
    const file = path.join(directory, 'parent-' + version);
    run('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-Wno-deprecated-declarations', '-framework', 'Foundation', '-framework', 'Security', '-DPHASE=' + version, '-DBUILD_LABEL="build-' + version + '"', '-DE1_STORAGE_FIXTURE', path.join(base, 'native/browser-storage.m'), parentSource, '-o', file]);
    sign(file, 'local.aster.desktop');
    return file;
  });
  const hashes = parents.map(file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  if (hashes[0] === hashes[1]) throw Error('The fixture application builds must differ.');
  const call = (parent, operation, data) => JSON.parse(run(parent, [], JSON.stringify({ operation, data: data.toString('base64') }))).data;
  for (const parent of parents) {
    const signature = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', parent], { encoding: 'utf8' }).stderr;
    browserServices.push('E1 Browser ' + signature.match(/^CDHash=(.+)$/m)[1]);
    const name = Buffer.from(call(parent, 'prepare', Buffer.alloc(0)), 'base64').toString();
    if (name !== browserServices.at(-1)) throw Error('Unexpected storage identity.');
    if (name !== Buffer.from(call(parent, 'prepare', Buffer.alloc(0)), 'base64').toString()) throw Error('Browser identity was not stable.');
  }
  const input = Buffer.from('Keychain fixture: é 🔐');
  const encrypted = Buffer.from(call(parents[0], 'encrypt', input), 'base64');
  for (const parent of parents) {
    if (!Buffer.from(call(parent, 'decrypt', encrypted), 'base64').equals(input)) throw Error('Cross-build decryption failed.');
  }
  const denied = spawnSync(helper, [], { input: '{}', encoding: 'utf8', timeout: 5000 });
  if (denied.status === 0 || !denied.stderr.includes('signed E1 Code parent')) throw Error('Unrelated caller was not rejected.');
  console.log(JSON.stringify({ distinctApplicationBuilds: true, crossBuildDecryption: true, nativeBrowserKeyReadableWithoutPrompt: true, unrelatedCallerDenied: true, legacyEnvelope: encrypted.subarray(0, 3).toString() }, null, 2));
} finally {
  // Delete only the random fixture items, never the application's storage key.
  for (const name of browserServices) spawnSync('/usr/bin/security', ['delete-generic-password', '-s', name + ' Safe Storage', '-a', name + ' Key'], { stdio: 'ignore' });
  spawnSync('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', 'Fixture'], { stdio: 'ignore' });
  fs.rmSync(directory, { recursive: true, force: true });
}
