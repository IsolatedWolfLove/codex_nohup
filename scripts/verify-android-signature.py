"""Ensure published APKs keep the project's pinned Android signing certificate."""
import re
import subprocess
import sys
from pathlib import Path

apksigner, *files = sys.argv[1:]
if not files:
    raise SystemExit('Usage: verify-android-signature.py APKSIGNER APK...')
expected = (Path(__file__).resolve().parent.parent / 'resources/android/release-signing.sha256').read_text().strip().lower()
if not re.fullmatch(r'[0-9a-f]{64}', expected):
    raise SystemExit('Invalid pinned Android signing certificate')
for filename in files:
    result = subprocess.run([apksigner, 'verify', '--print-certs', filename], capture_output=True, text=True, check=True)
    actual = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)$', result.stdout, flags=re.MULTILINE)
    if actual != [expected]:
        raise SystemExit(f'{Path(filename).name}: signing certificate differs from the pinned release certificate')
    print(f'{Path(filename).name}: persistent signing certificate verified ({expected})')
