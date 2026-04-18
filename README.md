# Resource Manager

Resource Manager は、テーマ単位の計画とメンバー単位の負荷を同時に管理するための社内向けリソース計画ツールです。  
ガントチャート、メンバー負荷表、インサイト画面、保存ビュー、スナップショット比較、JSON バックアップ、CSV/XLSX エクスポートを 1 つのアプリで扱えます。

バックエンドは Flask + SQLite、フロントエンドは Vite + Vanilla JavaScript で構成されています。  
開発時は Flask サーバーと Vite 開発サーバーを分けて起動でき、配布時は PyInstaller で単一の Windows 実行ファイルにまとめられます。

## 主な機能

- ガントチャートによるテーマ別配賦管理
- メンバー負荷ビューによる月次負荷の確認
- テーマへのメンバー割り当てと配賦セル編集
- テーマのステータス、優先度、カテゴリ、マイルストーン、開発完了月の管理
- スナップショット保存と差分比較
- 保存ビューによる絞り込み条件と表示期間の再利用
- インサイト画面による健全性チェック、部門別負荷、推奨調整案の表示
- JSON バックアップのエクスポート / インポート
- CSV / XLSX エクスポート
- Undo / Redo、キーボードショートカット、サンプルデータ投入

## 技術スタック

- Backend: Python 3.10+, Flask, Flask-Login, Flask-SQLAlchemy, SQLite
- Frontend: Vite, Vanilla JavaScript, HTML, CSS
- Build: PyInstaller
- Test: pytest, Vitest

## ディレクトリ構成

```text
backend/      Flask API, models, services, migrations
frontend/     HTML, CSS, JavaScript, Vitest tests
tests/        pytest tests
tools/        lint / format / check scripts
docs/         開発運用ドキュメント
build_exe.py  EXE ビルドスクリプト
```

## セットアップ

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r backend\requirements.txt
pip install pytest
```

### Frontend

```powershell
cd frontend
npm install
cd ..
```

## 開発実行

### 1. Flask サーバーを起動

```powershell
cd backend
..\.venv\Scripts\python.exe app.py
```

起動先:

- Backend API / 組み込みフロント配信: `http://127.0.0.1:5001`

### 2. Vite 開発サーバーを起動

別ターミナルで実行します。

```powershell
cd frontend
npm run dev
```

起動先:

- Frontend dev server: `http://localhost:5173`

Vite は `/api` を `http://127.0.0.1:5001` にプロキシします。

## テストと静的チェック

### Backend

```powershell
python -m pytest
```

### Frontend

```powershell
cd frontend
npm test
npm run lint
npm run format:check
```

### Windows 用まとめ実行

```powershell
powershell -ExecutionPolicy Bypass -File tools\run_checks.ps1
```

## EXE ビルド

`build_exe.py` は増分ビルドに対応しています。  
入力に変更がない工程はスキップし、前回の成果物を再利用します。

### 通常実行

```powershell
.\.venv\Scripts\python.exe build_exe.py
```

### 強制再ビルド

```powershell
.\.venv\Scripts\python.exe build_exe.py --force
```

- 差分キャッシュを無視してフロントエンドと EXE を再ビルドします。

### クリーンビルド

```powershell
.\.venv\Scripts\python.exe build_exe.py --clean
```

- `dist/`、`build/`、`.build_exe_state.json` を削除してからフルビルドします。

出力先:

- `dist/manage_app.exe`

## 認証

- 初回起動時に `admin` ユーザーが自動作成されます。
- ローカル利用を前提としており、localhost からのアクセスでは自動ログインされます。
- API の一部はログイン必須です。

## 主要 API

- `/api/auth/*`
- `/api/themes`
- `/api/members`
- `/api/allocations`
- `/api/insights/overview`
- `/api/snapshots`
- `/api/saved-views`
- `/api/export/*`
- `/api/import/json`

## 関連ドキュメント

- [Requirement.md](Requirement.md)
- [SoftwareDesign.md](SoftwareDesign.md)
- [UserManual.md](UserManual.md)
- [UnitTestSpecification.md](UnitTestSpecification.md)
- [docs/APIContract.md](docs/APIContract.md)
- [docs/DevelopmentWorkflow.md](docs/DevelopmentWorkflow.md)
