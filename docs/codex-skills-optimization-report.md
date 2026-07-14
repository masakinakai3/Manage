# Codex Skills最適化レポート

## 変更前のSkills最適化計画

### 現状

- 追跡対象の主要指示は `AGENTS.md`、`.agents/skills/` の2 Skill、旧 `.agent/` の6ファイル、開発・設計・テスト文書で構成されている。
- アプリは Flask + SQLite のバックエンドと Vite + Vanilla JavaScript のフロントエンドを持ち、PyInstallerでWindows向けEXEを生成する。
- ルート指示は有用だが、UI・CSVの詳細と共通ルールが混在し、調査のみ・レビューのみ・実装・リリースの境界が不足している。

### 主な問題

- Critical: `.agent/rules/02_workflow.md` の一律承認待ちが、自律実行を求める依頼や上位指示と矛盾する。
- Critical: `UnitTestSpecification.md` の配賦0の説明が、現行実装の「0は明示値、`null`は削除」と逆になっている。
- Major: UIレビューとUI実装が同じSkillで、レビューのみの依頼でも変更可否を誤りやすい。
- Major: 一般変更、不具合調査、コードレビュー、ビルド・テスト選択、アーキテクチャ理解を担当するSkillがない。
- Major: `npm run format:check` は差分候補を表示しても終了コード0になるため、出力を読まずに合格と誤認できる。
- Major: `.codex/environments/environment.toml` の実行アクションはバックエンド起動でブロックされ、同じスクリプト内のVite起動へ到達しない。ファイルは自動生成指定で、生成元はリポジトリ内にない。
- Redundant: `.agent/` と `AGENTS.md`、README、開発手順書にビルド・テスト・起動手順が重複している。
- Stale: `SoftwareDesign.md` に実在しない `frontend/api.js` 参照が1件ある。
- Missing: 実行した検証と未実施検証を区別する完了報告、性能主張の測定条件、生成物を除外する差分確認が共通化されていない。

### 維持するファイル

- `README.md`
- `Requirement.md`
- `UserManual.md`
- `docs/APIContract.md`
- `docs/AcceptanceCriteria.md`
- `docs/DocumentationOperations.md`
- `docs/software-design/01-system-overview.md` から `05-build-and-operations.md`
- `.github/workflows/ci.yml`、ビルド・テスト・アプリケーションコード（調査のみで変更しない）

### 修正するファイル

- `AGENTS.md`
- `.agents/skills/manage-ui-design/SKILL.md`
- `.agents/skills/manage-csv-export/SKILL.md`
- `.agent/rules/*.md`
- `.agent/skills/*.md`
- `docs/DevelopmentWorkflow.md`
- `UnitTestSpecification.md`
- `tests/README.md`
- `SoftwareDesign.md`

### 新規作成するファイル

- `.agents/skills/manage-architecture/SKILL.md`
- `.agents/skills/manage-build-and-test/SKILL.md`
- `.agents/skills/manage-code-change/SKILL.md`
- `.agents/skills/manage-code-review/SKILL.md`
- `.agents/skills/manage-bug-investigation/SKILL.md`
- `.agents/skills/manage-ui-review/SKILL.md`
- 各Skillの `agents/openai.yaml`
- `docs/codex-skills-optimization-report.md`

### 統合するファイル

- `.agent/rules/*.md` と `.agent/skills/*.md` の重複手順を、正規の `AGENTS.md` と `.agents/skills/` への互換案内に置き換える。
- ビルド、テスト、起動、パッケージングの判断を `manage-build-and-test` に集約する。

### 廃止候補

- `.agent/` の6ファイルは互換案内として当面維持し、新規情報の追加先にはしない。利用側が `.agents/skills/` を直接読めることを確認後に削除可能とする。
- `.codex/environments/environment.toml` は直接編集せず、生成元が判明した時点で別プロセス起動へ再生成する候補とする。

### 新しいSkill構成

| Skill | 責務 |
|---|---|
| `manage-architecture` | モジュール、データフロー、変更先、互換性境界の理解 |
| `manage-code-change` | 機能追加、修正、リファクタリング、文書のみの変更 |
| `manage-bug-investigation` | 原因調査、再現、性能低下、テスト失敗の切り分け |
| `manage-code-review` | コードを変更しないレビュー |
| `manage-build-and-test` | セットアップ、テスト選択、ビルド、EXE、リリース確認 |
| `manage-ui-design` | UIの実装・修正 |
| `manage-ui-review` | 実画面を根拠にした変更なしのUI監査 |
| `manage-csv-export` | CSVの画面状態整合、Excel互換、API、文書、回帰 |

### 変更による効果

- 依頼種別ごとの発動条件と変更可否が明確になる。
- 実在するコマンドと現在のテスト層から検証を選べる。
- UI、CSV、SQLiteデータ、API、EXEの壊れやすい境界を変更前に把握できる。
- 実施済み検証と未実施検証、測定済み性能と推測を混同しにくくなる。

### リスク

- 実ブラウザE2Eと性能ベンチマークはリポジトリに自動化されていない。
- `.codex/environments/environment.toml` は自動生成物のため今回直接修正できない。
- 作業ツリーに本依頼外のUI変更と監査生成物があるため、検証失敗時は本変更起因か既存差分起因かを分離する必要がある。

> この計画は変更実施前に作成した。以降の章へ実装後の棚卸し、変更内容、検証結果、仮想タスク評価を追記する。

## 1. エグゼクティブサマリー

変更前は、追跡対象の正規SkillがUIとCSVの2件だけで、一般変更、原因調査、レビュー、検証選択、アーキテクチャの手順が不足していました。さらに旧 `.agent/` の一律承認待ち、配賦0の誤ったtest文書、終了コードだけでは判定できないformat check、起動不能な自動生成アクションが、誤作業・誤報告を招く状態でした。

正規Skillを `.agents/skills/` の8件へ再構成し、ルート `AGENTS.md` を短い入口とtask routerへ変更しました。旧 `.agent/` は削除せず、正規情報への互換入口にしました。実装から確認したAPI、SQLite、状態同期、UI、CSV、EXEの壊れやすい境界を各Skillへ配置し、test・開発文書の誤りも修正しました。

期待される効果は、依頼モードの誤認防止、変更先の早期特定、最小差分、test選択の高速化、実施済み検証の正確な報告、UI・CSV・既存DB・onefile EXEの回帰防止です。

残存リスクは、自動E2E・性能benchmark・package CIが存在しないこと、format checkが差分候補でも0終了すること、opt-inの自動login実装と文書要件が一致しないこと、自動生成のCodex起動アクションがbackendでblockすることです。

## 2. 調査対象

### 2.1 ディレクトリと実装

- 指示: `AGENTS.md`, `.agent/`, `.agents/`, `.github/`, `.codex/`, `.claude/`
- Backend: `backend/app.py`, `backend/models.py`, `backend/authz.py`, `backend/routes/`, `backend/services/`, `backend/migrations/`
- Frontend: `frontend/index.html`, `frontend/js/`, `frontend/css/`, `frontend/tests/`
- Test・tool: `tests/`, `tools/`
- Build・CI: `frontend/package.json`, `frontend/vite.config.js`, `backend/requirements.txt`, `build_exe.py`, `manage_app.spec`, `.github/workflows/ci.yml`
- 文書: rootの要件・設計・manual・test仕様、`docs/`, `tests/README.md`

サブモジュール、Docker、Makefile、TypeScript typecheck、coverage command、Playwright設定、benchmark、code generationは存在しません。`.cursor/`, `.cursorrules`, `CLAUDE.md`, `COPILOT.md`, `.github/copilot-instructions.md`, `.codex/skills/`, root `skills/` も存在しません。

`.claude/launch.json` はbackendとfrontendを別configurationで起動するローカル設定、`.claude/settings.local.json` はローカルpermissionであり、prompt・ruleではありません。両方とも未追跡のユーザー状態なので変更していません。`.codex/audit/` と `output/` は画面監査生成物であり、指示として扱っていません。

### 2.2 技術・実行構成

| 項目 | 実体 |
|---|---|
| 用途 | テーマ・メンバー・月次配賦・負荷・Insights・保存ビュー・入出力を扱うlocal resource manager |
| Backend | Python 3.10+、Flask、Flask-Login、Flask-SQLAlchemy、SQLite |
| Frontend | Vite、Vanilla JavaScript、HTML、CSS |
| Package manager | pip、npm。lockfileあり |
| Test | pytest、Vitest + jsdom |
| CI | Windows、Python 3.11、Node.js 20 |
| 配布 | PyInstaller。dev onedir、release onefile |
| 優先成果物 | `dist/manage_app.exe` |
| DB | 開発時 `backend/database.db`、frozen時はEXE隣接 `database.db` |
| 生成物 | `frontend/dist/`, `dist/`, `build/`, `.build_exe_state.json`, cache、local DB、secret、監査出力 |

### 2.3 既存指示の棚卸し

| ID | ファイル | 適用範囲 | 目的・主な内容 | 問題 | 対応方針 |
|---|---|---|---|---|---|
| I-01 | `AGENTS.md` | 全体 | stack、entry point、UI/CSV、検証 | rootにtask詳細が集中 | routerと最重要制約へ再構成 |
| I-02 | `.agents/skills/manage-ui-design/SKILL.md` | UI | UI実装とレビュー | 実装・レビュー境界、必須節が不足 | 実装専用へ更新しreviewを分離 |
| I-03 | `.agents/skills/manage-csv-export/SKILL.md` | CSV | CSV dataset、Excel、API | Gantt直downloadとMember endpoint経路の差が弱い | 現行二経路、権限、検証を明文化 |
| I-04 | `.agent/rules/01_core_stack.md` | 全体 | stack・規約 | rootと重複、抽象的なDRY | 正規指示への互換入口化 |
| I-05 | `.agent/rules/02_workflow.md` | 全体 | plan・承認・実装 | 一律承認待ちが上位依頼と矛盾 | mode境界と必要時だけの確認へ変更 |
| I-06 | `.agent/rules/03_verification.md` | 検証 | pytest・frontend・browser | commandと合格条件が曖昧 | build/test Skillへの互換入口化 |
| I-07 | `.agent/skills/build_application.md` | Package | frontend build・EXE | system Python、profile・cache説明不足 | build/test Skillへ統合 |
| I-08 | `.agent/skills/run_backend_tests.md` | Backend test | pytest | venvを明示しない | venv commandと正規Skillへ更新 |
| I-09 | `.agent/skills/start_dev_server.md` | 開発起動 | Flask・Vite | 正規手順と重複 | 別terminalの互換入口化 |
| I-10 | `README.md` | onboarding | setup、run、test、EXE | 基本内容は実体と整合 | 変更なし |
| I-11 | `Requirement.md` | Product requirement | 機能・非機能 | 自動login要件とdefault実装に差 | 要件変更はせず未解決へ記録 |
| I-12 | `SoftwareDesign.md` | 全体設計 | architecture、変更map | `frontend/api.js` がstale | 実pathへ修正 |
| I-13 | `docs/software-design/01-system-overview.md` | System | use case・runtime | 重大な不整合なし | 変更なし |
| I-14 | `docs/software-design/02-backend-design.md` | Backend | factory、model、route、service | 重大な不整合なし | 変更なし |
| I-15 | `docs/software-design/03-frontend-design.md` | Frontend | state、view、UI | 存在しない関数名1件 | 実関数名へ修正 |
| I-16 | `docs/software-design/04-data-and-api.md` | Data/API | model、API、Import/Export | 重大な不整合なし | 変更なし |
| I-17 | `docs/software-design/05-build-and-operations.md` | Build/test | profile、DB、command | frontend cwd・format判定・build不足 | command表と注意を更新 |
| I-18 | `docs/DevelopmentWorkflow.md` | 開発 | DoD、review、profile | task modeと検証選択が粗い | mode・matrix・性能・報告へ再構成 |
| I-19 | `docs/DocumentationOperations.md` | 文書 | 更新対象・owner | 有用、重大な不整合なし | 変更なし、code-changeから参照 |
| I-20 | `UnitTestSpecification.md` | Test | case一覧・CI | 0を削除とするstale記述、現行test不足 | 現行test層・契約中心に再構成 |
| I-21 | `tests/README.md` | Backend test | pytest | system Python、重要契約不足 | venv、0/null、権限を追加 |
| I-22 | `UserManual.md` | User | 操作・troubleshooting | localhost自動login記載とopt-in実装に差 | scope外として未解決へ記録 |
| I-23 | `docs/APIContract.md` | API | request/response | 重大な不整合なし | CSV Skillから参照、変更なし |
| I-24 | `docs/AcceptanceCriteria.md` | Acceptance | UI・data・process | 高水準で有用 | 変更なし |
| I-25 | `.github/pull_request_template.md` | Review | summary・verification | format、EXE、未実施確認が弱い | 現行matrixへ更新 |
| I-26 | `.github/workflows/ci.yml` | CI | pytest・Vitest・lint・format | build/packageなし、format scriptが0終了 | CIは変更せず未解決へ記録 |
| I-27 | `.codex/environments/environment.toml` | Codex action | backend・frontend起動 | backend commandでblock。自動生成指定 | 直接編集せず未解決へ記録 |

## 3. 問題一覧

| ID | 重大度 | 対象 | 問題 | 対応 |
|---|---|---|---|---|
| P-01 | Critical | `.agent/rules/02_workflow.md` | 全taskで承認待ちを強制し、自律実行依頼と矛盾 | mode別の変更可否と必要時だけの確認へ変更 |
| P-02 | Critical / Stale | `UnitTestSpecification.md` | 配賦率0を削除と記載。現行実装・testは0を保存し`null`で削除 | 重要契約とtest仕様を訂正 |
| P-03 | Major | `tools/format-frontend.mjs` を使う全指示 | 修正候補でも終了コード0でCI上も成功する | script/CIはscope外。出力文字列を合格条件として全指示へ追記 |
| P-04 | Major | `.codex/environments/environment.toml` | 同一shellでbackendをforeground起動し、Viteへ到達しない | 自動生成のため直接編集せず、別terminal手順を正規化 |
| P-05 | Major | UI Skill | reviewとimplementationの境界がない | `manage-ui-review` を新設、`manage-ui-design` を実装専用化 |
| P-06 | Major / Missing | `.agents/skills/` | architecture、change、bug、review、build/testがない | 6 Skillを新設 |
| P-07 | Major / Redundant | `.agent/`, root docs | 起動・build・testが重複しcommandが揺れる | `.agent/` を互換入口化し正規Skillへ統合 |
| P-08 | Major | `tools/run_checks.ps1` を使う指示 | PythonがPATH依存でfrontend buildを含まない | venv明示commandを優先し制約を文書化 |
| P-09 | Major / Missing | 性能手順 | 「実用的」以外の基準、benchmarkがなく改善主張を検証できない | 固定条件、warm-up、5回以上、中央値、正確性をbug Skillへ追加 |
| P-10 | Major / Missing | Test/CI | 自動browser E2E、visual regression、package testがない | 存在しないことを明記。今回test/CIは追加しない |
| P-11 | Major | Requirement / UserManual / implementation | localhost自動login記載に対し、実装は`AUTO_LOGIN` opt-in | product判断が必要な未解決事項として分離 |
| P-12 | Minor / Stale | 設計文書 | stale pathと関数名 | 実在path・symbolへ修正 |
| P-13 | Minor | PR template | 未実施test、format出力、EXE、migrationの確認不足 | verification・risk checklistを更新 |
| P-14 | Redundant | `.agent/` 6ファイル | 正規Skillと同じ詳細を保持しdriftしやすい | 削除せずcompatibility shim化、将来の廃止候補 |
| P-15 | Major / Missing | `.gitignore` と生成物 | `output/`, `.codex/audit/`, `backend/initial_admin_password.txt` がignoreされず、誤stageやcredential混入の余地がある | 今回はscope外のため変更せず、`AGENTS.md` で明示除外し未解決へ記録 |

## 4. 変更ファイル

| ファイル | 操作 | 目的・主な変更 |
|---|---|---|
| `AGENTS.md` | 更新 | 短いrepo入口、architecture、制約、command、task router |
| `.agent/rules/01_core_stack.md` | 統合 | 正規指示へのcompatibility入口 |
| `.agent/rules/02_workflow.md` | 統合 | 一律承認待ちを除去しmode境界へ変更 |
| `.agent/rules/03_verification.md` | 統合 | 正規検証Skillと重要注意への入口 |
| `.agent/skills/build_application.md` | 統合 | profile別EXE手順への入口 |
| `.agent/skills/run_backend_tests.md` | 統合 | venv明示pytestへの入口 |
| `.agent/skills/start_dev_server.md` | 統合 | 別terminal起動への入口 |
| `.agents/skills/manage-ui-design/SKILL.md` | 更新 | UI実装専用、token・state・browser検証 |
| `.agents/skills/manage-ui-design/agents/openai.yaml` | 新規 | Skill UI metadata |
| `.agents/skills/manage-csv-export/SKILL.md` | 更新 | 二つのCSV経路、Excel、auth、escaping、test |
| `.agents/skills/manage-csv-export/agents/openai.yaml` | 新規 | Skill UI metadata |
| `.agents/skills/manage-architecture/SKILL.md` | 新規 | module、data flow、dependency、compatibility |
| `.agents/skills/manage-architecture/agents/openai.yaml` | 新規 | Skill UI metadata |
| `.agents/skills/manage-build-and-test/SKILL.md` | 新規 | setup、test matrix、server、EXE、release |
| `.agents/skills/manage-build-and-test/agents/openai.yaml` | 新規 | Skill UI metadata |
| `.agents/skills/manage-code-change/SKILL.md` | 新規 | 最小変更、test、docs、self-review |
| `.agents/skills/manage-code-change/agents/openai.yaml` | 新規 | Skill UI metadata |
| `.agents/skills/manage-code-review/SKILL.md` | 新規 | 変更なしreview、severity、finding形式 |
| `.agents/skills/manage-code-review/agents/openai.yaml` | 新規 | Skill UI metadata |
| `.agents/skills/manage-bug-investigation/SKILL.md` | 新規 | 再現、仮説、証拠、性能測定 |
| `.agents/skills/manage-bug-investigation/agents/openai.yaml` | 新規 | Skill UI metadata |
| `.agents/skills/manage-ui-review/SKILL.md` | 新規 | 実画面根拠の変更なしUI監査 |
| `.agents/skills/manage-ui-review/agents/openai.yaml` | 新規 | Skill UI metadata |
| `.github/pull_request_template.md` | 更新 | 検証・互換性・未実施・package checklist |
| `docs/DevelopmentWorkflow.md` | 更新 | mode、標準手順、検証matrix、性能、報告 |
| `UnitTestSpecification.md` | 更新 | 現行test層、0/null、file責務、CI限界 |
| `tests/README.md` | 更新 | venv command、fixture、重要契約 |
| `SoftwareDesign.md` | 更新 | stale frontend API pathを修正 |
| `docs/software-design/03-frontend-design.md` | 更新 | stale関数名を修正 |
| `docs/software-design/05-build-and-operations.md` | 更新 | cwd、frontend build、format判定、PATH注意 |
| `docs/codex-skills-optimization-report.md` | 新規 | 計画、棚卸し、問題、変更、検証、保守方針 |

アプリケーションコード、testコード、依存、build script、PyInstaller spec、CIは変更していません。

## 5. 最適化後のSkill構成

```text
.agents/skills/
  manage-architecture/
    SKILL.md
    agents/openai.yaml
  manage-bug-investigation/
    SKILL.md
    agents/openai.yaml
  manage-code-review/
    SKILL.md
    agents/openai.yaml
  manage-code-change/
    SKILL.md
    agents/openai.yaml
  manage-ui-review/
    SKILL.md
    agents/openai.yaml
  manage-ui-design/
    SKILL.md
    agents/openai.yaml
  manage-csv-export/
    SKILL.md
    agents/openai.yaml
  manage-build-and-test/
    SKILL.md
    agents/openai.yaml
```

参照方向は、理解・調査・レビューから実装へ、実装・UIから検証へ向かう一方向です。正規Skillに必須の循環参照はありません。全Skillは147行以下で、詳細をrootへ複製していません。

## 6. 主な改善点

### 発動条件とtask分離

- review only、investigation only、implementation、releaseを分離しました。
- UI reviewとUI implementationを分離しました。
- CSVはGanttのbrowser直downloadとMember Loadのbackend endpoint経由を明確にしました。

### アーキテクチャ理解

- Flask factory、Blueprint、model/service、frontend API client、shared state、3画面、PyInstallerの依存方向を追加しました。
- Allocation 0/null、unique key、milestone旧互換、SQLite migration、admin-only API、onefileを変更境界にしました。

### ビルド・テスト

- 変更種別ごとのnarrow-first test matrixを追加しました。
- `run_checks.ps1` のPATH依存、CIにfrontend build/packageがないこと、formatの0終了を明示しました。
- dev onedirとrelease onefile、artifact metadata、hash、起動確認を分けました。

### UI

- 実画面、desktop/狭幅、light/dark、長い日本語、empty/error、keyboard、focusを合格条件にしました。
- local actionのlayout shift、nested row parity、completed row全体、単一月highlightをrepo固有基準にしました。

### 性能

- benchmarkが存在しないことを隠さず、標準規模、固定条件、warm-up、5回以上、中央値、範囲、正確性、必要なメモリ確認を定義しました。

### 安全性と完了報告

- existing diff、local DB、secret、生成物を保護しました。
- 実行していないtest、見ていない画面、起動していないEXEを合格としないよう明文化しました。
- 未実施項目、互換性、migration、performance、securityを報告項目にしました。

## 7. 検証結果

| コマンド / 確認 | 目的 | 結果 | 備考 |
|---|---|---|---|
| `quick_validate.py` x 8 | frontmatter・Skill名検証 | 合格 | `PYTHONUTF8=1` で日本語Skillを検証 |
| 必須節・行数・metadata・openai.yaml確認 | Skill構造 | 合格 | 全8 Skillが必須8節を持ち147行以下 |
| Skill参照graph確認 | 循環防止 | 合格 | 必須参照は一方向 |
| local Markdown link確認 | link整合 | 合格 | すべて解決 |
| `build_exe.py --help` | profile・option実在 | 合格 | `dev/release`, `--force`, `--clean` を確認 |
| `.\.venv\Scripts\python.exe -m pytest -q` | Backend全test | 合格 | 24 passed、7.62s |
| `npm test` | Frontend全test | 合格 | 10 files、93 tests passed |
| `npm run lint` | Frontend static check | 合格 | `Frontend lint checks passed.` |
| `npm run format:check` | Format output | 合格 | `Frontend formatting looks good.` を確認 |
| `npm run build` | Vite production bundle | 合格 | 28 modules transformed、829ms |
| `git diff --check` | whitespace・conflict marker | 合格 | 出力なし |
| `git submodule status` | submodule確認 | 合格 | submoduleなし |

依存は既に導入済みだったためsetup commandは再実行していません。アプリコードは変更していないためbrowserでの画面確認とEXE再buildは実施していません。これらを合格とは報告しません。

検証は既存の未コミットUI変更を含む現在の作業ツリー上で実行しました。本依頼ではそのUI差分と監査生成物を編集していません。

## 8. 未解決事項

1. `.codex/environments/environment.toml` は自動生成指定で、生成元がrepo内にありません。現行actionはbackend起動でblockしViteへ到達しません。生成元から別processまたは別actionへ直す必要があります。
2. `Requirement.md` と `UserManual.md` はlocalhost自動loginを期待しますが、`backend/app.py` のdefaultはoffで、`tools/run_debug_server.py` だけが有効化します。要件、manual、実装のどれを正とするかproduct判断が必要です。
3. `npm run format:check` は差分候補でも0終了します。今回は文書で誤認を防ぎましたが、CIで強制するにはscriptまたはCI変更が別taskとして必要です。
4. 自動E2E、visual regression、performance benchmark、coverage gate、PyInstaller CIがありません。
5. 性能要件には標準規模だけがあり、数値付き合格時間はありません。測定結果をrelease gateにするにはbaselineとthresholdが必要です。
6. `.agent/` はcompatibilityのため残しています。利用toolが `.agents/skills/` を直接参照できることを確認後、削除できます。
7. `output/`, `.codex/audit/`, `backend/initial_admin_password.txt` は現行 `.gitignore` に含まれません。監査証跡をversion管理する方針を確認した上で、credential fileは少なくとも別taskでignore追加が必要です。

## 9. 今後の保守方針

- model、API、frontend entry point、build profile、test file構成を変えるPRでは、同じPRで該当Skillをreviewする。
- `AGENTS.md` はrouterと最重要制約だけに保ち、task詳細は該当Skillへ置く。
- command変更は `frontend/package.json`、`build_exe.py --help`、CI、Skill、開発文書を同時に確認する。
- 四半期ごと、またはrelease前に全Skillへ `quick_validate.py`、local link check、代表commandを実行する。
- CIへ、Markdown local link、Skill frontmatter、存在path、`default_prompt` の `$skill-name` を検証するread-only jobを追加することを推奨する。
- architecture変更時は `manage-architecture`、test構成変更時は `manage-build-and-test` と `UnitTestSpecification.md`、UI基準変更時はUI 2 Skillを更新する。
- 旧 `.agent/` へ新規詳細を書かず、正規Skillへのcompatibility入口だけを維持する。

## 10. 仮想タスクによる評価

| 仮想依頼 | 発動するSkill | 評価 | 検証・禁止・完了条件 |
|---|---|---|---|
| 1. 小規模bug修正 | bug investigation -> code change -> build/test | 合格 | 再現、原因、回帰test、最小差分が明確 |
| 2. 新しいUI部品 | architecture必要時 -> code change -> UI design -> build/test | 合格 | token、state、focused Vitest、desktop/狭幅が明確 |
| 3. 既存UI review | UI review | 合格 | code変更禁止、screenshot根拠、未確認状態を報告 |
| 4. 性能低下調査 | bug investigation | 条件付き合格 | 測定protocolあり。数値thresholdとbenchmarkは未整備と明示 |
| 5. Test失敗修正 | bug investigation -> code change -> build/test | 合格 | root cause、狭い再現、full regressionを選択可能 |
| 6. 新機能追加 | architecture -> code change -> specialist -> build/test | 合格 | placement、API/DB/export/docs影響を取得可能 |
| 7. Code reviewのみ | code review | 合格 | repository変更禁止、severity、file/line、未確認範囲が明確 |
| 8. 文書のみ更新 | code changeのdocs-only経路 | 合格 | path/link/command照合、不要なcode testを要求しない |
| 9. Refactoring | code change | 合格 | 外部動作固定、単一用途抽象化禁止、無関係変更禁止 |
| 10. Release前確認 | build and test | 合格 | full test、build、release onefile、artifact、manual smokeを判定可能 |

性能taskはrepo側にbaselineと自動化がないため、Skillだけで絶対合格値は作らず、測定結果と未定義基準を分離する設計にしました。その他9 taskは、前提情報、変更可否、test選択、禁止事項、完了報告を正規Skillから取得できます。
