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
| `tests/test_models.py` | password hash、Member/Theme default、Allocation unique constraint |
| `tests/test_priority.py` | Theme priorityの明示値とdefault |
| `tests/test_api.py` | login、protected/admin-only API、user管理、Theme・milestone、Allocation、Insights、SavedView、Import |

重要なAPI回帰:

- 未認証のprotected APIは401、一般ユーザーのadmin-only APIは403。
- 管理者はuser CRUDを行え、自分自身は削除できない。
- Themeの `dev_rank` 空値、複数の `dev_complete_months`、milestone配列を保持する。
- JSON Importは `dev_rank` と完了状態つき `dev_complete_months` を保持する。
- bulk/single Allocationは0を実レコードとして保持し、`null` で削除する。
- Insightsはsummary、health checks、recommendations、dashboard、project ribbonを返す。
- Project Ribbonは同一Themeの複数Member配賦を合算する。
- scenario suggestionは開始固定とschedule維持の両経路を守る。
- SavedViewは作成、一覧、削除を保持する。

## 5. Frontendテスト責務

| ファイル | 保護する主な動作 |
|---|---|
| `frontend/tests/api.test.js` | GET no-storeとwrite requestのcache挙動 |
| `frontend/tests/date-utils.test.js` | 月範囲、加減算、scale見出し、配賦集約 |
| `frontend/tests/shortcut-utils.test.js` | Undo/Redo、入力中shortcut、memo field |
| `frontend/tests/theme-list-utils.test.js` | filter/sort、legacy status、category tone |
| `frontend/tests/gantt-editor.test.js` | edit、保存、0と空欄、keyboard、optimistic state |
| `frontend/tests/gantt-dnd.test.js` | 同一Theme内移動と異Theme拒否 |
| `frontend/tests/gantt-theme-reorder.test.js` | Theme行のdrop位置と自己drop拒否 |
| `frontend/tests/gantt-renderer.test.js` | history、selection、期間移動、export、milestone、filter、完了表示、nested row |
| `frontend/tests/member-view.test.js` | 集約、milestone、月highlight、summary filter、expand、edit/history |
| `frontend/tests/insights-view.test.js` | Project Ribbonのlabel・accessible detail |

重要なUI回帰:

- 未設定配賦と明示0を区別する。
- Gantt編集、copy/paste、Undo/Redo、端を越える月移動を維持する。
- 月highlightは単一で、再clickにより解除できる。
- 完了状態はsummaryとnested rowの表示全体へ反映する。
- CSV/XLSX datasetはvisible period、filter、label、row shapeを守る。
- Member Loadのexpand controlはaccessibleで、不要なclick detail panelを生成しない。

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

CIは `npm run build`、browser/E2E、PyInstallerを実行しない。ローカル完了条件をCI合格だけへ縮小しない。

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
