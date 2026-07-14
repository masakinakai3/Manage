# Compatibility: Core Guidance

このディレクトリは旧エージェント向けの互換入口です。正規の共通指示は `AGENTS.md`、タスク別手順は `.agents/skills/` にあります。新しい指示をこのファイルへ追加しないでください。

- 構造・変更影響: `.agents/skills/manage-architecture/SKILL.md`
- 実装: `.agents/skills/manage-code-change/SKILL.md`
- ビルド・テスト: `.agents/skills/manage-build-and-test/SKILL.md`
- UI実装: `.agents/skills/manage-ui-design/SKILL.md`
- CSV: `.agents/skills/manage-csv-export/SKILL.md`

最低限、Flask + SQLite、Vite + Vanilla JavaScript、PyInstaller onefileという現行構成を維持し、React等の別frontend stackを前提にしないでください。
