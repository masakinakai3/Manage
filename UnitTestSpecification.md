<!--
  Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
  Released under the MIT license
  https://opensource.org/licenses/mit-license.php
-->
# 単体テスト仕様書

## 1. 概要
本ドキュメントは、リソース管理ツールのバックエンド機能に対する単体テストの仕様をまとめたものである。

## 2. テスト環境
- **言語**: Python 3.10+
- **フレームワーク**: Pytest
- **データベース**: SQLite (インメモリモード `sqlite:///:memory:`)
- **クライアント**: Flask Test Client

## 3. テスト対象と範囲
### 3.1 対象モジュール
- **Models (`models.py`)**: データベースモデルの定義、バリデーション、制約。
- **API (`routes/*.py`)**: APIエンドポイントのレスポンスステータス、JSON構造、データ操作。

## 4. テストケース一覧

### 4.1 モデルテスト (`tests/test_models.py`)

| ID | テスト項目 | テストケース名 | 確認内容 | 期待値 |
|:--|:--|:--|:--|:--|
| M-01 | ユーザーパスワード | `test_password_hashing` | パスワードのハッシュ化と照合 | 正しいパスワードでTrue, 誤りでFalseが返ること |
| M-02 | メンバー作成 | `test_member_creation` | メンバー作成時のフィールド値 | 指定した値が設定され、`is_active`等のデフォルト値が正しいこと |
| M-03 | テーマ作成 | `test_theme_creation` | テーマ作成時のフィールド値 | 指定した値が設定され、`color`等のデフォルト値が正しいこと |
| M-04 | アサイン制約 | `test_allocation_unique_constraint` | 複合ユニーク制約の動作 | 同一(theme, member, month)への重複登録時に `IntegrityError` が発生すること |

### 4.2 APIテスト (`tests/test_api.py`)

| ID | テスト項目 | テストケース名 | 確認内容 | 期待値 |
|:--|:--|:--|:--|:--|
| A-01 | ログイン成功 | `test_login` | 正しい認証情報でのログイン | ステータスコード `200`, ユーザー名が含まれること |
| A-02 | ログイン失敗 | `test_login` | 誤った認証情報でのログイン | ステータスコード `401` |
| A-03 | テーマ一覧取得 | `test_get_themes` | テーマ一覧のGETリクエスト | ステータスコード `200`, 登録済みテーマが含まれること |
| A-04 | テーマ作成 | `test_create_theme` | 新規テーマのPOSTリクエスト | ステータスコード `201`, 作成されたテーマ名がレスポンスに含まれること |
| A-05 | アサイン一括登録 | `test_bulk_allocations` | `PUT /bulk` による新規登録 | ステータスコード `200`, `updated: 1`, DBに値が保存されること |
| A-06 | アサイン削除 | `test_bulk_allocations` | `rate: 0` 送信による削除 | ステータスコード `200`, DBからレコードが削除されること |

### 4.3 フロントエンドテスト (`frontend/tests/date-utils.test.js`)

| ID | テスト項目 | テストケース名 | 確認内容 | 期待値 |
|:--|:--|:--|:--|:--|
| F-01 | 月短縮表記 | `shortenMonth` | `YYYY-MM` → `YY-MM` 変換 | `2024-05` が `24-05` になること |
| F-02 | 月範囲生成 | `monthRange` | 開始月から終了月までの配列生成 | 指定範囲の月リストが正しく生成されること（年跨ぎ含む） |
| F-03 | 月加算 | `addMonths` | Nヶ月後の月計算 | 正の数・負の数・年跨ぎ計算が正しいこと |
| F-04 | 月フォーマット | `formatMonth` | スケール(1,3,6,12)に応じた表示変換 | `5月`, `Q2`, `H2`, `2024` 等に変換されること |
| F-05 | 稼働率集計 | `aggregateRate` | 指定期間の平均稼働率計算 | 期間内の非ゼロ値の平均が算出されること |

## 5. テスト実行手順
### バックエンド
プロジェクトルートにて以下のコマンドを実行する。

```bash
python -m pytest
```

### フロントエンド
`frontend` ディレクトリにて以下のコマンドを実行する。

```bash
cd frontend
npm test
```
