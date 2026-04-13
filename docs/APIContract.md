# API Contract

## Overview

- Base path: `/api`
- Auth: session cookie
- Format: `application/json` unless file upload/download

## Themes

- `GET /themes`
  - Returns: `theme_id`, `name`, `category`, `status`, `color`, `priority`, `start_month`, `end_month`, `member_ids`, `member_count`
- `POST /themes`
  - Body: `name`, optional `category`, `status`, `color`, `priority`, `start_month`, `end_month`
- `PUT /themes/{theme_id}`
  - Body: any updatable theme field, optional `member_ids`
- `DELETE /themes/{theme_id}`

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

## Snapshots

- `GET /snapshots`
- `GET /snapshots/{id}`
- `POST /snapshots`
  - Body: `name`, `data`
- `DELETE /snapshots/{id}`

## Export / Import

- `GET /export/json`
- `POST /export/csv`
  - Body: `content`, `filename`
- `POST /export/xlsx`
  - Body: `headers`, `rows`, `filename`
- `POST /import/json`
  - Multipart file upload with field name `file`

## Error Contract

- Validation errors: `400` with `{ "error": "..." }`
- Missing resources: `404` with `{ "error": "..." }`
- Authentication failures: `401` with `{ "error": "..." }`
- Server failures: `500` with `{ "error": "..." }`
