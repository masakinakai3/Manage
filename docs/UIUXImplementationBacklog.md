# UI/UX実装バックログ

このバックログは、2026-04-18時点の `Resource Manager` フロントエンドを対象に、すぐ着手できる改善から順に実装できるよう整理したものです。

## 実装優先度

| ID | タスク | 優先 | 目的 | 変更対象ファイル | 完了条件 | テスト観点 |
| --- | --- | --- | --- | --- | --- | --- |
| UX-01 | ガントヘッダの再整理 | P1 | 期間操作、絞り込み、保存/比較の役割を見分けやすくする | `frontend/index.html`, `frontend/css/index.css` | ガント操作エリアが意味単位でセクション分けされ、各エリアにラベルが表示される | デスクトップ幅と狭幅で崩れないこと |
| UX-02 | フィルタ条件の可視化 | P2 | 現在何で絞り込まれているかを即座に把握できるようにする | `frontend/index.html`, `frontend/css/index.css`, `frontend/js/gantt/gantt-renderer.js` | 適用中の条件がチップで表示され、個別解除と全解除ができる | テーマ、カテゴリ、担当者、ステータス、優先度の各条件が正しく表示/解除されること |
| UX-03 | 保存状態の主画面表示 | P3 | 編集直後の保存状態や処理中を視線移動なしで確認できるようにする | `frontend/index.html`, `frontend/css/index.css`, `frontend/js/ui.js` | メインヘッダ内に保存状態と処理中表示が出る | 保存中、保存済み、エラー、処理中の見た目と文言が同期すること |
| UX-04 | 用語統一 | P4 | 日英混在と概念の曖昧さを減らし、初見理解を上げる | `frontend/index.html`, `frontend/js/app.js`, `frontend/js/gantt/gantt-renderer.js` | Saved view, Snapshot, Exportなどの主要導線が日本語で統一される | 表示文言とトースト文言に不整合がないこと |
| UX-05 | ショートカット導線の強化 | P5 | 既存のショートカット機能を見つけやすくする | `frontend/index.html`, `frontend/css/index.css`, `frontend/js/app.js` | ガントヘッダからショートカット一覧を開ける | ボタン押下と `?` の両方で同じヘルプが開くこと |
| UX-06 | 詳細パネルの再設計 | P6 | どのセルを編集中かをより明確にし、連続編集しやすくする | `frontend/index.html`, `frontend/css/index.css`, `frontend/js/gantt/gantt-renderer.js` | 対象サマリと次アクションが強調される | 選択セル変更時に表示内容が即時同期すること |
| UX-07 | スナップショット差分ジャンプ | P7 | 差分要約から該当箇所へ素早く移動できるようにする | `frontend/js/gantt/gantt-renderer.js`, `frontend/css/index.css` | 差分サマリから対象テーマ/月へ移動できる | 差分のない状態では導線が出ないこと |
| UX-08 | 状況連動オンボーディング | P8 | 初期状態での次アクションを迷わせない | `frontend/js/app.js`, `frontend/index.html` | 空状態に応じて案内内容が変わる | テーマ0件、メンバー0件、割当0件で案内が変わること |
| UX-09 | アクセシビリティ強化 | P9 | モーダル、通知、ナビゲーションの操作性を高める | `frontend/index.html`, `frontend/js/ui.js`, `frontend/js/app.js` | フォーカス管理とキーボード操作が改善される | Escで閉じる、フォーカス復帰、現在位置表示が機能すること |
| UX-10 | 狭幅時の一覧優先モード | P10 | 小さな画面での情報密度を最適化する | `frontend/index.html`, `frontend/css/index.css`, `frontend/js/gantt/gantt-renderer.js` | 狭幅時に一覧→詳細の流れで閲覧できる | 720px以下で操作導線が維持されること |

## 今回実装する範囲

- UX-01 ガントヘッダの再整理
- UX-02 フィルタ条件の可視化
- UX-03 保存状態の主画面表示
- UX-04 用語統一
- UX-05 ショートカット導線の強化

## 実装メモ

- 既存の状態管理は `shared-state.js` を維持しつつ、見た目の再構成を優先する
- 保存状態はサイドバーとメインヘッダの両方で同期表示し、作業視線に近いメインヘッダを主導線にする
- フィルタチップはガントの既存 `updateViewState` フローに乗せ、解除時も同じ経路で更新する
