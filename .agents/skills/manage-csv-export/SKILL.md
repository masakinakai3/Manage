---
name: manage-csv-export
description: ManageのGantt CSV、Member Load CSV、/api/export/csv、列・行・filename、Excel on Windows互換、BOM・CRLF・escaping、権限、API文書、回帰テストを変更またはレビューするSkill。画面表示とCSV内容の不一致やCSV品質の依頼で使用する。
---

# Manage CSV Export

## 目的

CSVをライブ画面の表示状態と一致させ、日本語とExcel互換、escaping、権限、API契約を保つ。

## 使用条件

- GanttまたはMember LoadのCSV内容、列、順序、filenameを変更する。
- `/api/export/csv` のrequest、response、BOM、Content-Type、権限を変更する。
- comma、quote、改行、前後空白、日本語、Excel文字化けを修正・レビューする。

## 使用しない条件

- XLSXだけ、JSON backupだけ、画像exportだけの変更には使用しない。
- CSVと無関係なUI layout変更には使用しない。
- レビューのみならリポジトリを変更せず、findingを重大度順に報告する。

## 事前確認

1. export経路を特定する。
   - Gantt: `buildGanttGridCsvContent()` がbrowserでCSVとUTF-8 BOMを作り直接downloadする。
   - Member Load: `exportCSV()` がCSV本文を作り、`POST /api/export/csv` がBOMを付けてdownload responseを返す。
2. 画面のvisible period、scale、filter/search、row order、expanded/nested row、labelを確認する。
3. `backend/routes/export.py`、`docs/APIContract.md`、`docs/software-design/04-data-and-api.md`、関連testを読む。
4. `/api/export/csv` は現行でadmin-onlyであることを確認する。

## 現行契約

- CSVはraw全件ではなく、ユーザーが見ている期間、scale、filter、順序、labelを反映する。
- `P0`、`-`、rankなし、停止・完了、memo、milestone、theme/member metadataを意味のある値として保持する。
- comma、quote、CR/LF、前後空白を含むcellはquoteし、quoteは `""` へescapeする。
- grid-shaped exportでは空cellも列位置として保持する。
- backend responseはUTF-8 BOM付き、`text/csv; charset=utf-8` である。
- backend filenameはpath文字を除去し、安全なdownload名にする。

## 手順

1. 表示datasetの生成とCSV serializationを分けてたどる。
2. 列と行ごとにsource field、UI label、empty/zero semantics、順序を表にする。
3. 既存のshared escaping pathを再利用する。新規にstring joinを増やさない。
4. GanttとMember Loadの経路が異なる場合、変更を両方へ無条件に広げず、所有経路を明記する。
5. Vitestへheader、visible range、filter/order、escaping、empty cell、filenameの回帰を追加する。
6. endpoint変更時はpytestへBOM、Content-Type、Content-Disposition、filename sanitize、empty content、authを追加する。
7. request/response、列、権限、filenameが変わる場合はAPI・data design文書を更新する。
8. focused testの後、frontend buildまたは関連pytestを実行する。

## 検証

```powershell
Push-Location frontend
npm test -- --run gantt-renderer
npm test -- --run member-view
npm run build
Pop-Location

.\.venv\Scripts\python.exe -m pytest tests\test_api.py -q
```

実ファイルまたはresponse bytesで次を確認する。

- 先頭BOM、CR/LFを含む値、comma、quote、前後空白、日本語
- Excelでの列崩れと文字化け
- visible period/scale/filter/orderと画面の一致
- 一般ユーザーとadminの権限差
- 空datasetと長いfilename

## 禁止事項

- 画面と異なるraw datasetを便利さだけでexportしない。
- `P0`、0、`-`、no-rankをfalsy処理で空へ変えない。
- BOM、Content-Type、admin-only契約を依頼なしに変更しない。
- escapingを列ごとのad hoc置換で実装しない。
- endpointとbrowser downloadのどちらを検証したか曖昧にしない。

## 完了報告

- 対象経路、列・filename・権限変更、画面との一致を示す。
- 実行したVitest、pytest、build、Excel/bytes確認を示す。
- 未確認のExcel version、権限、edge caseを明記する。
