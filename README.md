# Resource Manager

Resource Manager は、テーマ、メンバー、アロケーション、インサイト、保存ビュー、スナップショット、データ入出力をひとつの画面群で扱える、デスクトップ指向のリソース計画ツールです。

バックエンドは Flask + SQLite、フロントエンドは Vite + Vanilla JavaScript で構成されており、Windows 向け配布は PyInstaller で行います。開発時は backend / frontend を別々に起動でき、配布時は EXE としてビルドできます。

## 主な機能

- テーマ別・月別の Gantt ベース配員管理
- メンバー負荷の可視化と過負荷警告
- 期間、表示粒度、各種フィルタ条件の保存ビュー
- スナップショット保存と差分確認
- ダッシュボード形式のインサイトとシナリオシミュレーション
- JSON バックアップのエクスポート / インポート
- CSV / XLSX エクスポート
- Undo / Redo とキーボードショートカット

## 技術スタック

- Backend: Python 3.10+, Flask, Flask-Login, Flask-SQLAlchemy, SQLite
- Frontend: Vite, Vanilla JavaScript, HTML, CSS
- Build: PyInstaller
- Test: pytest, Vitest

## ディレクトリ構成

```text
backend/      Flask API、モデル、サービス、マイグレーション
frontend/     HTML、CSS、JavaScript、Vitest テスト
tests/        pytest テスト
tools/        lint / format / check 用スクリプト
docs/         開発・運用・設計関連ドキュメント
build_exe.py  EXE ビルドスクリプト
manage_app.spec  PyInstaller 定義
```

`frontend/node_modules/`、`frontend/dist/`、`dist/`、`build/`、`.pytest_cache/`、ローカルのテスト出力ファイルなどの生成物は、意図的にバージョン管理対象外にしています。

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

## ローカル開発

### 1. Flask サーバーを起動

```powershell
cd backend
..\.venv\Scripts\python.exe app.py
```

アクセス先:

- Backend API / 静的配信: `http://127.0.0.1:5001`

### 2. Vite 開発サーバーを起動

別ターミナルで次を実行します。

```powershell
cd frontend
npm run dev
```

アクセス先:

- Frontend 開発サーバー: `http://localhost:5173`

Vite は `/api` を `http://127.0.0.1:5001` にプロキシします。

## テストとチェック

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

### Windows 一括チェック

```powershell
powershell -ExecutionPolicy Bypass -File tools\run_checks.ps1
```

## EXE ビルド

`build_exe.py` はインクリメンタルビルドに対応しています。frontend / backend の入力に変更がなければ、前回のビルド成果物を再利用します。

### Release ビルド

配布や最終確認にはこちらを使います。単一ファイルの EXE を生成します。

```powershell
.\.venv\Scripts\python.exe build_exe.py
```

出力:

- `dist/manage_app.exe`

### Dev ビルド

日常の実装中に、より高速にパッケージ確認したいときはこちらを使います。`onedir` 形式で出力します。

```powershell
.\.venv\Scripts\python.exe build_exe.py --profile dev
```

出力:

- `dist/manage_app/manage_app.exe`

補足:

- `dev` は `.\.venv\Scripts\python.exe` が存在する場合、自動的にそれを優先して使います。
- `dev` は最終的な単一 EXE 化を省くため、再ビルドが高速です。
- frontend のみ変更された場合、`dev` は PyInstaller を再実行せず `dist/manage_app/dist` を更新します。
- `release` はパッケージング前に古い `onedir` 成果物を掃除するため、`_internal` や `_release_bundle` の残骸が最終出力に混ざりません。
- `release` がデフォルトなので、従来のビルドコマンドはそのまま使えます。

### 強制リビルド

```powershell
.\.venv\Scripts\python.exe build_exe.py --force
```

- キャッシュ上は変更なしでも、frontend とパッケージの両方を再ビルドします。

`dev` プロファイルと組み合わせることもできます。

```powershell
.\.venv\Scripts\python.exe build_exe.py --profile dev --force
```

### クリーンリビルド

```powershell
.\.venv\Scripts\python.exe build_exe.py --clean
```

- `dist/`、`build/`、`.build_exe_state.json` を削除したうえで、最初から再ビルドします。

## 推奨ビルド運用

- 実装中の確認には `--profile dev` を使う
- バイナリ共有前、最終スモークテスト前、納品前にはデフォルトの `release` ビルドを使う
- 依存やパッケージ定義変更後に挙動が怪しい場合は `--clean` を使う

## セキュリティ上の注意

- 初回起動時、管理者ユーザーが存在しなければデフォルトの `admin` ユーザーを作成します
- 自動ログインは loopback アクセスのみに制限されています
- API はローカルデスクトップ利用を前提にしています

## 主な API ルート

- `/api/auth/*`
- `/api/themes`
- `/api/themes/{id}/members`, `/api/themes/{id}/members/bulk`
- `/api/members`
- `/api/allocations`
- `/api/insights/overview`
- `/api/snapshots`
- `/api/saved-views`
- `/api/export/*`
- `/api/import/json`

## 関連ドキュメント

- [SoftwareDesign.md](SoftwareDesign.md): ソフトウェア全体の設計、アーキテクチャ、主要ファイル、データモデル、API、ビルド運用の全体像をまとめた主設計書です。
- [docs/APIContract.md](docs/APIContract.md): フロントエンドとバックエンドの間でやり取りする API の入出力契約を整理した資料です。
- [docs/DevelopmentWorkflow.md](docs/DevelopmentWorkflow.md): 実装、レビュー、検証、ビルド確認までを含む日常開発の進め方を定義したガイドです。
- [docs/DocumentationOperations.md](docs/DocumentationOperations.md): どの変更でどの文書を更新すべきか、ドキュメント保守のルールをまとめた運用資料です。
- [docs/AcceptanceCriteria.md](docs/AcceptanceCriteria.md): 期待する完成条件や受け入れ基準を整理した、確認観点の一覧です。
