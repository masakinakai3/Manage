# Data and API

## 1. データモデル

### 1.1 コアモデル

| モデル | 主キー | 主な属性 |
|---|---|---|
| `Theme` | `theme_id` | `name`, `category`, `status`, `priority`, `start_month`, `end_month` |
| `Member` | `member_id` | `display_name`, `department`, `capacity`, `is_active` |
| `Allocation` | `id` | `theme_id`, `member_id`, `month`, `allocation_rate`, `memo` |

### 1.2 補助モデル

| モデル | 用途 |
|---|---|
| `ThemeMilestone` | テーマ内の節目管理 |
| `SavedView` | 表示状態の保存 |
| `Snapshot` | 比較用状態保存 |
| `User` | ログインユーザー |

## 2. API マップ

### 2.1 一覧

| API | メソッド | 説明 |
|---|---|---|
| `/api/auth/login` | POST | ログイン |
| `/api/auth/logout` | POST | ログアウト |
| `/api/auth/me` | GET | 現在ユーザー |
| `/api/themes` | GET/POST | テーマ一覧・作成 |
| `/api/themes/{id}` | PUT/DELETE | テーマ更新・削除 |
| `/api/themes/{id}/members` | POST | テーマへメンバー追加 |
| `/api/themes/{id}/members/bulk` | POST | テーマへメンバー一括追加 |
| `/api/themes/{id}/members/{member_id}` | DELETE | テーマからメンバー解除 |
| `/api/members` | GET/POST | メンバー一覧・作成 |
| `/api/members/{id}` | PUT/DELETE | メンバー更新・削除 |
| `/api/allocations` | GET | 配員一覧 |
| `/api/allocations/bulk` | PUT | 配員一括更新 |
| `/api/allocations/single` | PUT | セル単位更新 |
| `/api/allocations/load/themes` | GET | テーマ負荷集計 |
| `/api/allocations/load/members` | GET | メンバー負荷集計 |
| `/api/allocations/warnings` | GET | 容量超過警告 |
| `/api/insights/overview` | GET | インサイト一式 |
| `/api/snapshots` | GET/POST | スナップショット一覧・作成 |
| `/api/snapshots/{id}` | GET/DELETE | スナップショット取得・削除 |
| `/api/saved-views` | GET/POST | 保存ビュー一覧・保存 |
| `/api/saved-views/{id}` | DELETE | 保存ビュー削除 |
| `/api/export/csv` | POST | CSV ダウンロード |
| `/api/export/xlsx` | POST | XLSX ダウンロード |
| `/api/export/json` | GET | フルバックアップ |
| `/api/import/json` | POST | フルリストア |

## 3. 代表リクエスト

### 3.1 配員単一更新

```json
{
  "theme_id": 1,
  "member_id": 2,
  "month": "2026-05",
  "allocation_rate": 60,
  "memo": "Implementation"
}
```

### 3.2 保存ビュー

```json
{
  "id": "view-1712345678901",
  "name": "Q2 review",
  "view": "gantt",
  "state": {
    "preset": "current-quarter",
    "startMonth": "2026-04",
    "scale": 1,
    "ganttSearch": "core"
  }
}
```

## 4. Import / Export 契約

### 4.1 JSON Export の内容

| キー | 内容 |
|---|---|
| `version` | バックアップバージョン |
| `exported_at` | エクスポート日時 |
| `themes` | テーマ一覧 |
| `members` | メンバー一覧 |
| `allocations` | 配員一覧 |
| `theme_members` | テーマ-メンバー紐付け |

### 4.2 Import の前提

- `export/json` 形式の JSON が前提
- 復元は全置換
- 既存データは削除される
- 孤立した allocation はスキップされる

## 5. 制約

| 制約 | 説明 |
|---|---|
| `Allocation` の一意性 | 1 テーマ × 1 メンバー × 1 月 は 1 行のみ |
| 月表現 | `YYYY-MM` 文字列で統一 |
| capacity | 基本は 100 をフル稼働基準として扱う |
| inactive member | 一部集計や警告では除外される |
