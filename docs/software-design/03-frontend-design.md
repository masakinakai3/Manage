# Frontend Design

## 1. 概要

フロントエンドは `frontend/index.html` を入口にした単一ページアプリです。  
状態管理は軽量で、複雑なフレームワークは使わず、画面ごとの責務分割で保守しています。

## 2. 構成

| ファイル | 役割 |
|---|---|
| `frontend/index.html` | 画面骨格と DOM アンカー |
| `frontend/js/app.js` | 初期化ハブ、画面切替、各画面の結線 |
| `frontend/js/api.js` | API クライアント |
| `frontend/js/shared-state.js` | 共有表示条件 |
| `frontend/js/ui.js` | toast / dialog / busy state |
| `frontend/js/sidebar.js` | サイドバーの開閉、狭幅ドロワー、focus / Escape 制御 |
| `frontend/js/messages.js` | 共通状態・エラー・操作文言の日本語カタログ |
| `frontend/js/gantt/*` | Gantt 関連機能 |
| `frontend/js/member/member-view.js` | メンバー負荷画面 |
| `frontend/js/insights-view.js` | Insights 画面 |

## 3. 初期化フロー

```mermaid
sequenceDiagram
    participant DOM as DOMContentLoaded
    participant App as app.js
    participant API as auth.me()
    participant Views as 各画面

    DOM->>App: 初期化開始
    App->>API: 現在ユーザー取得
    API-->>App: user
    App->>App: ナビゲーション・共通 UI 初期化
    App->>Views: initGantt / initMemberView / initInsightsView
```

## 4. 共有状態設計

### 4.1 `shared-state.js`

| 状態 | 内容 |
|---|---|
| `preset` | 表示期間プリセット |
| `startMonth` | 表示開始月 |
| `rangeMonths` | 実際に対象とする月数 |
| `bucketMonths` | 1/3/6/12 か月の集計単位 |
| `focusMonth` | Gantt / Member Load が共有する判断月 |
| `activeView` | API再取得とlazy refreshを判断する表示画面 |
| `scale`, `visibleCount` | v1互換エイリアス。v2値から導出 |
| `ganttSearch` | Gantt 検索条件 |
| `ganttCategory` | カテゴリフィルタ |
| `ganttOwner` | 担当者フィルタ |
| `ganttStatus` | ステータスフィルタ |
| `ganttPriority` | 優先度フィルタ |
| `memberSearch` | メンバー検索 |
| `groupBy` | Gantt のグループ単位 |
| `ganttDensity`, `memberDensity` | 画面別の表密度 |
| `memberSort`, `memberGroup`, `memberDecisionFilter` | Member Load の判断条件 |

### 4.2 方式

| 仕組み | 使い方 |
|---|---|
| `localStorage` | 永続化 |
| `CustomEvent` | `{ state, changedKeys, source }` による画面横断通知 |
| `subscribeViewState()` | 各画面で購読 |

検索、sort、group、展開、密度、フォーカス月は取得済みデータを再描画する。期間変更時だけ表示画面を再取得し、非表示画面は次回表示までdirtyとして扱う。

## 5. Gantt 画面

### 5.1 主責務

| 機能 | 説明 |
|---|---|
| 描画 | テーマ・メンバー・月のマトリクス表示 |
| 編集 | セル単位編集、複数セル貼り付け。通常幅はインライン、1024px以下は表下の詳細編集へ一本化 |
| 操作 | キーボード移動、DnD、読込中の一括要求を保持する折りたたみ、ズーム。コントロール画面は初期状態で閉じ、720px以下では画面幅変更時もテーマナビを同期 |
| 補助 | スナップショット、保存ビュー、CSV/XLSX 出力 |

### 5.2 関係ファイル

| ファイル | 役割 |
|---|---|
| `gantt-renderer.js` | 画面本体 |
| `gantt-editor.js` | セルエディタ |
| `gantt-dnd.js` | ドラッグ&ドロップ |
| `date-utils.js` | 月計算 |

### 5.3 代表的な処理

| 処理 | 関数例 |
|---|---|
| 初期化 | `initGantt()` |
| 再描画 | `refreshGantt()` |
| 制御群バインド | `bindControls()` |
| 編集保存 | `saveSelectedCellWithHistory()` |
| DnD 移動 | `performDragAndDropMove()` |
| CSV 出力 | `exportCsv()` |
| XLSX 用データ組み立て | `getGanttExportDataset()`, `getGanttGridExportDataset()` |

## 6. Member Load 画面

### 6.1 見方

`Member Load` は Gantt の逆軸ビューです。  
テーマ中心ではなく、メンバー中心で「月ごとにどれだけ埋まっているか」を表示します。

### 6.2 主な責務

| 機能 | 説明 |
|---|---|
| メンバー別集約 | 月ごとの総配員率表示 |
| テーマ内訳展開 | メンバー行を展開してテーマ別配員を確認 |
| 過負荷強調 | capacity 超過の視覚化 |
| 詳細ポップアップ | hoverプレビューに加え、セル内buttonからキーボード／タッチ対応の固定内訳を表示 |
| 観測窓 | 6/12/24か月プリセット、標準／コンパクト密度、次の過負荷への移動 |
| コントロール | 通常幅でも上部コントロール画面を開閉でき、820px以下では初期状態を閉じてサマリと表を先に提示 |
| CSV 出力 | メンバー軸の表形式出力 |

## 7. Insights 画面

### 7.1 役割

Insights 画面は「編集」ではなく「発見」に特化しています。

| 出力 | 説明 |
|---|---|
| Summary | 全体不足、余力、ボトルネック数 |
| Health Checks | データ品質・運用上の問題・将来リスク |
| Recommendations | 余力メンバーへの移管候補 |
| Dashboard | 月次推移、部署負荷、影響テーマ、Project Load Ribbon。月buttonと詳細tableで正確な値、容量、欠損を提示 |

### 7.2 ドリルダウン

Insights の各カードは Gantt / Member Load に検索条件つきで遷移できます。

## 8. 共通 UI

### 8.1 `ui.js`

| 機能 | 説明 |
|---|---|
| `showToast()` | 通知表示 |
| `showConfirmDialog()` | 確認ダイアログ |
| `showPromptDialog()` | 入力ダイアログ |
| `setSaveState()` | 保存状態ピル更新 |
| `setDataState()` | `loading/fresh/stale/offline/error`の取得・接続状態を保存状態とは別に表示 |
| `setBusyState()` | 処理中表示 |

`api.js`は各requestで`manage:api-state`を発行します。`ui.js`は同時requestを追跡し、最終取得時刻、取得失敗、オフラインをサイドバーへ反映します。画面内エラーとグローバルなデータ状態は同じrequest結果から更新し、保存済み表示とデータ最新性を混同しません。

共有状態、HTTPエラー、共通ダイアログ操作の文言は`messages.js`へ集約します。画面固有の業務用語は各viewに残し、別locale追加時にcatalogへ段階移行します。

`sidebar.js`は1024px以下でサイドバーをモーダルドロワーとして扱います。開閉状態と`aria-expanded`を同期し、背景click、Escape、ナビ選択で閉じます。開いている間はフォーカスをドロワー内に維持し、閉じるとトグルへ戻します。狭幅での開閉はデスクトップの折りたたみ設定を上書きしません。

デザイン値は`index.css`のrole tokenへ集約します。操作部品の境界は`--color-control-border`、表内の低強調罫線は`--color-grid-line`を使い分けます。画面CSSでの色リテラルと13px未満の文字は`tools/lint-frontend.mjs`が拒否し、主要操作は44px、コンパクト操作は36pxを下限とします。

## 9. HTML レイアウト

`frontend/index.html` は、以下の DOM セクションを事前に持っています。

| 領域 | 用途 |
|---|---|
| `#sidebar` | ナビゲーションと共通操作 |
| `#view-gantt` | Gantt 画面 |
| `#view-member-load` | Member Load 画面 |
| `#view-insights` | Insights 画面 |
| `#view-themes` | テーマ一覧 |
| `#view-members` | メンバー一覧 |
| `#modal-overlay` | 汎用モーダル |
| `#dialog-overlay` | confirm / prompt |
| `#cell-editor` | セル編集用浮動 UI |
