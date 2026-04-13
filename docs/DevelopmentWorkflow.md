# Development Workflow Standard

## Definition of Done

- Feature behavior is implemented and manually smoke-checked.
- Backend tests and frontend tests pass locally.
- Build succeeds for the frontend bundle.
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

## Branch and Merge Guidance

- Keep feature branches focused on one user outcome when possible.
- Prefer small, reviewable commits over large mixed-purpose commits.
- Avoid merging until failing checks, known blockers, or skipped tests are explicitly documented.
