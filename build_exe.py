#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

import os
import subprocess
import shutil
import sys

def run_command(command, cwd=None):
    print(f"Running: {command}")
    try:
        subprocess.check_call(command, shell=True, cwd=cwd)
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {command}")
        sys.exit(1)

def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_dir = os.path.join(root_dir, 'frontend')
    backend_dir = os.path.join(root_dir, 'backend')
    dist_dir = os.path.join(root_dir, 'dist')

    # 1. Build Frontend
    print("--- Building Frontend ---")
    if not os.path.exists(os.path.join(frontend_dir, 'node_modules')):
        run_command('npm install', cwd=frontend_dir)
    run_command('npm run build', cwd=frontend_dir)

    # Verify dist exists
    frontend_dist = os.path.join(frontend_dir, 'dist')
    if not os.path.exists(frontend_dist):
        print("Frontend build failed: dist folder not found")
        sys.exit(1)

    # 2. Build Backend (EXE)
    print("--- Building Backend EXE ---")
    
    # Clean previous builds
    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)
    build_work_dir = os.path.join(root_dir, 'build')
    if os.path.exists(build_work_dir):
        shutil.rmtree(build_work_dir)

    # PyInstaller arguments
    # --onefile: Create a single executable
    # --name manage_app: Name of the executable
    # --add-data: Include frontend/dist folder as 'dist' in the bundle
    # --clean: Clean PyInstaller cache
    # --noconfirm: Do not ask for confirmation
    
    # Note: Separator for add-data is ; on Windows
    add_data = f"{frontend_dist};dist"
    
    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--name', 'manage_app',
        '--onefile',
        '--clean',
        '--noconfirm',
        '--add-data', add_data,
        '--distpath', dist_dir,
        '--workpath', build_work_dir,
        os.path.join(backend_dir, 'app.py')
    ]
    
    # We need to run this command. Since pyinstaller is a script, we might need to run it via python -m PyInstaller
    # or just pyinstaller if it's in path. Let's try direct command first.
    
    print(f"PyInstaller command: {' '.join(cmd)}")
    run_command(' '.join(cmd), cwd=root_dir)

    print("--- Build Complete ---")
    print(f"Executable created at: {os.path.join(dist_dir, 'manage_app.exe')}")

if __name__ == '__main__':
    main()
