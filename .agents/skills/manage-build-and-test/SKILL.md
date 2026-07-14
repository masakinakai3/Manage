---
name: manage-build-and-test
description: Manageリポジトリのセットアップ、pytest・Vitest・lint・format・Vite buildの選択と実行、開発サーバー、PyInstallerのdev/release EXE、リリース前確認を扱うSkill。検証計画、CI再現、ビルド失敗、dist/manage_app.exe作成で使用する。
---

# Manage Build and Test

## 目的

変更範囲に比例した検証を選び、実行結果と未実施項目を正確に報告する。リリース依頼ではonefile EXEの実在まで確認する。

## 使用条件

- セットアップ、テスト、lint、format、ビルド、起動方法を判断する。
- CI失敗をローカルで再現する。
- `dist/manage_app.exe` またはdev onedirを作成・検証する。
- リリース前チェックを行う。

## 使用しない条件

- 原因が未確定の不具合や性能低下では、検証コマンドを修正手段にせず、再現と原因特定を先に行う。
- UIの見た目は、対象画面の実装またはレビュー手順で定めた状態と幅をbrowserで確認する。
- コードレビューだけなら、差分理解に不要なcommandを勝手に実行しない。

## 事前確認

1. `git status --short` と変更ファイルを確認する。
2. `.venv\Scripts\python.exe`、`frontend/node_modules/`、Node/npmの有無を確認する。
3. `frontend/package.json`、`.github/workflows/ci.yml`、`build_exe.py --help` を実体として扱う。
4. セットアップ済みなら依存を再インストールしない。

## 手順

1. 変更ファイルとユーザーの完了条件から必要な検証層を選ぶ。
2. 最も狭い関連testを実行し、失敗時はroot causeを特定する。
3. 変更範囲に応じてfull suite、lint、format出力、bundleへ広げる。
4. UI変更はbrowser、配布変更は該当profileのEXEを追加確認する。
5. command、作業directory、結果、未実施項目を記録する。

## セットアップ

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m pip install pytest
Push-Location frontend
npm ci
Pop-Location
```

lockfileを維持した再現セットアップには `npm ci` を使う。依存を意図的に更新する依頼でない限り `npm install` でlockfileを変えない。

## 検証選択

| 変更 | 最初に実行 | 完了前の追加確認 |
|---|---|---|
| Backend model | `pytest tests/test_models.py -q` または対象test | `pytest -q`、既存DB移行の確認 |
| API / auth / import/export | `pytest tests/test_api.py -q` または `-k` | `pytest -q`、API文書 |
| 日付・小ユーティリティ | 対応する単一Vitest | `npm run lint`, `npm run format:check` |
| Gantt | `npm test -- --run gantt-renderer` と関連editor/DnD | `npm test`, `npm run build` |
| Member Load | `npm test -- --run member-view` | `npm test`, `npm run build` |
| Insights | `npm test -- --run insights-view`、必要ならpytest | `npm test`, `npm run build` |
| HTML/CSS/画面結線 | 関連Vitest | lint、format出力確認、build、実ブラウザ |
| 文書のみ | パス・リンク・コマンド照合 | `git diff --check`。コードテストは原則不要 |
| パッケージング | `build_exe.py --profile dev` | 配布時はrelease onefileと起動確認 |

`npm test -- --run <pattern>` は `frontend/` で実行する。pytestはリポジトリルートで `.venv` を明示する。

## 代表コマンド

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_api.py -q
.\.venv\Scripts\python.exe -m pytest -q

Push-Location frontend
npm test -- --run gantt-renderer
npm test
npm run lint
npm run format:check
npm run build
Pop-Location

git diff --check
```

`tools/run_checks.ps1` はbackend test、frontend test、lint、formatを順に実行するが、PythonはPATH依存でfrontend buildを含まない。仮想環境を有効化した場合だけ補助的に使う。

`npm run format:check` は差分候補があっても終了コード0である。`Frontend formatting looks good.` を合格条件とし、`Formatting changes suggested:` が出た場合は未合格として対象ファイルを確認する。

## 開発サーバーと画面確認

別ターミナルで起動する。

```powershell
Set-Location backend
..\.venv\Scripts\python.exe app.py
```

```powershell
Set-Location frontend
npm run dev
```

Viteは `http://localhost:5173`、backendは `http://127.0.0.1:5001`。`.codex/environments/environment.toml` の単一アクションはbackendでブロックされるため、両方が起動した証拠には使わない。

## EXEビルド

```powershell
# 反復確認: onedir
.\.venv\Scripts\python.exe build_exe.py --profile dev

# 配布: onefile
.\.venv\Scripts\python.exe build_exe.py
```

`--force` はキャッシュを無視する必要がある場合だけ使う。`--clean` は `dist/`、`build/`、状態ファイルを削除するため、生成物を消してよいことを確認してから使う。

release完了条件:

```powershell
Test-Path dist\manage_app.exe
Get-Item dist\manage_app.exe | Select-Object FullName,Length,LastWriteTime
Get-FileHash dist\manage_app.exe -Algorithm SHA256
```

ビルド成功ログだけで完了にしない。必要な配布依頼ではEXEを起動し、トップ画面、DB配置、主要APIをスモーク確認する。

## 現在存在しない検証

- リポジトリに自動E2EテストやPlaywright設定はない。
- 数値付き性能合格基準とベンチマークスクリプトはない。
- CIはPyInstallerビルドと `npm run build` を実行しない。

存在しない検証を実施済みとしない。必要なら手動条件と結果を明記する。

## 禁止事項

- 失敗テストを削除・skip・緩和して合格にしない。
- ビルド前提を満たすためだけに依存やlockfileを更新しない。
- unrelatedな作業ツリー差分をformat:writeで一括変更しない。
- 実行していないコマンド、起動していないEXE、見ていない画面を合格と報告しない。

## 完了報告

- コマンド、作業ディレクトリ、終了結果、主要件数を列挙する。
- format出力、browser確認、EXEのパス・サイズ・ハッシュを必要に応じて示す。
- 未実施項目と理由、既存差分起因の可能性を明記する。
