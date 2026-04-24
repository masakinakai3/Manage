<!--
  Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
  Released under the MIT license
  https://opensource.org/licenses/mit-license.php
-->
# 単体テスト仕様書

## 1. 目的

本書は、現行リポジトリに含まれる自動テストの対象範囲、実行方法、確認観点を整理したものです。  
テストコードの実装内容に合わせて記載します。

## 2. テスト方針

本プロジェクトでは次の 2 系統のテストを採用しています。

- バックエンド: `pytest`
- フロントエンド: `Vitest`

狙いは以下のとおりです。

- モデル制約や API の基本動作を壊さない
- ガント画面とメンバー負荷画面の回帰を検知する
- 配賦編集、コピー / ペースト、マイルストーン表示などの主要操作を守る

## 3. テスト環境

### 3.1 バックエンド

- Python 3.10+
- pytest
- Flask Test Client
- SQLite インメモリ DB

`tests/conftest.py` では `create_app()` をテスト設定で起動し、各テストごとに DB を作成 / 廃棄します。

### 3.2 フロントエンド

- Node.js
- Vitest
- jsdom

各テストでは DOM をモックし、API 呼び出しや UI モジュールをモックして描画とイベント処理を検証します。

## 4. 実行方法

### 4.1 バックエンド

```powershell
python -m pytest
```

### 4.2 フロントエンド

```powershell
cd frontend
npm test
```

### 4.3 補助チェック

```powershell
cd frontend
npm run lint
npm run format:check
```

### 4.4 Windows での一括実行

```powershell
powershell -ExecutionPolicy Bypass -File tools\run_checks.ps1
```

## 5. バックエンドテスト仕様

### 5.1 `tests/test_models.py`

#### M-01 パスワードハッシュ検証

- 対象: `User.set_password`, `User.check_password`
- 目的: パスワード検証が正しく動作することを確認する
- 期待結果:
  - 正しいパスワードで `True`
  - 誤ったパスワードで `False`

#### M-02 メンバー作成

- 対象: `Member`
- 目的: メンバー作成時の基本属性とデフォルト値を確認する
- 期待結果:
  - `display_name`, `department`, `capacity` が保存される
  - `is_active` のデフォルトが `True`

#### M-03 テーマ作成

- 対象: `Theme`
- 目的: テーマ作成時の基本属性とデフォルト値を確認する
- 期待結果:
  - `name`, `status` が保存される
  - `color` のデフォルトが `#6366f1`

#### M-04 配賦一意制約

- 対象: `Allocation`
- 目的: `(theme_id, member_id, month)` の一意制約を確認する
- 期待結果:
  - 同一キーの重複挿入で `IntegrityError` が発生する

### 5.2 `tests/test_priority.py`

#### M-05 優先度保存

- 対象: `Theme.priority`
- 目的: 優先度が保存されることとデフォルト値を確認する
- 期待結果:
  - 明示設定した値が保存される
  - 未指定時のデフォルトが `0`

### 5.3 `tests/test_api.py`

#### A-01 ログイン成功 / 失敗

- 対象: `POST /api/auth/login`
- 目的: 認証の基本挙動を確認する
- 期待結果:
  - 正しい資格情報で `200`
  - 誤った資格情報で `401`

#### A-02 テーマ一覧取得

- 対象: `GET /api/themes`
- 目的: 登録テーマが API から取得できることを確認する
- 期待結果:
  - `200`
  - 登録済みテーマ名がレスポンスに含まれる

#### A-03 テーマ作成とマイルストーン保存

- 対象: `POST /api/themes`
- 目的: テーマ作成時にマイルストーン情報が保存されることを確認する
- 期待結果:
  - `201`
  - 代表マイルストーン列が先頭要素で更新される
  - `milestones` 配列が保存される

#### A-04 テーママイルストーン更新

- 対象: `PUT /api/themes/{id}`
- 目的: テーマ更新でマイルストーン配列が置き換わることを確認する
- 期待結果:
  - `200`
  - レスポンスの `milestones` が更新後内容になる
  - DB 上の `ThemeMilestone` が更新後内容になる

#### A-05 配賦一括更新

- 対象: `PUT /api/allocations/bulk`
- 目的: 新規登録と 0 指定削除を確認する
- 期待結果:
  - 追加時に `updated: 1`（削除操作は件数に含まれない）
  - DB にレコードが作成される
  - `allocation_rate: 0` 更新でレコードが削除される

#### A-06 インサイト概況取得

- 対象: `GET /api/insights/overview`
- 目的: インサイト集計が返ることを確認する
- 期待結果:
  - `summary`, `health_checks`, `recommendations`, `dashboard` を含む
  - `project_ribbon` が返る
  - 想定の健全性チェックコードが含まれる

#### A-07 保存ビュー CRUD

- 対象: `POST /api/saved-views`, `GET /api/saved-views`, `DELETE /api/saved-views/{id}`
- 目的: 保存ビューの登録、取得、削除を確認する
- 期待結果:
  - `201` で作成できる
  - 一覧に作成済み ID が含まれる
  - DB に JSON 状態が保存される
  - 削除後に DB から消える

#### A-08 開発ランク空更新

- 対象: `PUT /api/themes/{id}`
- 目的: `dev_rank` を空文字列に更新できることを確認する
- 期待結果:
  - `200`
  - レスポンスの `dev_rank` が `""` になる

#### A-09 JSON インポートでの dev_rank・dev_complete_months 保持

- 対象: `POST /api/import/json`
- 目的: JSON バックアップ復元時に `dev_rank` と `dev_complete_months` が保持されることを確認する
- 期待結果:
  - `200`
  - 復元後のテーマに `dev_rank` が保存される
  - 復元後のテーマに `dev_complete_months`（完了状態付き）が保存される

#### A-10 Project Ribbon テーマ負荷集計

- 対象: `GET /api/insights/overview`
- 目的: Project Load Ribbon が同一テーマの複数メンバー配賦を正しく集計することを確認する
- 期待結果:
  - Ribbon の `total_load` が全メンバー合算値になる
  - `projects` 配列内のテーマ `load` も合算値になる

## 6. フロントエンドテスト仕様

### 6.1 `frontend/tests/date-utils.test.js`

#### F-01 `shortenMonth`

- 目的: `YYYY-MM` を短縮表記へ変換できること

#### F-02 `monthRange`

- 目的: 月範囲を年跨ぎ含めて正しく列挙できること

#### F-03 `addMonths`

- 目的: 月加算 / 減算が正しいこと

#### F-04 `formatMonth`

- 目的: スケールごとに月表示が変わること

#### F-05 `aggregateRate`

- 目的: 期間集計時に非ゼロ月の平均値が返ること

### 6.2 `frontend/tests/gantt-renderer.test.js`

#### G-01 単一クリック編集

- 目的: セルクリックでインラインエディタが開くこと

#### G-02 キーボード移動と直接入力

- 目的: 矢印移動と数字キー起点の編集開始を確認する

#### G-03 コピー / ペースト

- 目的: 範囲コピーと貼り付けで `bulkUpdate` が正しい payload を送ること

#### G-04 テーマサマリ行描画

- 目的: テーマサマリの配賦率表示が正しいこと

#### G-05 Excel 出力データセット

- 目的: ガント形状の XLSX 出力用データセットが生成できること

#### G-06 マイルストーン表示

- 目的: 該当月にマイルストーンチップが表示されること

#### G-07 フィルタ UI 同期

- 目的: 複数フィルタが状態と同期すること

#### G-08 優先度バッジ

- 目的: `P0` バッジが表示されること

#### G-09 ガント画面からのマイルストーン編集

- 目的: モーダル編集後に `themes.update` が期待 payload で呼ばれること

### 6.3 `frontend/tests/gantt-editor.test.js`

#### E-01 Enter 保存

- 目的: Enter 押下で保存しつつ編集フローを継続できること

#### E-02 矢印キー遷移

- 目的: 矢印キーで値を保持したまま次セル遷移できること

### 6.4 `frontend/tests/gantt-dnd.test.js`

#### D-01 同一テーマ内の DnD

- 目的: Undo / Redo 用 payload が正しく構築されること

#### D-02 異テーマへのドロップ無効化

- 目的: 別テーマセルへのドロップが無視されること

### 6.5 `frontend/tests/member-view.test.js`

#### MV-01 マイルストーン表示

- 目的: メンバー負荷画面のテーマ行にマイルストーンが表示されること

#### MV-02 開発完了月表示

- 目的: 開発完了マーカーが該当月に表示されること

#### MV-03 集約期間での表示

- 目的: 3 か月などの集約表示でもマイルストーンと開発完了月が正しく属すること

## 7. CI 実行仕様

GitHub Actions の `windows-latest` 上で次を実行します。

1. Python 3.11 と Node.js 20 をセットアップ
2. バックエンド依存をインストール
3. フロントエンド依存を `npm ci`
4. `python -m pytest`
5. `npm test`
6. `npm run lint`
7. `npm run format:check`

## 8. 現時点のテスト範囲外

現行自動テストでは次は限定的、または未カバーです。

- EXE ビルド結果そのものの自動検証
- 実ブラウザでの E2E シナリオ
- JSON インポート / エクスポート API の詳細検証（A-09 で部分カバー済み）
- スナップショット API の詳細検証
- 権限制御の網羅的ケース

今後 E2E を導入する場合は、主要ユーザーフローを次の順で追加するのが望ましいです。

- ログインからガント表示まで
- テーマ作成から配賦編集まで
- 保存ビュー / スナップショット利用
- JSON バックアップ復元
