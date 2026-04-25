# API Contract

## Overview

- Base path: `/api`
- Auth: session cookie
- Format: `application/json` unless file upload/download
- **Interactive Documentation**: `/apidocs` (Swagger UI) にて詳細なスキーマと実行環境を提供しています。

## Auth

- `POST /auth/login`
  - Body: `username`, `password`
  - Returns: user object
- `POST /auth/logout`
- `GET /auth/me`
  - Returns: current user object
- `GET /auth/users` (admin only)
- `POST /auth/users` (admin only)
  - Body: `username`, `password`, `role`

## Themes

- `GET /themes`
  - Returns: `theme_id`, `name`, `category`, `status`, `color`, `priority`, `dev_rank`, `start_month`, `end_month`, `dev_complete_month`, `dev_complete_months`, `milestones`, `milestone_month`, `milestone_label`, `member_ids`, `member_count`
  - `dev_complete_months` is an array of `{ month, is_completed }`
  - `milestones` is an array of `{ id, month, label, position, is_completed }`
  - `milestone_month`, `milestone_label`: **deprecated** — 後方互換のために保持。実体は `milestones[]` を使用すること
- `POST /themes`
  - Body: `name`, optional `category`, `status`, `color`, `priority`, `dev_rank`, `start_month`, `end_month`, `milestones`, `dev_complete_months`
- `PUT /themes/{theme_id}`
  - Body: any updatable theme field, optional `member_ids`, `milestones`, `dev_complete_months`
- `DELETE /themes/{theme_id}`
- `POST /themes/{theme_id}/members`
  - Body: `member_id`
  - Assigns a single member to the theme
- `POST /themes/{theme_id}/members/bulk`
  - Body: `member_ids` (array of member IDs)
  - Assigns multiple members to the theme at once
  - Returns: `{ message, theme }`
- `DELETE /themes/{theme_id}/members/{member_id}`

## Members

- `GET /members?active=true|false`
  - Returns: `member_id`, `display_name`, `department`, `capacity`, `is_active`
- `POST /members`
  - Body: `display_name`, optional `department`, `capacity`
- `PUT /members/{member_id}`
  - Body: any updatable member field
- `DELETE /members/{member_id}`

## Allocations

- `GET /allocations?from=YYYY-MM&to=YYYY-MM&theme_id=&member_id=`
  - Returns allocation rows with `memo` and `updated_at`
- `PUT /allocations/single`
  - Body: `theme_id`, `member_id`, `month`, `allocation_rate`, optional `memo`
- `PUT /allocations/bulk`
  - Body: array of single-update payloads
- `GET /allocations/load/themes?from=&to=`
- `GET /allocations/load/members?from=&to=`
- `GET /allocations/warnings?from=&to=`

## Insights

- `GET /insights/overview?from=YYYY-MM&to=YYYY-MM`
  - Returns: `summary`, `health_checks`, `health_groups`, `recommendations`, `dashboard`
  - `dashboard` contains: `forecast`, `department_load`, `impact_themes`, `project_ribbon`

## Snapshots

- `GET /snapshots`
- `GET /snapshots/{id}`
- `POST /snapshots`
  - Body: `name`, `data`
- `DELETE /snapshots/{id}`

## Saved Views

- `GET /saved-views`
  - Returns array of saved views with `id`, `name`, `view`, `state`, `created_at`, `updated_at`
- `POST /saved-views`
  - Body: `id`, `name`, `view`, `state`
  - Upserts a saved view
- `DELETE /saved-views/{id}`

## Export / Import

- `GET /export/json`
- `POST /export/csv`
  - Body: `content`, `filename`
  - Gantt screen CSV is generated in the browser from the visible grid dataset. It preserves the current visible period, active filters, row order, collapsed rows, labels, rates, milestone text, and memo-derived cell text, then downloads a UTF-8 BOM CSV directly.
- `POST /export/xlsx`
  - Body: `headers`, `rows`, `filename`, optional `layout` (`gantt` for structured layout), `header_labels`
- `POST /import/json`
  - Multipart file upload with field name `file`

## Error Contract

- Validation errors: `400` with `{ "error": "..." }`
- Missing resources: `404` with `{ "error": "..." }`
- Authentication failures: `401` with `{ "error": "..." }`
- Server failures: `500` with `{ "error": "..." }`
