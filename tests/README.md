# Backendテストガイド

## 前提

- Python 3.10以上。CIはPython 3.11を使用する。
- `backend/requirements.txt` とpytestが `.venv` に導入済みである。
- コマンドはリポジトリルートから実行する。

## 実行

```powershell
# 対象API test
.\.venv\Scripts\python.exe -m pytest tests\test_api.py -q

# 単一case
.\.venv\Scripts\python.exe -m pytest tests\test_api.py -k "bulk_allocations" -q

# backend全件
.\.venv\Scripts\python.exe -m pytest -q
```

失敗時は最初のroot causeを確認し、test削除、skip、assertion緩和で合格させない。

## ファイル

| ファイル | 主な責務 |
|---|---|
| `tests/conftest.py` | app factory、in-memory SQLite、認証済みclient fixture |
| `tests/test_models.py` | password、Member、Theme、Allocationの制約 |
| `tests/test_priority.py` | Theme priorityの保存とdefault |
| `tests/test_api.py` | 認証・権限、Theme、Allocation、Insights、SavedView、Importの回帰 |

## 重要契約

- 未認証APIは401、管理者専用APIへ一般ユーザーがアクセスすると403になる。
- `(theme_id, member_id, month)` は一意である。
- 配賦率0は明示値として保存され、`null` は配賦行を削除する。
- test DBはfixtureで作成・破棄し、`backend/database.db` を使用しない。

全体戦略とfrontend testは `UnitTestSpecification.md`、検証選択は `.agents/skills/manage-build-and-test/SKILL.md` を参照する。
