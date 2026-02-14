# バックエンド単体テスト

## 前提条件
- Python 3.10以上
- 依存関係のインストール (`pip install -r backend/requirements.txt`)
- `pytest` のインストール (`pip install pytest`)

## テストの実行
プロジェクトのルートディレクトリから以下のコマンドを実行してください：

```bash
python -m pytest
```

詳細な出力を表示する場合：

```bash
python -m pytest -v
```

## 構成
- `conftest.py`: アプリセットアップ、テストクライアント、データベースのフィクスチャ定義。
- `test_models.py`: データベースモデル (User, Member, Theme, Allocation) のテスト。
- `test_api.py`: APIエンドポイント (認証, テーマ管理, アサイン管理) のテスト。
