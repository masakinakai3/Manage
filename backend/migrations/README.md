# Database Migrations

このディレクトリは、SQLite スキーマの変更履歴を管理するための基準ディレクトリです。

## 運用ルール

- 新しいスキーマ変更は、`NNN_description.sql` 形式で追加します
- 既存データに影響する変更は、`BEGIN TRANSACTION` と `COMMIT` を明示します
- アプリ側の自動補正処理を追加した場合も、対応する SQL をここに残します
- リリース前に、空 DB と既存 DB の両方で適用確認を行います

## 現在のファイル

- `001_initial_schema.sql`
- `002_allocation_unique_index.sql`
