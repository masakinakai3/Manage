---
description: バックエンドのテスト実行
---

# バックエンドのテスト実行

このプロジェクトでは、`pytest` フレームワークを用いてバックエンドのテストを実行します。バックエンドに修正を加えた際や、新しいAPIを実装した際には必ずテストを実行してください。

## 実行手順

プロジェクトのルートディレクトリで以下のコマンドを実行します。

```bash
python -m pytest tests/
```

### Tips
- 詳細なログ出力が必要な場合は、`-v` オプションを付けてください (`python -m pytest tests/ -v`)
- 特定のテストファイルのみ実行したい場合はパスを指定します（例: `python -m pytest tests/test_api.py`）
- `ModuleNotFoundError` 等が発生する場合は、仮想環境が有効になっているか、または必要なパッケージが `pip install -r backend/requirements.txt` でインストールされているか確認してください。
