// Build an isolated candidate, never overwrite the installed E1 Code app.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '..');
  const template = process.env.E1_ELECTRON_TEMPLATE;
  const destination = process.argv[2] && path.resolve(process.argv[2]);
  if (!template || !fs.existsSync(path.join(template, 'Contents/Info.plist'))) throw Error('Set E1_ELECTRON_TEMPLATE to a matching Electron.app.');
  if (!destination || !destination.endsWith('.app') || fs.existsSync(destination)) throw Error('Choose a new .app destination. Existing apps are never replaced.');
  const stage = fs.mkdtempSync(path.join(path.dirname(destination), '.e1-preview-stage-'));
  try {
    fs.cpSync(path.join(root, 'src'), path.join(stage, 'src'), { recursive: true });
    fs.cpSync(path.join(root, 'node_modules/node-pty'), path.join(stage, 'node_modules/node-pty'), { recursive: true });
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'e1-workspace-preview', version: '0.1.0', main: 'src/workspace-preview.cjs' }));
    cp.execFileSync('/bin/cp', ['-cR', template, destination]);
    const archive = path.join(destination, 'Contents/Resources/app.asar');
    await (await import('@electron/asar')).createPackageWithOptions(stage, archive, { unpackDir: 'node_modules/node-pty' });
    cp.execFileSync('python3', ['-c', `import pathlib,plistlib,sys
p=pathlib.Path(sys.argv[1])/'Contents/Info.plist'
d=plistlib.load(p.open('rb'));d.update(CFBundleName='E1 Workspace Preview',CFBundleDisplayName='E1 Workspace Preview',CFBundleIdentifier='local.e1.workspace-preview',CFBundleVersion='0.1.0',CFBundleShortVersionString='0.1.0');d.pop('CFBundleURLTypes',None);d.pop('ElectronAsarIntegrity',None);plistlib.dump(d,p.open('wb'))`, destination]);
    // Strip only Finder metadata that codesign rejects, preserving quarantine and provenance.
    for (const key of ['com.apple.FinderInfo', 'com.apple.ResourceFork'])
      cp.spawnSync('/usr/bin/xattr', ['-rd', key, destination], { stdio: 'ignore' });
    cp.execFileSync('codesign', ['--force', '--deep', '--sign', '-', destination], { stdio: 'pipe' });
    cp.execFileSync('codesign', ['--verify', '--deep', '--strict', destination], { stdio: 'pipe' });
    console.log(JSON.stringify({ destination, entry: 'src/workspace-preview.cjs', signature: 'local ad-hoc; strict verification passed', installedAppChanged: false }));
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
