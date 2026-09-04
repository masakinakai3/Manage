<!--
  Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
  Released under the MIT license
  https://opensource.org/licenses/mit-license.php
-->
# テスト仕様書

## 1. 目的

現行リポジトリの自動test層、守る契約、実行方法、未自動化範囲を定義する。個々のcase名を網羅するのではなく、test fileの責務と重要な回帰条件を維持する。

## 2. テスト層

| 層 | Framework | 場所 | 目的 |
|---|---|---|---|
| Backend unit/API | pytest + Flask Test Client + in-memory SQLite | `tests/` | model制約、認証、権限、API、集計、Import |
| Frontend unit/DOM | Vitest + jsdom | `frontend/tests/` | utility、API client、render、interaction、keyboard、export dataset |
| Static checks | repository-local Node scripts | `tools/lint-frontend.mjs`, `tools/format-frontend.mjs` | tab・trailing whitespace・改行 |
| Bundle | Vite | `frontend/` | module解決とproduction bundle |

自動E2E、visual regression、coverage gate、performance benchmark、PyInstaller実行testは存在しない。

## 3. 実行方法

リポジトリルート:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_api.py -q
.\.venv\Scripts\python.exe -m pytest -q
```

`frontend/`:

```powershell
npm test -- --run gantt-renderer
npm test -- --run member-view
npm test
npm run lint
npm run format:check
npm run build
```

`npm run format:check` は差分候補を表示しても終了コード0になる。`Frontend formatting looks good.` を合格条件とする。

`tools/run_checks.ps1` はPythonをPATHから実行し、frontend buildを含まない。仮想環境を有効化した補助経路として扱う。

## 4. Backendテスト責務

| ファイル | 保護する主な動作 |
|---|---|
| `tests/conftest.py` | test app、in-memory DB、admin/user client、test isolation |
| `tests/test_models.py` | password hash、Member/Theme default、月別capacity fallback、Allocation unique constraint |
| `tests/test_priority.py` | Theme priorityの明示値とdefault |
| `tests/test_api.py` | login、protected/admin-only API、user管理、Theme・milestone、Allocation、Insights、SavedView、Import |

重要なAPI回帰:

- 未認証のprotected APIは401、一般ユーザーのadmin-only APIは403。
- 管理者はuser CRUDを行え、自分自身は削除できない。
- Themeの `plan_certainty`、`dev_rank` 空値、複数の `dev_complete_months`、milestone配列を保持する。
- JSON Importは `plan_certainty`、`dev_rank` と完了状態つき `dev_complete_months` を保持する。
- JSON Export / ImportはユーザーID・ユーザー名・権限・パスワードハッシュを往復し、平文パスワードを出力せず、管理者不在のバックアップをデータ置換前に拒否する。
- 月別キャパシティはAPIで設定・解除でき、警告、Insights、JSON Export / Importへ同じ値が反映される。
- ユーザーを含むJSON Importは実行中セッションをログアウトし、ユーザーを含まない旧形式では既存ユーザーとセッションを保持する。
- bulk/single Allocationは0を実レコードとして保持し、`null` で削除する。
- Insightsはsummary、health checks、recommendations、dashboard、project ribbonを返す。
- Project Ribbonは同一Themeの複数Member配賦を合算する。
- scenario suggestionは開始固定とschedule維持の両経路を守る。
- SavedViewは作成、一覧、削除を保持する。

## 5. Frontendテスト責務

| ファイル | 保護する主な動作 |
|---|---|
| `frontend/tests/api.test.js` | GET no-storeとwrite requestのcache挙動 |
| `frontend/tests/ui.test.js` | APIエラー日本語化、データ／保存状態の分離、toast表示とclose名、prompt値保持、入力中Escape |
| `frontend/tests/sidebar.test.js` | 狭幅ドロワーのARIA、Escape、背景click、focus trap、幅変更 |
| `frontend/tests/shared-state.test.js` | 四半期、上期（3～8月）/下期（9～翌2月）、6/12/24か月プリセット |
| `frontend/tests/date-utils.test.js` | 月範囲、加減算、scale見出し、配賦集約 |
| `frontend/tests/shortcut-utils.test.js` | Undo/Redo、入力中shortcut、memo field |
| `frontend/tests/theme-list-utils.test.js` | filter/sort、legacy status、category tone、1000行fixtureの処理budget |
| `frontend/tests/theme-colors.test.js` | 32色の一意性、選択判定用の色正規化、同色テーマの使用件数集計 |
| `frontend/tests/gantt-editor.test.js` | edit、保存、0と空欄、keyboard、optimistic state |
| `frontend/tests/gantt-dnd.test.js` | 同一Theme内移動と異Theme拒否 |
| `frontend/tests/gantt-theme-reorder.test.js` | Theme行のdrop位置と自己drop拒否 |
| `frontend/tests/gantt-renderer.test.js` | history、selection、期間移動、export、milestone、filter、開発ステータス横の計画確度、完了／中止表示、nested row、狭幅の単一編集面とtheme navigator |
| `frontend/tests/member-view.test.js` | 集約、milestone、月highlight、summary filter、expand、edit/history、内訳dialog、月別capacity編集 |
| `frontend/tests/insights-view.test.js` | Project Ribbonのlabel・月button・欠損と明示0の区別 |

重要なUI回帰:

- 未設定配賦と明示0を区別する。
- Gantt編集、copy/paste、Undo/Redo、端を越える月移動を維持し、データ読込前の一括折りたたみ要求を読込後の行へ反映する。
- 担当者フィルタでは関連プロジェクトを維持したまま、他の担当者行の表示／非表示を切り替え、プロジェクト合計は全担当者分を維持する。
- Ganttのテーマサマリ行は、開発ランク、優先度、開発ステータス、計画確度（仮 / 確）を常時表示し、行アクションとは別のメタ情報領域に保持する。
- 月highlightは単一で、再clickにより解除できる。
- 完了・中止状態はsummaryとnested rowの表示全体へ非アクティブ表示として反映する。
- 720px境界を越えるresizeでGanttのモバイルtheme navigatorを生成・破棄する。
- CSV/XLSX datasetはvisible period、filter、label、row shapeを守る。
- Member Loadのexpand controlとセル内訳buttonはaccessibleで、不要な上部click detail panelを生成しない。
- Member Loadの1M表示は月別capacityを編集でき、上書き値を負荷超過判定へ使う。
- GanttとMember Loadの一括展開／折りたたみアイコンはaccessible nameを持つ。
- Member Loadの上部コントロールは通常幅／狭幅とも`aria-expanded`と表示状態を同期する。
- データ取得状態と保存状態を分離し、500/offline時に`fresh`を表示せず、読込失敗で保存状態を上書きしない。
- テーマ色は現在の選択状態を維持し、同色テーマを大文字・小文字の差なく集計する。
- CSSの色リテラルと13px未満の文字はlintで拒否する。
- 60か月の観測窓と1000行の一覧fixtureを回帰対象にする。

## 6. 変更別の必須test

| 変更 | 必須 |
|---|---|
| Model/DB constraint | 関連model test、関連API test、full pytest |
| Auth/permission/API | `tests/test_api.py` の関連case、full pytest |
| Gantt | renderer + 関連editor/DnD、frontend build |
| Member Load | member-view、frontend build |
| Insights | insights-view、必要ならAPI insights test、frontend build |
| Shared state/API client | 対応unit testと利用画面test |
| CSV | 生成経路のVitest、endpoint変更時pytest、BOM/escaping実データ確認 |
| HTML/CSS | 関連DOM test、lint、format出力、build、実browser |

## 7. CI

`.github/workflows/ci.yml` はWindows上でPython 3.11とNode.js 20を使用し、次を実行する。

1. `pip install -r backend/requirements.txt pytest`
2. `npm ci`
3. `python -m pytest`
4. `npm test`
5. `npm run lint`
6. `npm run format:check`
7. `npm run build`

CIはfrontend buildまで実行する。browser/E2E、PyInstallerは実行しないため、ローカル完了条件をCI合格だけへ縮小しない。

## 8. Test追加方針

- bug修正は可能なら修正前に失敗する最小caseを作る。
- public behaviorをassertし、内部実装だけを固定しない。
- APIはsuccessだけでなくvalidation、auth、empty、zero/nullを含める。
- UIはsummaryだけでなくnested row、keyboard、focus、long/empty stateを含める。
- mockを増やしすぎてdata flowを消さない。browserでしか確認できない項目はmanual verificationとして報告する。

## 9. 完了報告

- 実行したcommand、件数、結果を示す。
- 未実施のbrowser、EXE、performance、環境差を示す。
- testを実行していない文書変更では、path・link・command照合だけを実施済みとして報告する。
