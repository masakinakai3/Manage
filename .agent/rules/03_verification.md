# Compatibility: Verification

検証の正規手順は `.agents/skills/manage-build-and-test/SKILL.md` を使用してください。UIは実装時 `manage-ui-design`、レビューのみなら `manage-ui-review` も使用します。

重要な互換注意:

- pytestはリポジトリルートから `.\.venv\Scripts\python.exe -m pytest` を優先する。
- frontend commandは `frontend/` で実行する。
- `npm run format:check` は修正候補があっても終了コード0になるため、`Frontend formatting looks good.` という出力を確認する。
- backendとViteは別ターミナルで起動する。同じ逐次スクリプトでbackend起動後にViteを置かない。
- 実行していないtest、browser確認、EXE起動を合格と報告しない。
