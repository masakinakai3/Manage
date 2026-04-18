# Development Workflow Standard

## Definition of Done

- Feature behavior is implemented and manually smoke-checked.
- Backend tests and frontend tests pass locally.
- Build succeeds for the frontend bundle.
- Packaging workflow is verified with the appropriate build profile for the task.
- User-facing text, empty states, and error handling are present.
- Related docs are updated according to `docs/DocumentationOperations.md`.
- Regression risks and follow-up items are called out in the PR.

## Pull Request Expectations

- Explain the user problem and the intended outcome.
- Summarize key implementation decisions and tradeoffs.
- List executed checks and any skipped verification.
- Call out migration, data, or compatibility concerns.
- Include screenshots or screen descriptions when UI changed.

## Review Focus

- Behavioral regression in allocation editing, period changes, and exports.
- Data integrity and state synchronization across views.
- Responsiveness and keyboard accessibility for new UI.
- Error handling for partial data and empty states.
- Documentation completeness for changed workflows.

## Regression Checklist

- Gantt view renders and edits allocations.
- Member load view still expands, collapses, and exports.
- Saved views apply period, scale, and search settings correctly.
- Onboarding sample-data flow works from an empty setup.
- Insights view loads health checks, dashboard tables, and recommendations.
- CSV and Excel advanced exports honor chosen templates and columns.
- Keyboard shortcuts do not interfere with text input fields.

## Build Profiles

- Use `.\.venv\Scripts\python.exe build_exe.py --profile dev` during everyday development when you want the fastest packaged smoke check.
- Prefer `.\.venv\Scripts\python.exe` for `--profile dev`; keep using the release Python/toolchain that you trust for final onefile packaging.
- In `dev`, frontend-only changes refresh `dist/manage_app/dist` without rerunning PyInstaller, so HTML/CSS/JS tweaks should rebuild much faster.
- Use `.\.venv\Scripts\python.exe build_exe.py` for release verification and whenever you need the final single-file `dist/manage_app.exe`.
- The release build now deletes stale `onedir` leftovers before packaging, which keeps `dist/` consistent when switching between profiles.
- Use `--force` after build-script or packaging-definition changes when you want to bypass the incremental cache.
- Use `--clean` when dependency or artifact drift is suspected and you want a full rebuild from scratch.

## Branch and Merge Guidance

- Keep feature branches focused on one user outcome when possible.
- Prefer small, reviewable commits over large mixed-purpose commits.
- Avoid merging until failing checks, known blockers, or skipped tests are explicitly documented.
