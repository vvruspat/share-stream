"""Allow Electron's internal framework links without allowing archive escapes."""
import os
import pathlib
import subprocess
import sys
import tempfile
import zipfile

with tempfile.TemporaryDirectory(prefix='share-stream-links-') as temporary:
    root = pathlib.Path(temporary)
    framework = 'Share Stream Chat.app/Contents/Frameworks/Electron Framework.framework/'
    base = [(framework+'Versions/A/Electron Framework', b'binary', False),
            (framework+'Versions/Current', b'A', True),
            (framework+'Electron Framework', b'Versions/Current/Electron Framework', True)]
    cases = [([], True),
             ([(framework+'Resources', b'/tmp/outside', True)], False),
             ([(framework+'Resources', b'../../outside', True)], False),
             ([(framework+'Versions/Current/injected', b'bad', False)], False),
             ([('Other.app/link', b'local', True)], False),
             ([(framework+'Versions/A/Electron Framework', b'duplicate', False)], False)]
    for index, (extra, okay) in enumerate(cases):
        archive, destination = root/f'{index}.zip', root/f'unpacked-{index}'
        with zipfile.ZipFile(archive, 'w') as output:
            for name, data, link in base+extra:
                entry = zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = (0o120777 if link else 0o100755) << 16
                output.writestr(entry, data)
        result = subprocess.run([sys.argv[1], '--extract', str(archive), str(destination)], capture_output=True, text=True)
        assert (result.returncode == 0) == okay, result.stdout+result.stderr
        if okay:
            assert (destination/framework/'Electron Framework').read_bytes() == b'binary'
            assert os.readlink(destination/framework/'Versions/Current') == 'A'
    print('PASS: internal Electron links, absolute/relative escapes, link children and duplicate entries')
