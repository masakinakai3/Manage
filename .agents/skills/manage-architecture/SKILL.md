---
name: manage-architecture
description: Manageリポジトリの構造、Flask・SQLite・Vanilla JavaScript間のデータフロー、変更先、依存方向、API・DB・EXE互換性の影響範囲を調べるSkill。機能追加や修正の前に配置先を判断する依頼、アーキテクチャ説明、設計監査で使用する。
---

# Manage Architecture

## 目的

実装と設定を根拠に、変更を置く場所と波及範囲を判断する。単独ではコードを変更しない。実装まで求められた場合は続けて `manage-code-change` を使用する。

## 使用条件

- リポジトリ構造、データフロー、責務、拡張ポイントを説明する。
- モデル、API、画面、Import/Export、EXEのどこを変更すべきか判断する。
- 新機能や互換性変更の影響範囲を実装前に確認する。

## 使用しない条件

- 原因調査が主目的の依頼には使用しない。
- UIの見た目だけを監査する依頼には使用しない。
- 変更先が確定済みで実装だけを行う場合は `manage-code-change` を使用する。

## 事前確認

1. `git status --short` で作業ツリーを確認する。
2. `SoftwareDesign.md` と該当する `docs/software-design/*.md` を読む。
3. 文書だけで結論を出さず、`backend/app.py`、`backend/models.py`、対象ルート、`frontend/js/app.js`、`frontend/js/api.js`、対象画面を照合する。
4. `rg` でシンボルの定義、呼び出し元、テスト、文書を検索する。

## システム全体図

```text
frontend/index.html
  -> frontend/js/app.js
     -> frontend/js/shared-state.js -> localStorage + CustomEvent
     -> frontend/js/api.js -> /api/*
     -> gantt / member / insights modules
backend/app.py
  -> backend/routes/*.py
     -> backend/models.py
     -> backend/services/allocation_service.py
        -> SQLite
build_exe.py -> frontend/dist + manage_app.spec -> PyInstaller output
```

## 主要モジュールと依存方向

| 層 | 主な場所 | 責務 |
|---|---|---|
| 起動・配布 | `backend/app.py`, `build_exe.py`, `manage_app.spec` | Flask生成、DB初期化、SPA配信、パッケージング |
| 永続化 | `backend/models.py` | User、Theme、Member、Allocation、Snapshot、SavedView |
| API | `backend/routes/` | 認証、CRUD、配賦、分析、Import/Export |
| 集計 | `backend/services/allocation_service.py` | テーマ負荷、メンバー負荷、警告 |
| APIクライアント | `frontend/js/api.js` | `/api/*` 呼び出しの集約 |
| アプリ結線 | `frontend/js/app.js` | 認証、画面切替、テーマ・メンバー・保存ビュー |
| 共有表示状態 | `frontend/js/shared-state.js` | 期間、スケール、検索、グループの同期 |
| 画面 | `frontend/js/gantt/`, `frontend/js/member/`, `frontend/js/insights-view.js` | 表示、操作、画面固有状態 |
| 共通UI | `frontend/js/ui.js`, `frontend/css/index.css` | ダイアログ、通知、busy/save状態、デザイントークン |

依存は、画面から `api.js`、APIルートからモデル・サービスへ向ける。モデルからルートを参照させない。画面ごとに独自のHTTPラッパーを増やさず、API契約は `frontend/js/api.js` に集約する。

## 重要なデータフロー

1. 配賦編集: 画面 -> `frontend/js/api.js` -> `backend/routes/allocations.py` -> `Allocation` -> SQLite -> 再取得・再描画。
2. 負荷表示: 期間条件 -> allocation API -> `allocation_service.py` -> Gantt / Member Load / Insights。
3. 共有条件: `shared-state.js` -> `localStorage` -> `manage:view-state-updated` -> 各画面の購読処理。
4. 保存ビュー: ローカル状態と `/api/saved-views` の両方を `app.js` が結線する。片方だけの変更にしない。
5. EXE: `build_exe.py` が `frontend/dist` を作り、`manage_app.spec` がbackendと同梱する。開発DBは `backend/database.db`、frozen時はEXE隣接の `database.db`。

## 変更時の影響範囲

| 変更 | 必ず確認する場所 |
|---|---|
| モデル列・関係 | model、起動時移行、route、API client、UI、Import/Export、pytest、設計文書 |
| API payload・権限 | route、`authz.py`、`api.js`、全呼び出し元、API文書、pytest |
| 共有表示条件 | `shared-state.js`、保存ビュー、Gantt、Member Load、Insights、Vitest |
| 配賦の意味 | allocations route/service、3画面、Undo/Redo、CSV/XLSX/JSON、pytest/Vitest |
| UI DOM | `index.html`、対象JS/CSS、ID・`data-*`・テストセレクタ、レスポンシブ表示 |
| パッケージ | `build_exe.py`、`manage_app.spec`、`backend/app.py` のfrozen分岐、README |

## 互換性境界

- `(theme_id, member_id, month)` は配賦の一意キーである。
- `allocation_rate: 0` は明示値、`null` は削除である。
- `theme_milestones` が実体で、Theme上の単一マイルストーン列は旧互換である。
- 既存SQLiteは起動時移行で継続利用する。DB削除を移行手段にしない。
- `/api/export/*`、`/api/import/json`、ユーザー管理は管理者専用である。
- onefileの `dist/manage_app.exe` は優先配布契約である。

## 手順

1. 依頼を入出力、永続化、表示、権限、配布の観点に分解する。
2. 入口から保存先または表示先まで定義と呼び出しを双方向にたどる。
3. 類似機能を検索し、新規実装を置く最小の既存責務を選ぶ。
4. 影響表でAPI、DB、Import/Export、共有状態、パッケージへの波及を確認する。
5. 文書と実装の差異を「確認済み事実」として分離して報告する。

## 検証

- 記載するファイルとシンボルが実在することを `Test-Path` と `rg` で確認する。
- 依存方向をimport、Blueprint登録、API呼び出しから確認する。
- 実行時の主張は `backend/app.py` と `build_exe.py` の分岐で確認する。

## 禁止事項

- READMEや設計書だけを根拠に実装を断定しない。
- 存在しない層、フレームワーク、コマンド、E2E、ベンチマークを仮定しない。
- アーキテクチャ説明だけの依頼でファイルを変更しない。
- 無関係な共通化や新規フレームワーク導入を提案の前提にしない。

## 完了報告

- 確認した入口、データフロー、変更候補、波及先を示す。
- 確認済み事実、推測、未確認事項を分ける。
- 実装へ進む場合は後続Skillと必要な検証を示す。
