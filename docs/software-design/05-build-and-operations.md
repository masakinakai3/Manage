# Build and Operations

## 1. ビルドの考え方

このプロジェクトは frontend と backend を別々に持ちますが、配布時には単一の Windows アプリとして扱います。

## 2. `build_exe.py`

### 2.1 主な責務

| 項目 | 内容 |
|---|---|
| frontend 入力の指紋計算 | 無駄な再ビルド防止 |
| backend 入力の指紋計算 | PyInstaller 再実行判定 |
| `dev` / `release` 切替 | 用途別ビルド |
| stale artifact 掃除 | 旧 `_internal`, `_release_bundle`, `_runtime` の除去 |
| 状態保存 | `.build_exe_state.json` にビルド指紋を保存 |

### 2.2 プロファイル

| プロファイル | 出力 | 用途 |
|---|---|---|
| `dev` | `dist/manage_app/manage_app.exe` | 反復確認 |
| `release` | `dist/manage_app.exe` | 配布 |

## 3. `manage_app.spec`

| モード | 方式 |
|---|---|
| `dev` | `onedir` |
| `release` | `onefile` |

補足:

- `release` は frontend の `dist` を EXE に同梱する
- 不要ライブラリを `excluded_modules` で抑制している

## 4. 運用上の特徴

### 4.1 配置先

| 実行形態 | DB の置き場所 |
|---|---|
| 開発 | `backend/database.db` |
| EXE | EXE と同じフォルダの `database.db` |

### 4.2 認証

| 項目 | 内容 |
|---|---|
| 初期ユーザー | `admin` |
| 初期作成条件 | 管理者が 1 件もない場合 |
| 自動ログイン | loopback アクセスのみ |

## 5. テスト運用

### 5.1 コマンド

| 種別 | コマンド |
|---|---|
| backend test | `.\.venv\Scripts\python.exe -m pytest` |
| frontend test | `npm test` |
| lint | `npm run lint` |
| format check | `npm run format:check` |
| 一括確認 | `tools/run_checks.ps1` |

### 5.2 ドキュメント更新の原則

変更時は以下を同時に更新することが望まれます。

1. 実装  
2. テスト  
3. `README.md`  
4. 設計書 (`SoftwareDesign.md` と必要なら詳細編)  

## 6. 保守のコツ

| 変更内容 | 注意点 |
|---|---|
| モデル追加 | Import / Export / Insights / UI 表示に波及しやすい |
| 新画面追加 | `index.html` と `app.js` の結線を忘れやすい |
| EXE 化調整 | `build_exe.py` と `manage_app.spec` をセットで見る |
| 文字列変更 | UI と設計書の双方で意味が揃っているか確認する |
