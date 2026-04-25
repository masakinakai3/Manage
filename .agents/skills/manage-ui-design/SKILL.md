---
name: manage-ui-design
description: Use for Manage web app UI, UX, layout, visual polish, responsive behavior, Gantt/member-load/Insights design changes, screenshot-driven fixes, or browser-visible frontend quality improvements.
---

# Manage UI Design

Use this skill when improving or reviewing the visual behavior of the Manage web app.

## Workflow

1. Identify the affected view and entry points before editing:
   - Gantt: `frontend/js/gantt/gantt-renderer.js`, `frontend/css/gantt.css`, related `frontend/tests/gantt-renderer.test.js`
   - Member load: `frontend/js/member/member-view.js`, `frontend/css/member-view.css`, related `frontend/tests/member-view.test.js`
   - Insights: `frontend/js/insights-view.js`, dashboard/ribbon styles, API contract in `backend/routes/insights.py` when data shape changes
   - App shell/navigation/modals: `frontend/index.html`, `frontend/js/app.js`, `frontend/js/ui.js`, shared CSS
2. Preserve existing IDs, `data-*` hooks, and test selectors unless the task explicitly changes the contract.
3. Make the visible behavior match the user's screenshot or description, not just the code's apparent intent.
4. Prefer local rerender/state updates for visual-only changes. Avoid showing loading text or shifting headers for expand/collapse, selection, filter, or saved-view changes.
5. Verify responsive behavior at desktop width and a narrower width. Use the in-app browser or Playwright when available.
6. Add or update focused Vitest coverage for interaction/rendering changes when practical.

## Design Heuristics

- Keep controls grouped by task, with stable positions across state changes.
- Use high-signal surfaces. Remove empty shells rather than hiding only their inner content.
- Reuse existing color/status semantics. Completed state should neutralize the full row, including chips and numeric emphasis.
- Keep Japanese labels natural and compact.
- For Gantt proposal previews, use display-only overlays/chips instead of mutating allocation data unless the user asks to apply changes.
- For month interactions, keep one active month highlight and allow repeat-click clearing.
- For parity requests, inspect nested rows and summary rows in both views.

## Verification Commands

Run commands from `frontend/` unless noted.

```powershell
npm test -- --run gantt-renderer
npm test -- --run member-view
npm test -- --run insights
npm run build
```

For backend/API changes, run from the repo root:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_api.py -q
```

## Done Criteria

- The rendered UI matches the requested behavior on desktop and narrow widths.
- No local UI-only action causes avoidable loading flashes or layout shift.
- Existing keyboard/editing behavior still works where touched.
- Relevant tests and build were run, or skipped checks are explicitly reported.
