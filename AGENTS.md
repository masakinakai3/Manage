# Manage Agent Guidance

## リポジトリの目的

Manage は、テーマ、メンバー、月次配賦、負荷、インサイト、保存ビュー、スナップショット、データ入出力を扱うWindows向けローカルWebアプリです。UIは日本語を基本とし、配布物は単一ファイルの `dist/manage_app.exe` です。

## 技術スタック

- Backend: Python 3.10+、Flask、Flask-Login、Flask-SQLAlchemy、SQLite
- Frontend: Vite、Vanilla JavaScript、HTML、CSS
- Test: pytest、Vitest + jsdom
- Package: PyInstaller。`release` はonefile、`dev` はonedir
- CI: Windows、Python 3.11、Node.js 20

## 作業開始時

1. `git status --short` で既存差分と生成物を確認し、ユーザーの変更を戻さない。
2. 依頼が「調査のみ」「レビューのみ」「実装」「リリース」のどれかを確定する。調査・レビューだけならファイルを変更しない。
3. `Requirement.md`、`SoftwareDesign.md`、関連する `docs/software-design/`、実装、既存テストを照合する。文書とコードが違う場合は実装・設定・テストを根拠に差異を報告する。
4. 類似実装と呼び出し元を `rg` で探し、受け入れ条件を満たす最小範囲だけ変更する。
5. 下表から必要なSkillを読む。複数Skillを使う場合は、アーキテクチャ確認、タスク固有手順、ビルド・テストの順に使う。

## アーキテクチャの要点

```text
frontend/index.html
  -> frontend/js/app.js
     -> frontend/js/api.js -> /api/*
     -> gantt / member / insights 各画面
Flask backend/app.py
  -> backend/routes/*.py
     -> backend/models.py / backend/services/allocation_service.py
        -> SQLite
build_exe.py -> frontend/dist + manage_app.spec -> dist/manage_app.exe
```

主要な入口:

- アプリ初期化・認証・SPA配信: `backend/app.py`
- モデルと互換性制約: `backend/models.py`
- API: `backend/routes/`
- 負荷集計: `backend/services/allocation_service.py`
- 画面骨格: `frontend/index.html`
- ナビゲーションとCRUD結線: `frontend/js/app.js`
- APIクライアント: `frontend/js/api.js`
- 共有表示状態: `frontend/js/shared-state.js`
- Gantt: `frontend/js/gantt/gantt-renderer.js`
- Member Load: `frontend/js/member/member-view.js`
- Insights: `frontend/js/insights-view.js` と `backend/routes/insights.py`

詳細は `.agents/skills/manage-architecture/SKILL.md` を読む。

## 基本コマンド

リポジトリルートから実行する。初回セットアップ:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m pip install pytest
Push-Location frontend
npm ci
Pop-Location
```

開発サーバーは別々のターミナルで起動する。

```powershell
# terminal 1
Set-Location backend
..\.venv\Scripts\python.exe app.py

# terminal 2
Set-Location frontend
npm run dev
```

代表検証:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
Push-Location frontend
npm test
npm run lint
npm run format:check
npm run build
Pop-Location
git diff --check
```

注意:

- `tools/run_checks.ps1` のPythonはPATH依存である。仮想環境を有効化していない場合は、上記の `.venv` 明示コマンドを使う。
- `npm run format:check` は修正候補があっても終了コード0になる。出力が `Frontend formatting looks good.` であることを確認し、`Formatting changes suggested:` を合格扱いしない。
- 実行していないテストや目視確認を、実施済み・合格と報告しない。

検証の選び方とEXE作成は `.agents/skills/manage-build-and-test/SKILL.md` を読む。

## 絶対に守る制約

- ユーザーの既存差分、ローカルDB、認証情報、監査出力を削除・上書きしない。
- レビューのみの依頼で実装しない。原因調査のみの依頼で修正しない。
- 要求外の大規模リファクタリング、無関係な整形、依存更新、ビルド設定変更を行わない。
- テスト削除、警告無効化、例外の握りつぶし、基準の緩和で合格させない。
- 新規依存は既存機能で代替できないことを確認する。依頼範囲を広げる依存追加・更新は事前にユーザーへ確認する。
- UI変更では既存のID、`data-*`、テストセレクタ、キーボード操作を契約として扱う。
- 新しいユーザー向け文言は、周辺が意図的に英語でない限り自然な日本語にする。
- API・モデル変更では呼び出し元、Import/Export、文書、既存SQLiteの移行を確認する。
- `Allocation` の同一キーは `(theme_id, member_id, month)` で一意。`allocation_rate: 0` は明示値として保持し、削除は `null` で表す現行契約を崩さない。
- `theme_milestones` がマイルストーン実体で、`themes.milestone_month` / `milestone_label` は旧互換。片側だけを更新しない。
- `/api/export/*` と `/api/import/json`、ユーザー管理は現行では管理者専用。権限変更はAPI契約変更として扱う。
- EXE関連変更では `dist/manage_app.exe` のonefile経路を維持する。

## 自動生成物・ローカル状態

次を直接編集またはコミットしない。

- `frontend/node_modules/`, `frontend/dist/`, `dist/`, `build/`
- `.build_exe_state.json`, `.pytest_cache/`, `.playwright-cli/`
- `backend/database.db`, `backend/instance/`, `backend/secret_key.txt`, `backend/initial_admin_password.txt`, `dist/initial_admin_password.txt`
- `.codex/audit/`, `output/`, `tools/*.log`
- `.codex/environments/environment.toml`（自動生成指定。生成元から更新する）

`backend/app.py` 内の起動時軽量マイグレーションと `backend/migrations/` は互換性に関わる。既存DBを捨てて解決しない。

## タスク別Skill

| 依頼 | 使用するSkill |
|---|---|
| 構造、データフロー、変更先、影響範囲の確認 | `manage-architecture` |
| 機能追加、修正、リファクタリング、文書のみの変更 | `manage-code-change` |
| 不具合、テスト失敗、性能低下の原因調査 | `manage-bug-investigation` |
| コードや差分のレビューのみ | `manage-code-review` |
| テスト選択、セットアップ、ビルド、EXE、リリース確認 | `manage-build-and-test` |
| Web UIの実装・視覚修正 | `manage-ui-design` |
| 実画面のUI/UX監査のみ | `manage-ui-review` |
| CSVの内容、列、名前、Excel互換、`/api/export/csv` | `manage-csv-export` |

## 最低限の完了報告

- 変更ファイルと変更理由
- 実行したコマンドと結果
- 実行できなかった検証と理由
- 目視確認した画面・幅・状態、または未確認であること
- 互換性、移行、性能、セキュリティ、残存リスク
