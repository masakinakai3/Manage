# Manage Codex Guidance

## Product Context

- This repository is a Windows/PowerShell local resource-management web app with a Flask backend and Vite frontend.
- The preferred packaged deliverable is `dist/manage_app.exe`; keep the one-file EXE path working when packaging behavior changes.
- The UI is Japanese-first. New user-facing labels, empty states, errors, and help text should be readable Japanese unless the surrounding surface is intentionally English.

## Frontend Quality Bar

- For UI/design work, preserve the existing app structure and design language before inventing a parallel system.
- Treat rendered screenshots and browser-visible behavior as the source of truth. If code interpretation and the screen disagree, fix what the user can actually see.
- Avoid layout shift for local UI-only actions such as expand/collapse, filter changes, selection, and saved-view switching. Prefer rerender-only paths over data refetch when possible.
- Keep related controls adjacent and visually stable. Small header/button movement is a real regression.
- For Gantt and member-load parity, check nested project/theme rows, not only top-level summaries.
- Completed rows should read as completed across the whole row: labels, numbers, chips, warning colors, and rate colors all need neutral treatment.
- Month highlighting should default to a single active highlight that can be cleared by clicking the same month again.
- Keep Insights focused on high-signal decision support. Do not reintroduce dense summary panels into Gantt unless explicitly requested.

## Repo Entry Points

- Frontend shell: `frontend/index.html`
- App/navigation/auth wiring: `frontend/js/app.js`
- API client: `frontend/js/api.js`
- Shared view state: `frontend/js/shared-state.js`
- Gantt rendering and export UI: `frontend/js/gantt/gantt-renderer.js`
- Member load view: `frontend/js/member/member-view.js`
- Insights view: `frontend/js/insights-view.js`
- Backend app/auth/session setup: `backend/app.py`
- Insights API: `backend/routes/insights.py`

## Verification

- Frontend package commands run from `frontend/`.
- For focused frontend changes, prefer the narrow Vitest target first, for example `npm test -- --run gantt-renderer` or `npm test -- --run member-view`.
- Before considering broad frontend work complete, run `npm run build`.
- For backend/API changes, run the relevant pytest target from the repo root, usually `.\.venv\Scripts\python.exe -m pytest tests/test_api.py -q`.
- For visual work, use the in-app browser or Playwright when available and verify desktop plus a narrower/mobile width.

## Working Rules

- Do not revert user changes. Inspect current files and patch surgically, especially in long frontend files.
- Keep changes end-to-end when a feature crosses data model, API, import/export, frontend rendering, docs, and tests.
- Prefer durable repo-resident guidance, tests, and docs over chat-only advice.
- If a request is about Web UI design quality, use the `manage-ui-design` skill.
- For OpenAI, Codex, ChatGPT, Apps SDK, or OpenAI API questions, use the `openaiDeveloperDocs` MCP server before general web search.
- For current third-party library/framework usage, prefer the `context7` MCP server when available before relying on stale memory.
