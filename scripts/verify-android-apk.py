"""Check the packaged ARM64 native library can load on 4 KiB/16 KiB devices."""
import struct
import sys
import zipfile
from pathlib import Path

for filename in sys.argv[1:]:
    with zipfile.ZipFile(filename) as apk:
        names = apk.namelist()
        assert 'AndroidManifest.xml' in names and 'classes.dex' in names, 'Missing Android app files'
        libraries = [name for name in names if name.endswith('.so')]
        assert libraries == ['lib/arm64-v8a/libwails.so'], f'Unexpected native libraries: {libraries}'
        elf = apk.read(libraries[0])
        assert elf[:6] == b'\x7fELF\x02\x01', 'Expected little-endian ELF64'
        assert struct.unpack_from('<H', elf, 18)[0] == 183, 'Expected AArch64'
        phoff = struct.unpack_from('<Q', elf, 32)[0]
        phsize, phnum = struct.unpack_from('<HH', elf, 54)
        segments = 0
        for index in range(phnum):
            kind, flags, offset, address, physical, filesz, memsz, alignment = struct.unpack_from('<IIQQQQQQ', elf, phoff + index * phsize)
            if kind != 1:  # PT_LOAD
                continue
            segments += 1
            assert alignment >= 16384, f'Native segment alignment is only {alignment} bytes'
            assert offset % 16384 == address % 16384, 'Misaligned native segment'
        assert segments, 'Missing native load segments'
    print(f'{Path(filename).name}: ARM64, 16 KiB native alignment verified')
