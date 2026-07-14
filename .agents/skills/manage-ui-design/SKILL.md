---
name: manage-ui-design
description: Manage Web UIの実装・修正を行うSkill。レイアウト、視覚調整、レスポンシブ、アクセシビリティ、Gantt・Member Load・Insights・一覧・モーダルのブラウザ表示を既存デザイン言語に合わせて変更し、スクリーンショットとVitestで検証する依頼で使用する。レビューのみには使用しない。
---

# Manage UI Design

## 目的

既存の画面構造、デザイントークン、操作契約を保ち、ユーザーが実際に見る画面を最小差分で改善する。

## 使用条件

- UI、UX、layout、visual polish、responsive、accessibilityの実装を依頼されている。
- Gantt、Member Load、Insights、Themes、Members、navigation、modalを修正する。
- screenshotや実画面上の問題をコードへ反映する。

## 使用しない条件

- UIレビューだけならコードを変更せず、`AGENTS.md` のレビュー経路に従う。
- API・データ契約が主目的の依頼には単独で使用しない。
- CSV内容だけの依頼には使用しない。

## 事前確認

1. 対象画面を実際に起動し、変更前のdesktop・狭幅スクリーンショットを取得する。
2. sibling viewを確認し、既存のcontrol配置、table、chip、empty stateを優先する。
3. 対象のHTML、JS、CSS、Vitestを読む。
4. `frontend/css/index.css` のfont、space、radius、color、shadow、focus tokenを再利用する。
5. 既存ID、`data-*`、class hook、aria、test selector、keyboard動作を契約として列挙する。

## 主な入口

| 画面 | 実装 | Style | Test |
|---|---|---|---|
| Gantt | `frontend/js/gantt/gantt-renderer.js` | `frontend/css/gantt.css` | `frontend/tests/gantt-renderer.test.js` と関連editor/DnD |
| Member Load | `frontend/js/member/member-view.js` | `frontend/css/member-view.css` | `frontend/tests/member-view.test.js` |
| Insights | `frontend/js/insights-view.js` | 主に `frontend/css/index.css` | `frontend/tests/insights-view.test.js` |
| Shell / lists / modal | `frontend/index.html`, `frontend/js/app.js`, `frontend/js/ui.js` | `frontend/css/index.css` | 関連utility test |

## 手順

1. 要求を画面幅、状態、操作、期待する見た目に分解する。
2. DOMの所有者と再描画経路を特定する。local UI actionは、可能ならdata refetchではなくlocal rerenderにする。
3. 新しい色・spacing・radiusを直接増やす前に既存CSS変数を使う。
4. normal、hover、pressed、focus-visible、disabled、loading、errorを実装する。
5. 長い日本語、empty、0、`-`、P0、完了・停止、過負荷、ネスト行を崩さない。
6. GanttとMember Loadのparity要求はsummaryとnested rowの両方で確認する。
7. interaction/rendering変更へfocused Vitestを追加・更新する。
8. `manage-build-and-test` でfocused test、full frontend test、lint、format出力、buildを確認する。
9. 同一データ・同一幅で変更後スクリーンショットを取得し、desktopと狭幅、必要なら390px、light/darkを比較する。

## Manage固有の品質基準

- expand/collapse、filter、selection、saved viewで不要なloading flashやheader移動を起こさない。
- 関連controlを隣接させ、頻出actionを不要にoverflow menuへ隠さない。
- 完了行はlabel、数値、chip、warning、rate colorまで全体を中立化する。
- 月highlightは一つだけとし、同じ月の再clickで解除できる。
- Insightsは意思決定に必要な高信号情報へ集中させる。
- focusを失う再描画、入力中shortcut干渉、モーダルのEscape/Tab回帰を避ける。

## 検証

```powershell
Push-Location frontend
npm test -- --run gantt-renderer
npm test -- --run member-view
npm test -- --run insights-view
npm run lint
npm run format:check
npm run build
Pop-Location
```

変更した画面のfocused testだけを選び、広い変更では `npm test` も実行する。browserではconsole error、desktop、狭幅、keyboard、light/dark、long/empty/error stateを可能な範囲で確認する。

## 禁止事項

- 見た目だけの依頼でbackend、API、配賦データを変更しない。
- existing ID、`data-*`、aria、test selectorを理由なく変更しない。
- UI問題を固定文字、固定高さ、magic numberだけで隠さない。
- loading shellを残したまま中身だけ隠さない。
- 実画面を確認せず完了としない。確認不能なら未実施と報告する。

## 完了報告

- 変更した画面、状態、幅、ファイルを示す。
- 実行したVitest、lint、format出力、build、browser確認を示す。
- 未確認の状態、accessibility、high DPI、mobile、light/darkを明記する。
