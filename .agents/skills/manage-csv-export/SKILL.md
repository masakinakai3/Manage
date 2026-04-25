---
name: manage-csv-export
description: Use for Manage CSV export work, including Gantt CSV, member-load CSV, /api/export/csv, column/filename changes, Excel compatibility, escaping, permissions, docs, and regression tests.
---

# Manage CSV Export

Use this skill when changing or reviewing CSV export behavior in the Manage app.

## Entry Points

- Gantt CSV button and dataset: `frontend/js/gantt/gantt-renderer.js`
- Member-load CSV button and dataset: `frontend/js/member/member-view.js`
- Export API client wiring: `frontend/js/api.js`
- Shared CSV download endpoint: `backend/routes/export.py`
- API docs: `docs/APIContract.md`, `docs/software-design/04-data-and-api.md`
- Regression tests: `frontend/tests/gantt-renderer.test.js`, `frontend/tests/member-view.test.js`, relevant backend pytest when endpoint behavior changes

## Expected Behavior

- Match the live screen state, not a raw unfiltered dataset. Respect current period, scale, filters/search, row ordering, visible labels, memos, milestones, status, priority, rank, and theme/member metadata.
- Keep Japanese output labels natural and stable. Preserve explicit no-value labels such as `-`, no-rank, and `P0` when the UI shows them.
- Keep Excel-on-Windows compatibility. The backend `/api/export/csv` endpoint prepends a UTF-8 BOM and returns `text/csv; charset=utf-8`; preserve that unless the user explicitly asks to change the contract.
- Use robust CSV escaping for every cell. Quote values containing commas, quotes, CR/LF, or leading/trailing whitespace; escape quotes as doubled quotes.
- Preserve meaningful empty cells instead of dropping columns, especially in grid-shaped exports where column position carries meaning.
- Sanitize filenames on the backend and keep generated filenames descriptive enough to include the view and visible month range when practical.
- Keep permissions in mind: `/api/export/csv` is admin-only today. If a user-facing export should be available to non-admin users, change the auth contract deliberately and update docs/tests.

## Implementation Checklist

1. Identify whether the export is browser-generated, backend-generated, or a hybrid that posts generated CSV content to `/api/export/csv`.
2. Trace the dataset builder before editing string output. For Gantt, check `getGanttExportDataset()` and `getGanttGridExportDataset()`; for member load, check `exportCSV()`.
3. Add or update focused Vitest coverage for column labels, escaping, filters/visible range, and row shape.
4. If `/api/export/csv` changes, add or update backend tests for BOM, `Content-Type`, filename sanitization, empty-content errors, and auth behavior.
5. Update docs when columns, request body, response headers, permissions, or filenames change.
6. Run the narrow frontend test first (`npm test -- --run gantt-renderer` or `npm test -- --run member-view` from `frontend/`), then `npm run build` for broad frontend changes.

## MCP Guidance

- Use `context7` before relying on memory when current third-party CSV library behavior or browser download APIs matter.
- Use `openaiDeveloperDocs` before general web search for OpenAI, Codex, ChatGPT, Apps SDK, or OpenAI API export automation.
- Prefer local repo code and tests over web sources for this app's CSV contract; the current source of truth is the checked-in implementation and docs.
