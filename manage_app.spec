# -*- mode: python ; coding: utf-8 -*-

import os
from pathlib import Path


project_root = Path(SPEC).resolve().parent
frontend_dist = Path(
    os.environ.get("MANAGE_FRONTEND_DIST", str(project_root / "frontend" / "dist"))
).resolve()
build_profile = os.environ.get("MANAGE_BUILD_PROFILE", "release").strip().lower()
custom_hook_dir = project_root / "pyinstaller_hooks"

from PyInstaller.utils.hooks import collect_data_files
flasgger_datas = collect_data_files('flasgger')

# Keep the packaged app focused on the libraries we actually execute at runtime.
# These modules were being pulled in by broad third-party hooks despite not being
# used by this project's Flask + SQLite + XLSX export flow.
excluded_modules = [
    "matplotlib",
    "PIL",
    "PIL.Image",
    "PIL.ImageCms",
    "PIL.ImageFilter",
    "PIL.ImageMath",
    "PIL.ImageOps",
    "PIL.ImageQt",
    "PIL.ImageSequence",
    "PIL.ImageShow",
    "PIL.ImageTk",
    "PIL.ImageWin",
    "numpy",
    "numpy.f2py",
    "psutil",
    "pkg_resources",
    "setuptools",
    "sqlalchemy.dialects.mssql",
    "sqlalchemy.dialects.mysql",
    "sqlalchemy.dialects.oracle",
    "sqlalchemy.dialects.postgresql",
    "sqlalchemy.testing",
    "IPython",
    "notebook",
    "jedi",
    "pygments",
    "cryptography",
    "pycryptodome",
]

a = Analysis(
    [str(project_root / "backend" / "app.py")],
    pathex=[str(project_root / "backend"), str(project_root)],
    binaries=[],
    datas=[(str(frontend_dist), "dist")] + flasgger_datas,
    hiddenimports=[],
    hookspath=[str(custom_hook_dir)],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excluded_modules,
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

if build_profile == "dev":
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name="manage_app",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        upx_exclude=[],
        runtime_tmpdir=None,
        console=True,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
    )

    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=False,
        upx_exclude=[],
        name="manage_app",
    )
else:
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.datas,
        exclude_binaries=False,
        name="manage_app",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        upx_exclude=[],
        runtime_tmpdir=None,
        console=True,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        onefile=True,
    )
