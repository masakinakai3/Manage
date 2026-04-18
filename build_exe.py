#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

import hashlib
import json
import os
import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path


STATE_FILE_NAME = ".build_exe_state.json"
FRONTEND_EXCLUDED_DIRS = {"dist", "node_modules", ".vite", ".pytest_cache", "__pycache__"}
BACKEND_EXCLUDED_DIRS = {"__pycache__"}
BACKEND_EXCLUDED_FILES = {"database.db"}


def run_command(command, cwd=None):
    printable = command if isinstance(command, str) else " ".join(command)
    print(f"Running: {printable}")
    try:
        if isinstance(command, list) and command:
            executable = command[0]
            if executable == "npm":
                command = [shutil.which("npm.cmd") or shutil.which("npm") or executable] + command[1:]
        subprocess.run(command, cwd=cwd, check=True)
    except subprocess.CalledProcessError:
        print(f"Error running command: {printable}")
        sys.exit(1)


def iter_files(base_dir, excluded_dirs=None, excluded_files=None):
    excluded_dirs = excluded_dirs or set()
    excluded_files = excluded_files or set()

    for root, dirs, files in os.walk(base_dir):
        dirs[:] = sorted(directory for directory in dirs if directory not in excluded_dirs)
        for file_name in sorted(files):
            if file_name in excluded_files:
                continue
            yield Path(root) / file_name


def fingerprint_paths(paths):
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: str(item).lower()):
        relative_path = path.as_posix().encode("utf-8", errors="ignore")
        stat = path.stat()
        digest.update(relative_path)
        digest.update(str(stat.st_size).encode("ascii"))
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def fingerprint_directory(base_dir, excluded_dirs=None, excluded_files=None):
    files = list(iter_files(base_dir, excluded_dirs=excluded_dirs, excluded_files=excluded_files))
    return fingerprint_paths(files), files


def load_state(state_path):
    if not state_path.exists():
        return {}
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_state(state_path, state):
    state_path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def remove_path(path):
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def build_frontend(frontend_dir, state, force=False):
    frontend_input_paths = [
        frontend_dir / "index.html",
        frontend_dir / "package.json",
        frontend_dir / "package-lock.json",
        frontend_dir / "vite.config.js",
    ]
    frontend_source_hash, frontend_source_files = fingerprint_directory(
        frontend_dir,
        excluded_dirs=FRONTEND_EXCLUDED_DIRS,
    )

    # Include top-level config files even if new frontend subfolders are not added yet.
    explicit_paths = [path for path in frontend_input_paths if path.exists()]
    frontend_input_hash = fingerprint_paths(sorted(set(frontend_source_files + explicit_paths)))

    node_modules_dir = frontend_dir / "node_modules"
    frontend_dist = frontend_dir / "dist"
    frontend_changed = state.get("frontend_input_hash") != frontend_input_hash
    needs_frontend_build = force or frontend_changed or not frontend_dist.exists()

    print("--- Frontend ---")
    if not node_modules_dir.exists():
        print("Installing frontend dependencies because node_modules is missing.")
        run_command(["npm", "install"], cwd=frontend_dir)
        needs_frontend_build = True

    if needs_frontend_build:
        if force:
            reason = "--force was specified"
        elif frontend_changed:
            reason = "inputs changed"
        else:
            reason = "dist folder is missing"
        print(f"Building frontend because {reason}.")
        run_command(["npm", "run", "build"], cwd=frontend_dir)
    else:
        print("Skipping frontend build because inputs are unchanged.")

    if not frontend_dist.exists():
        print("Frontend build failed: dist folder not found")
        sys.exit(1)

    return frontend_dist, frontend_input_hash


def build_backend(root_dir, backend_dir, frontend_dist, frontend_input_hash, state, force=False):
    dist_dir = root_dir / "dist"
    build_work_dir = root_dir / "build"
    exe_path = dist_dir / "manage_app.exe"

    backend_hash, backend_files = fingerprint_directory(
        backend_dir,
        excluded_dirs=BACKEND_EXCLUDED_DIRS,
        excluded_files=BACKEND_EXCLUDED_FILES,
    )
    extra_inputs = [
        path
        for path in [root_dir / "build_exe.py", root_dir / "manage_app.spec"]
        if path.exists()
    ]
    combined_backend_hash = fingerprint_paths(sorted(set(backend_files + extra_inputs)))
    pyinstaller_input_hash = hashlib.sha256(
        f"{combined_backend_hash}:{frontend_input_hash}".encode("utf-8")
    ).hexdigest()

    backend_changed = state.get("pyinstaller_input_hash") != pyinstaller_input_hash
    needs_backend_build = force or backend_changed or not exe_path.exists()

    print("--- Backend EXE ---")
    if needs_backend_build:
        if force:
            reason = "--force was specified"
        elif backend_changed:
            reason = "inputs changed"
        else:
            reason = "manage_app.exe is missing"
        print(f"Building backend executable because {reason}.")
        build_work_dir.mkdir(exist_ok=True)
        dist_dir.mkdir(exist_ok=True)

        add_data = f"{frontend_dist};dist"
        cmd = [
            sys.executable,
            "-m",
            "PyInstaller",
            "--name",
            "manage_app",
            "--onefile",
            "--noconfirm",
            "--add-data",
            add_data,
            "--distpath",
            str(dist_dir),
            "--workpath",
            str(build_work_dir),
            str(backend_dir / "app.py"),
        ]
        print(f"PyInstaller command: {' '.join(cmd)}")
        run_command(cmd, cwd=root_dir)
    else:
        print("Skipping backend build because inputs are unchanged and the existing EXE can be reused.")

    if not exe_path.exists():
        print("Backend build failed: manage_app.exe not found")
        sys.exit(1)

    return pyinstaller_input_hash, exe_path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build the frontend bundle and packaged Windows executable."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore the incremental-build cache and rebuild both stages.",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete prior build outputs and cached state before rebuilding.",
    )
    return parser.parse_args()


def main():
    start_time = time.perf_counter()
    args = parse_args()

    root_dir = Path(__file__).resolve().parent
    frontend_dir = root_dir / "frontend"
    backend_dir = root_dir / "backend"
    state_path = root_dir / STATE_FILE_NAME
    dist_dir = root_dir / "dist"
    build_dir = root_dir / "build"

    if args.clean:
        print("--- Clean ---")
        print("Removing cached build outputs because --clean was specified.")
        for path in [dist_dir, build_dir, state_path]:
            if path.exists():
                remove_path(path)

    state = load_state(state_path)
    force_rebuild = args.force or args.clean

    frontend_dist, frontend_input_hash = build_frontend(
        frontend_dir,
        state,
        force=force_rebuild,
    )
    pyinstaller_input_hash, exe_path = build_backend(
        root_dir,
        backend_dir,
        frontend_dist,
        frontend_input_hash,
        state,
        force=force_rebuild,
    )

    save_state(
        state_path,
        {
            "frontend_input_hash": frontend_input_hash,
            "pyinstaller_input_hash": pyinstaller_input_hash,
        },
    )

    elapsed = time.perf_counter() - start_time
    print("--- Build Complete ---")
    print(f"Executable created at: {exe_path}")
    print(f"Elapsed time: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
