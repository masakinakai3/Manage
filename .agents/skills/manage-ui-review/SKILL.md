---
name: manage-ui-review
description: Manage Web UIの実画面をスクリーンショットと操作で監査し、コードを変更せずにUI/UX、レスポンシブ、高DPI、light/dark、アクセシビリティ、一貫性、Gantt・Member Load・Insightsの回帰を報告するSkill。UIレビュー、デザイン監査、見た目の評価だけの依頼で使用する。
---

# Manage UI Review

## 目的

レンダリング済み画面を根拠に、再現可能なUI/UX findingを提示する。レビューのみなのでコードを変更しない。

## 使用条件

- UIレビュー、UX監査、画面品質評価、スクリーンショット比較を依頼されている。
- 実装ではなく問題の発見と優先順位付けが目的である。

## 使用しない条件

- 修正まで求められている場合は、監査後に `manage-ui-design` へ進む。
- ロジック・API中心のコードレビューには使用しない。
- スクリーンショットだけを見て実装する依頼ではない。

## 事前確認

1. `git status --short` で対象画面に未コミット差分があるか確認する。
2. `frontend/index.html`、対象JS/CSS、関連Vitestを読み、画面状態と操作を把握する。
3. `manage-build-and-test` の別ターミナル手順でbackendとViteを起動する。
4. in-app browserまたはPlaywrightを使い、console errorとnetwork errorを確認できる状態にする。

## 手順

1. ログイン、Gantt、Member Load、Insights、Themes、Membersのうち依頼対象を実画面で開く。
2. desktop、狭幅、必要なら390px相当でスクリーンショットを取得する。
3. dark/light、通常・hover・pressed・focus・disabled・errorを確認する。
4. 長い日本語、空状態、0、`-`、P0、完了・停止、過負荷、展開済みネスト行を確認する。
5. キーボード移動、Tab順、focus可視性、Escape、Undo/Redo、入力中shortcut干渉を確認する。
6. 配色、コントラスト、文字サイズ、余白、整列、sticky要素、重なり、横スクロール、layout shiftを確認する。
7. GanttとMember Loadはトップ行だけでなくテーマ・メンバーのネスト行を比較する。
8. findingごとにスクリーンショット、画面幅、操作、期待状態、実際の状態を記録する。

## 重点基準

- ローカルの展開、filter、selection、saved-view切替で不要なloadingやlayout shiftがない。
- 関連controlが同じ行・近い位置にあり、状態変化で移動しない。
- 完了行はlabel、数値、chip、warning、rate colorまで一貫して中立化される。
- 月highlightは1列だけで、同じ月の再clickで解除できる。
- Insightsは意思決定に必要な高信号情報へ集中し、Ganttへ密なsummaryを戻さない。
- 日本語labelが省略されても意味とaccessible nameを失わない。

## 検証

- findingは実画面で再現し、該当するコード位置を補助根拠として示す。
- desktopと狭幅を最低限確認する。未確認の高DPI、mobile、light/dark、empty/errorは明記する。
- 監査中にファイルが変わっていないことを `git status` で確認する。

## 禁止事項

- レビューのみの依頼でHTML、CSS、JavaScript、testを変更しない。
- コードの見た目だけで「画面上も問題ない」と判断しない。
- browserで確認していない状態を確認済みとしない。
- スクリーンショット条件を途中で変えて改善・悪化を演出しない。

## 完了報告

- findingを重大度順に、画面、幅、状態、再現手順、影響、コード位置つきで示す。
- 取得した証拠と確認範囲を示す。
- 問題がない場合も、確認した画面・幅・状態と未確認範囲を示す。
