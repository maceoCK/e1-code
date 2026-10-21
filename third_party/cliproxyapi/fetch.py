#!/usr/bin/env python3
"""Fetch exactly the reviewed upstream runtime; never use a floating release."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
from urllib.request import urlopen

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text())
with urlopen(manifest['url'], timeout=60) as response:
    archive = response.read()
assert hashlib.sha256(archive).hexdigest() == manifest['archiveSha256'], 'Archive checksum mismatch'
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as bundle:
    binary = bundle.extractfile('cli-proxy-api').read()
assert hashlib.sha256(binary).hexdigest() == manifest['binarySha256'], 'Binary checksum mismatch'
target = root / 'cli-proxy-api'
target.write_bytes(binary)
target.chmod(0o755)
print('Verified CLIProxyAPI ' + manifest['version'] + ' runtime ready for packaging.')
