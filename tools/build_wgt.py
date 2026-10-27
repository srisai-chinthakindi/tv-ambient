"""Package Ambient as a standalone Tizen web app (Ambient.wgt).

The package is unsigned: TizenBrew Installer re-signs it with the TV owner's
Samsung certificate when installing from GitHub releases.

Usage: python tools/build_wgt.py [output.wgt]
"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'Ambient.wgt')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(ROOT, 'tizen', 'config.xml'), 'config.xml')
        z.write(os.path.join(ROOT, 'tizen', 'icon.png'), 'icon.png')
        app = os.path.join(ROOT, 'app')
        for name in sorted(os.listdir(app)):
            z.write(os.path.join(app, name), name)
        z.write(os.path.join(ROOT, 'service', 'service.js'), 'service/service.js')
    print(out, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
