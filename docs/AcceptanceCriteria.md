# Acceptance Criteria

## UX / UI

- Gantt view and member-load view both render without requiring preloaded data.
- First-use onboarding is visible until dismissed and provides a working sample-data path.
- Empty and low-data situations still show guidance instead of blank screens.
- Saved views can restore period, scale, search, and grouping settings.
- Insights screen shows health checks, recommendations, and dashboard summaries for the active horizon.

## Editing

- Allocation cell editing continues to work from the grid and the detail panel.
- Undo and redo still function for allocation changes.
- Period navigation and scale switching remain synchronized across related views.

## Aggregation

- Category, status, and department summaries remain visible in the Gantt workspace.
- Member-load summaries continue to highlight overload and slack situations.
- Dashboard metrics show monthly trend, department load, top themes, and distribution summaries.

## Export / Import

- Standard CSV and Excel export still work.
- Advanced export supports column selection and review-oriented templates.
- JSON export and import continue to support backup and restore.

## Keyboard / Responsive

- Shortcut help is accessible in-product.
- Shortcuts do not fire while typing in an input, select, or textarea.
- Narrow-width layouts remain usable for viewing, filtering, and confirmation workflows.

## Process / Documentation

- Documentation update rules are defined in `docs/DocumentationOperations.md`.
- Development workflow standards are defined in `docs/DevelopmentWorkflow.md`.
- PR template exists at `.github/pull_request_template.md`.

## Quality

- `npm test`
- `npm run build`
- `pytest -q`
