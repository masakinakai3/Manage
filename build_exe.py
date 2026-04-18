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
REEXEC_ENV_NAME = "MANAGE_BUILD_EXE_ACTIVE"
FRONTEND_EXCLUDED_DIRS = {"dist", "node_modules", ".vite", ".pytest_cache", "__pycache__"}
BACKEND_EXCLUDED_DIRS = {"__pycache__"}
BACKEND_EXCLUDED_FILES = {"database.db"}
BUILD_PROFILES = {"dev", "release"}


def run_command(command, cwd=None, env=None):
    printable = command if isinstance(command, str) else " ".join(command)
    print(f"Running: {printable}")
    try:
        if isinstance(command, list) and command:
            executable = command[0]
            if executable == "npm":
                command = [shutil.which("npm.cmd") or shutil.which("npm") or executable] + command[1:]
        subprocess.run(command, cwd=cwd, check=True, env=env)
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


def get_preferred_python(root_dir, profile):
    venv_python = root_dir / ".venv" / "Scripts" / "python.exe"
    if profile == "dev" and venv_python.exists():
        return venv_python
    return Path(sys.executable).resolve()


def ensure_preferred_python(root_dir, profile):
    preferred_python = get_preferred_python(root_dir, profile)
    current_python = Path(sys.executable).resolve()

    if (
        preferred_python != current_python
        and preferred_python.exists()
        and os.environ.get(REEXEC_ENV_NAME) != "1"
    ):
        print(f"Re-launching build with preferred Python: {preferred_python}")
        env = os.environ.copy()
        env[REEXEC_ENV_NAME] = "1"
        completed = subprocess.run([str(preferred_python), __file__, *sys.argv[1:]], env=env)
        sys.exit(completed.returncode)

    return preferred_python


def sync_directory(source_dir, target_dir):
    if target_dir.exists():
        shutil.rmtree(target_dir)
    shutil.copytree(source_dir, target_dir)


def cleanup_release_artifacts(dist_dir):
    legacy_paths = [
        dist_dir / "_internal",
        dist_dir / "_release_bundle",
        dist_dir / "_runtime",
        dist_dir / "manage_app",
    ]
    for legacy_path in legacy_paths:
        if legacy_path.exists():
            print(f"Removing stale release artifact: {legacy_path}")
            try:
                remove_path(legacy_path)
            except OSError as exc:
                print(f"Skipping cleanup of locked artifact {legacy_path}: {exc}")


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

    return frontend_dist, frontend_input_hash, frontend_changed


def sync_dev_frontend(frontend_dist, exe_path, state, frontend_input_hash, force=False):
    runtime_dist_dir = exe_path.parent / "dist"
    state_key = "dev_runtime_frontend_hash"
    runtime_changed = state.get(state_key) != frontend_input_hash
    needs_sync = force or runtime_changed or not (runtime_dist_dir / "index.html").exists()

    if needs_sync:
        if force:
            reason = "--force was specified"
        elif runtime_changed:
            reason = "frontend bundle changed"
        else:
            reason = "runtime dist is missing"
        print(f"Syncing dev frontend bundle because {reason}.")
        sync_directory(frontend_dist, runtime_dist_dir)
    else:
        print("Skipping dev frontend sync because runtime dist is unchanged.")

    return frontend_input_hash


def build_backend(root_dir, backend_dir, frontend_dist, frontend_input_hash, state, profile, python_executable, force=False):
    dist_dir = root_dir / "dist"
    build_work_dir = root_dir / "build"
    exe_path = (
        dist_dir / "manage_app.exe"
        if profile == "release"
        else dist_dir / "manage_app" / "manage_app.exe"
    )

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
    hook_files = []
    hook_dir = root_dir / "pyinstaller_hooks"
    if hook_dir.exists():
        hook_files = list(iter_files(hook_dir))
    combined_backend_hash = fingerprint_paths(sorted(set(backend_files + extra_inputs + hook_files)))
    pyinstaller_fingerprint = f"{profile}:{combined_backend_hash}"
    if profile == "release":
        pyinstaller_fingerprint = f"{pyinstaller_fingerprint}:{frontend_input_hash}"
    pyinstaller_input_hash = hashlib.sha256(pyinstaller_fingerprint.encode("utf-8")).hexdigest()

    state_key = f"pyinstaller_input_hash_{profile}"
    change_reasons = []
    previous_backend_hash = state.get(f"backend_source_hash_{profile}")
    previous_frontend_hash = state.get(f"packaged_frontend_hash_{profile}")
    previous_python = state.get(f"python_executable_{profile}")
    previous_fingerprint = state.get(state_key)

    if previous_backend_hash != combined_backend_hash:
        change_reasons.append("backend/build inputs changed")
    if profile == "release" and previous_frontend_hash != frontend_input_hash:
        change_reasons.append("packaged frontend bundle changed")
    if previous_python != str(python_executable):
        change_reasons.append("Python executable changed")
    if not change_reasons and previous_fingerprint != pyinstaller_input_hash:
        change_reasons.append("packaging fingerprint changed")

    backend_changed = bool(change_reasons)
    needs_backend_build = force or backend_changed or not exe_path.exists()

    print(f"--- Backend EXE ({profile}) ---")
    if needs_backend_build:
        if force:
            reason = "--force was specified"
        elif backend_changed:
            reason = ", ".join(change_reasons)
        else:
            reason = f"{exe_path.name} is missing"
        print(f"Building backend executable because {reason}.")
        build_work_dir.mkdir(exist_ok=True)
        dist_dir.mkdir(exist_ok=True)
        if profile == "release":
            cleanup_release_artifacts(dist_dir)

        build_env = os.environ.copy()
        build_env["MANAGE_BUILD_PROFILE"] = profile
        build_env["MANAGE_FRONTEND_DIST"] = str(frontend_dist)
        cmd = [
            str(python_executable),
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--distpath",
            str(dist_dir),
            "--workpath",
            str(build_work_dir),
            str(root_dir / "manage_app.spec"),
        ]
        print(f"PyInstaller command: {' '.join(cmd)}")
        run_command(cmd, cwd=root_dir, env=build_env)
    else:
        print("Skipping backend build because inputs are unchanged and the existing EXE can be reused.")

    if not exe_path.exists():
        print("Backend build failed: manage_app.exe not found")
        sys.exit(1)

    synced_frontend_hash = None
    if profile == "dev":
        synced_frontend_hash = sync_dev_frontend(
            frontend_dist,
            exe_path,
            state,
            frontend_input_hash,
            force=force,
        )

    state_updates = {
        state_key: pyinstaller_input_hash,
        f"backend_source_hash_{profile}": combined_backend_hash,
        f"python_executable_{profile}": str(python_executable),
    }
    if profile == "release":
        state_updates[f"packaged_frontend_hash_{profile}"] = frontend_input_hash

    return pyinstaller_input_hash, exe_path, synced_frontend_hash, state_updates


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build the frontend bundle and packaged Windows executable."
    )
    parser.add_argument(
        "--profile",
        choices=sorted(BUILD_PROFILES),
        default="release",
        help="Build profile: release creates a onefile EXE, dev creates a faster onedir bundle.",
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
    root_dir = Path(__file__).resolve().parent
    args = parse_args()
    preferred_python = ensure_preferred_python(root_dir, args.profile)

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

    frontend_dist, frontend_input_hash, _frontend_changed = build_frontend(
        frontend_dir,
        state,
        force=force_rebuild,
    )
    pyinstaller_input_hash, exe_path, synced_frontend_hash, backend_state_updates = build_backend(
        root_dir,
        backend_dir,
        frontend_dist,
        frontend_input_hash,
        state,
        profile=args.profile,
        python_executable=preferred_python,
        force=force_rebuild,
    )

    state["frontend_input_hash"] = frontend_input_hash
    state.update(backend_state_updates)
    if args.profile == "dev" and synced_frontend_hash:
        state["dev_runtime_frontend_hash"] = synced_frontend_hash
    save_state(state_path, state)

    elapsed = time.perf_counter() - start_time
    print("--- Build Complete ---")
    print(f"Profile: {args.profile}")
    print(f"Executable created at: {exe_path}")
    print(f"Elapsed time: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
