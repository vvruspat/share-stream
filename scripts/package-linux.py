#!/usr/bin/env python3
"""Native distro packages: receiver, VST3, desktop entry and uninstall metadata."""
import argparse
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def package(kind):
    version = re.search(r'project\(ShareStream VERSION ([\d.]+)', (ROOT/'CMakeLists.txt').read_text())[1]
    work = ROOT/'build'/f'package-{kind}'
    if work.exists():
        shutil.rmtree(work)
    staging = work/'root'
    app = staging/'opt/share-stream'
    app.mkdir(parents=True)
    shutil.copy2(ROOT/'build/ShareStreamReceiver_artefacts/Release/Share Stream', app/'Share Stream')
    plugin = staging/'usr/lib/vst3/Share Stream.vst3'
    shutil.copytree(ROOT/'build/ShareStream_artefacts/Release/VST3/Share Stream.vst3', plugin)
    desktop = staging/'usr/share/applications/share-stream.desktop'
    desktop.parent.mkdir(parents=True)
    desktop.write_text('[Desktop Entry]\nType=Application\nName=Share Stream\n'
                       'Comment=Listen to your partner’s music stream\n'
                       'Exec="/opt/share-stream/Share Stream"\nIcon=share-stream\n'
                       'Terminal=false\nCategories=AudioVideo;Audio;\n')
    icon = staging/'usr/share/icons/hicolor/scalable/apps/share-stream.svg'
    icon.parent.mkdir(parents=True)
    shutil.copy2(ROOT/'packaging/share-stream.svg', icon)
    docs = staging/'usr/share/doc/share-stream'
    docs.mkdir(parents=True)
    for name in ['README.md', 'THIRD_PARTY.md']:
        shutil.copy2(ROOT/name, docs/name)
    shutil.copy2(ROOT/'vendor/monocypher/LICENCE.md', docs/'Monocypher-LICENCE.md')
    shutil.copy2(ROOT/'vendor/Opus-COPYING', docs/'Opus-COPYING')
    dist = ROOT/'dist'
    dist.mkdir(exist_ok=True)
    if kind == 'deb':
        control = staging/'DEBIAN/control'
        control.parent.mkdir()
        control.write_text(f'Package: share-stream\nVersion: {version}\nArchitecture: amd64\n'
                           'Maintainer: Aleksandr Kolesov <vvruspat@users.noreply.github.com>\n'
                           'Section: sound\nPriority: optional\n'
                           'Depends: libc6 (>= 2.39), libstdc++6 (>= 13.1), libasound2t64, libcurl4t64, '
                           'libfontconfig1, libfreetype6, libx11-6, libxext6, libxcursor1, libxinerama1, '
                           'libxrandr2, ca-certificates, pkexec\n'
                           'Homepage: https://github.com/vvruspat/share-stream\n'
                           'Description: Private low-latency audio streaming\n'
                           ' VST3 plug-in and standalone receiver with GitHub Releases updates.\n')
        subprocess.run(['dpkg-deb', '--root-owner-group', '--build', str(staging),
                        str(dist/'ShareStream-Ubuntu-amd64.deb')], check=True)
    else:
        spec = work/'share-stream.spec'
        spec.write_text(f'''Name: share-stream
Version: {version}
Release: 1%{{?dist}}
Summary: Private low-latency audio streaming
License: Proprietary AND (BSD-2-Clause OR CC0-1.0) AND BSD-3-Clause
URL: https://github.com/vvruspat/share-stream
Requires: alsa-lib, libcurl, fontconfig, freetype, libX11, libXext, libXcursor, libXinerama, libXrandr, ca-certificates, polkit
%global debug_package %{{nil}}
%description
VST3 plug-in and standalone receiver with GitHub Releases updates.
%install
mkdir -p "%{{buildroot}}"
cp -a "{staging}/." "%{{buildroot}}/"
%files
/opt/share-stream/
"/usr/lib/vst3/Share Stream.vst3/"
/usr/share/applications/share-stream.desktop
/usr/share/icons/hicolor/scalable/apps/share-stream.svg
/usr/share/doc/share-stream/
''')
        subprocess.run(['rpmbuild', '-bb', '--define', f'_topdir {work}/rpm', str(spec)], check=True)
        files = list((work/'rpm/RPMS/x86_64').glob('share-stream-*.rpm'))
        assert len(files) == 1, files
        shutil.copy2(files[0], dist/'ShareStream-Fedora-x86_64.rpm')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('format', choices=['deb', 'rpm'])
    package(parser.parse_args().format)
