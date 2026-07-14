# 開発ワークフロー

## 1. 目的

Manageの変更を小さく保ち、要求、実装、テスト、文書、配布物を同じ契約にそろえる。AIエージェントは最初に `AGENTS.md` と該当する `.agents/skills/` を読む。

## 2. 作業モード

| モード | リポジトリ変更 | 完了条件 |
|---|---|---|
| 調査のみ | しない | 原因、証拠、影響、修正候補を分離して報告 |
| レビューのみ | しない | findingを重大度順に、ファイル・行・影響つきで報告 |
| 実装 | する | 受け入れ条件、最小差分、関連test、文書、自己レビュー |
| リリース | する場合がある | release build、成果物実在、スモーク確認、未実施項目の明記 |

一律に計画承認待ちで停止しない。依頼範囲を広げる依存追加、破壊的操作、公開契約・データ互換性の重大な選択が必要な場合だけ確認する。

## 3. 標準手順

1. `git status --short` と `git diff --stat` で既存差分を確認する。
2. 要求を観測可能な受け入れ条件と「変更しない動作」へ変換する。
3. `Requirement.md`、`SoftwareDesign.md`、対象コード、呼び出し元、既存testを照合する。
4. 類似実装と共通utilityを検索し、最小ファイル集合を決める。
5. API・model変更では既存SQLite、Import/Export、frontend client、文書まで影響を確認する。
6. 実装し、最も狭い関連testを先に実行する。
7. 変更範囲に応じてfull test、lint、format出力確認、frontend build、browser、EXEへ広げる。
8. `git diff --check` と差分を読み、無関係な整形、生成物、debug code、secretがないことを確認する。
9. 実施済み検証と未実施検証を分けて報告する。

## 4. 検証マトリクス

| 変更 | 最低限 | 追加確認 |
|---|---|---|
| Backend model/API | 対象pytest | full pytest、移行、API文書 |
| Frontend logic | 対象Vitest | full Vitest、lint、format、build |
| UI/UX | 対象Vitest、build | desktop/狭幅、keyboard、light/dark、console |
| CSV | 対象Vitestまたはpytest | BOM、escaping、Excel、画面状態、権限 |
| Packaging | dev build | 配布時はrelease onefileと起動確認 |
| 文書のみ | path、link、command照合 | `git diff --check` |

正確なコマンドは `.agents/skills/manage-build-and-test/SKILL.md` を参照する。

注意:

- `tools/run_checks.ps1` はPythonをPATHから取得し、frontend buildを含まない。
- `npm run format:check` は修正候補があっても終了コード0である。`Formatting changes suggested:` を合格扱いしない。
- 自動E2Eと数値付き性能benchmarkは現時点で存在しない。

## 5. UI変更

- 実装前に対象画面とsibling viewを確認する。
- local expand/filter/selectionで不要なdata refetchとlayout shiftを起こさない。
- desktopと狭幅、長い日本語、empty/error、keyboard、light/darkを確認する。
- 変更前後は同じデータ・幅・themeで比較する。
- UIレビューのみならコードを変更しない。

詳細は `manage-ui-design` と `manage-ui-review` を参照する。

## 6. 性能変更

`Requirement.md` の標準規模はメンバー50名以下・テーマ200件以下だが、合格時間は未定義である。性能改善を主張する場合、固定データ・環境でwarm-up後5回以上測定し、中央値、範囲、正確性回帰、必要ならメモリを変更前後で示す。baselineがなければ改善を断定しない。

## 7. 文書更新

`docs/DocumentationOperations.md` を使う。

- API・payload・権限: `docs/APIContract.md`, `docs/software-design/04-data-and-api.md`
- 構造・状態・配布: `SoftwareDesign.md`, `docs/software-design/`
- ユーザー操作: `UserManual.md`
- test契約・手順: `UnitTestSpecification.md`, `tests/README.md`
- scope・受け入れ条件: `Requirement.md`, `docs/AcceptanceCriteria.md`

文書だけの変更では、記載command、path、linkを実体と照合し、無関係なコードtestを実施済みとしない。

## 8. Pull Request / 完了報告

- 解決するユーザー問題と主要な判断
- 変更ファイルと変更理由
- 実行したcommandと結果
- skipした検証と理由
- migration、data、API、security、performance、packagingのrisk
- UI変更時の画面、幅、状態、screenshot

生成物、local DB、secret、`.codex/audit/`、`output/` を変更に含めない。
