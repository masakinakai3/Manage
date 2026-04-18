# Resource Manager

Resource Manager is a desktop-oriented resource planning tool for managing themes, members, allocations, insights, saved views, snapshots, and data import/export in one place.

The backend uses Flask + SQLite, the frontend uses Vite + Vanilla JavaScript, and Windows packaging is handled with PyInstaller. In development you can run the backend and frontend separately, while for desktop distribution you can build a packaged executable.

## Main Features

- Gantt-based allocation management by theme and month
- Member load visualization and warning checks
- Saved views for period, scale, and filter conditions
- Snapshot save and diff review
- Dashboard-style insights and recommendations
- JSON backup import/export
- CSV / XLSX export
- Undo / redo and keyboard shortcut support

## Tech Stack

- Backend: Python 3.10+, Flask, Flask-Login, Flask-SQLAlchemy, SQLite
- Frontend: Vite, Vanilla JavaScript, HTML, CSS
- Build: PyInstaller
- Test: pytest, Vitest

## Directory Layout

```text
backend/      Flask API, models, services, migrations
frontend/     HTML, CSS, JavaScript, Vitest tests
tests/        pytest tests
tools/        lint / format / check scripts
docs/         development and operational documents
build_exe.py  EXE build script
manage_app.spec  PyInstaller build definition
```

## Setup

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r backend\requirements.txt
pip install pytest
```

### Frontend

```powershell
cd frontend
npm install
cd ..
```

## Local Development

### 1. Start the Flask server

```powershell
cd backend
..\.venv\Scripts\python.exe app.py
```

Access:

- Backend API and static serving: `http://127.0.0.1:5001`

### 2. Start the Vite dev server

Open another terminal and run:

```powershell
cd frontend
npm run dev
```

Access:

- Frontend dev server: `http://localhost:5173`

Vite proxies `/api` to `http://127.0.0.1:5001`.

## Tests and Checks

### Backend

```powershell
python -m pytest
```

### Frontend

```powershell
cd frontend
npm test
npm run lint
npm run format:check
```

### Windows All-in-One Check

```powershell
powershell -ExecutionPolicy Bypass -File tools\run_checks.ps1
```

## EXE Build

`build_exe.py` supports incremental builds. If neither frontend nor backend inputs changed, the previous build result is reused.

### Release Build

Use this for distribution or final verification. This creates a single-file EXE:

```powershell
.\.venv\Scripts\python.exe build_exe.py
```

Output:

- `dist/manage_app.exe`

### Dev Build

Use this during everyday implementation when you want faster packaging. This creates an `onedir` bundle:

```powershell
.\.venv\Scripts\python.exe build_exe.py --profile dev
```

Output:

- `dist/manage_app/manage_app.exe`

Notes:

- The build script prefers `.\.venv\Scripts\python.exe` automatically when it exists so PyInstaller and dependency resolution stay stable.
- `dev` is faster to rebuild because it skips the final single-file packaging step.
- When only frontend files changed, `dev` now reuses the existing EXE and refreshes `dist/manage_app/dist` instead of rerunning PyInstaller.
- `release` remains the default, so existing build commands continue to work unchanged.

### Force Rebuild

```powershell
.\.venv\Scripts\python.exe build_exe.py --force
```

- Rebuilds both the frontend bundle and the packaged app even when the incremental cache says nothing changed.

You can combine it with the dev profile:

```powershell
.\.venv\Scripts\python.exe build_exe.py --profile dev --force
```

### Clean Rebuild

```powershell
.\.venv\Scripts\python.exe build_exe.py --clean
```

- Removes `dist/`, `build/`, and `.build_exe_state.json`, then rebuilds from scratch.

## Recommended Build Usage

- Use `--profile dev` while iterating on implementation and checking packaging frequently.
- Use the default `release` build before sharing binaries, doing final smoke tests, or handing over deliverables.
- If build behavior looks suspicious after dependency or packaging changes, run `--clean`.

## Security Notes

- On first launch, a default `admin` user is created if none exists.
- Auto-login is limited to loopback access only.
- The API is intended for local desktop use.

## Main API Routes

- `/api/auth/*`
- `/api/themes`
- `/api/members`
- `/api/allocations`
- `/api/insights/overview`
- `/api/snapshots`
- `/api/saved-views`
- `/api/export/*`
- `/api/import/json`

## Related Documents

- [docs/APIContract.md](docs/APIContract.md)
- [docs/DevelopmentWorkflow.md](docs/DevelopmentWorkflow.md)
- [docs/DocumentationOperations.md](docs/DocumentationOperations.md)
- [docs/AcceptanceCriteria.md](docs/AcceptanceCriteria.md)
