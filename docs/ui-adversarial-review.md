# UI敵対的レビュー報告書

- レビュー日: 2026-07-14
- 対象: `C:\Users\galax\Desktop\Manage` の現在のワーキングツリー（未コミットのUI変更を含む）
- 基準: Sonyブランドの市販業務・技術製品として違和感がない品質、WCAG 2.2 AA相当
- 結論: **現状のままSonyブランドでは出荷不可。UI全面刷新に近い体系的改善が必要。**

## 証拠の読み方

- **実画面**: 実際にViteとFlaskを起動し、ブラウザで表示・操作して確認した事実。
- **計測**: DOM寸法、コントラスト計算、CSS実装値、ファイル集計から得た数値。
- **コード**: 実装を読んで確認した事実。
- **推定**: 実機、支援技術、未用意のデータ量では未検証のため、実装から予測した懸念。

この区分を各指摘に付け、見た目を確認した事実と推測を混同しない。

## 1. エグゼクティブサマリー

### 総合評価

Manageは、一般的な業務用Webアプリとしては整理の努力が見える。ダーク／ライトテーマ、4px刻みのスペーシング、表のキーボード操作、空状態、トースト、モーダルのフォーカストラップなど、製品化を意識した土台もある。しかし、Sonyブランド製品として評価すると、完成度を支える規則がUI全体まで浸透していない。画面ごとの局所的な装飾、12px中心の過密な文字、カードと枠の多用、狭い画面での操作面積不足、通信障害と保存状態の矛盾が、個人制作または社内ツールの印象を残す。

- **Sony製品として出荷可能か**: 不可。
- **現在の品質ランク**: **C（試作・社内ツール水準）**。機能密度はBに近いが、ブランド品質、拡大表示、状態の信頼性、アクセシビリティがCへ引き下げている。
- **最も重大な問題**: 通信障害中でもサイドバーに「表示内容は最新です」と表示される状態矛盾、200%相当で主要操作を覆う固定詳細パネル、WCAG非テキストコントラストを満たさないフォーカス表現。
- **第一印象**: 暗色の業務ダッシュボードテンプレートを丁寧に調整した段階。精密機器の操作面に必要な静かな階層、意味の厳密さ、状態への信頼はまだない。
- **改善規模**: CSSの微修正では足りない。状態モデル、共通コンポーネント、タイポグラフィ、表・グラフ、レスポンシブ方針を横断する中～大規模改修が必要。
- **刷新範囲**: バックエンド契約やデータモデルを変える必要はないが、フロントエンドのデザインシステムと主要3画面（Gantt、Member Load、Insights）は再設計が必要。

### 監査の要約

**実画面**として、ログイン、Gantt、Member Load、Insights、テーマ、メンバー、ユーザー管理、テーマ作成ダイアログを確認した。ダーク／ライト、1280×720、390×844、1920×1080、Full HDの200%表示に近い960×540 CSS viewport、初期表示、通常データ、検索0件、API障害、長い日本語名、セルのキーボード操作を確認した。既定環境のDevice Pixel Ratioは1.25だった。

**未確認**は、実OSの150%・200%スケーリング、4K、スクリーンリーダー実機、高コントラストモード、英語ロケール、数千行規模のデータ、実EXE内WebViewでの表示である。英語UIの切替機能は見つからず、英語についてはログイン失敗時の未翻訳メッセージだけを実画面確認した。

## 2. 総合スコア

| 評価項目 | 点数 | 判定 | 主な理由 |
| --- | ---: | --- | --- |
| ブランド適合性 | 34 | C | 汎用ダッシュボード感、ブランド固有の精密な階層不足、画面間の仕上げ差 |
| デザイン品質 | 47 | C | カード・枠・ピルの多用、局所装飾、狭い画面での重なり |
| 配色 | 58 | B- | 本文コントラストは良いが、色リテラルが分散し、境界・フォーカスが弱い |
| タイポグラフィ | 43 | C | 12～14px偏重、標準フォント任せ、見出しと本文の階層が弱い |
| 視認性 | 51 | C | 通常時は読めるが、表・グラフ・高DPI相当で負担が大きい |
| 情報設計 | 49 | C | 説明と挙動の矛盾、主操作がツール群に埋もれる、状態説明が不十分 |
| 操作性 | 54 | C+ | 表操作は充実する一方、マウス専用操作、狭いターゲット、モーダル不整合がある |
| 一貫性 | 46 | C | 共通トークンはあるが画面別CSSの直値と例外が多い |
| アクセシビリティ | 36 | D+ | フォーカスコントラスト、コンテキストメニュー、SVG操作、ライブ通知に欠陥 |
| 実装品質 | 52 | C | Vanilla JSとして整理されているが、スタイル重複、固定値、視覚回帰テスト不足 |
| **総合** | **47** | **C** | **一般業務アプリとして使用可能でも、Sonyブランドの市販品質には未達** |

## 3. 出荷可否判定

### 判定: Sonyブランドでは出荷不可

理由は外観の好みではない。次の3点が製品品質の客観的な出荷障壁である。

1. **状態の真実性が崩れる**: InsightsがHTTP 500を表示している同じ画面で、サイドバーは「表示内容は最新です」と表示する。技術製品で現在性を誤認させる表示は信頼を損なう。
2. **拡大表示で主要操作が破綻する**: 960×540ではサイドバートグルとタイトルが重なり、Ganttの固定詳細パネルが画面の大半を覆う。390×844のMember Loadは最初の1画面にデータ表が出ない。
3. **キーボード利用者へ操作状態を十分に示せない**: 共通フォーカスリングは背景とのコントラストがダーク約1.12:1、ライト約1.16:1で、WCAG 2.2の非テキストコントラスト3:1を満たさない。マウス専用のメニューとSVGホットスポットも残る。

全面的なバックエンド再構築は不要だが、フロントエンドは「部分修正の積み上げ」ではなく、共通状態・共通コンポーネント・主要画面を一つのデザインシステムへ収束させる必要がある。

## 4. 最重要問題トップ10

### 1位: 通信障害と「最新」表示が同時に成立する

- **重大度**: Critical
- **対象画面／コンポーネント**: Insights、サイドバー保存・同期状態、エラーカード
- **問題**: **実画面**でバックエンド停止時、Insightsの要約とグラフ領域に生の`HTTP 500`が重複表示された一方、サイドバーは緑色で「表示内容は最新です」を維持した。シナリオ入力も操作可能なままだった。
- **根拠**: `frontend/js/insights-view.js:39-49,99-106`は取得失敗を局所カードへ描画するが、グローバル状態をエラーへ連動させない。`frontend/js/api.js:23-27`はHTTPコードをそのままErrorへ変換する。
- **ユーザーへの影響**: データが最新か、再試行すべきか、入力結果が保存・反映されたか判断できない。
- **ブランドへの影響**: 技術製品の最重要資産である「状態表示への信頼」を破壊する。
- **推奨修正**: 読込・最新・更新中・オフライン・失敗・古いデータの状態機械を共通化し、Insights失敗時は前回データの時刻、再試行、障害範囲を明示する。生HTTPコードは診断詳細へ退避する。
- **関連ファイル**: `frontend/js/insights-view.js`, `frontend/js/shared-state.js`, `frontend/js/api.js`, `frontend/index.html`
- **修正後の確認方法**: API 500、タイムアウト、401、部分API失敗で、画面内状態とグローバル状態が矛盾せず、再試行がキーボード操作できることをE2Eで検証する。

### 2位: 200%相当と小画面で主要作業面が覆われる

- **重大度**: Critical
- **対象画面／コンポーネント**: Gantt、Member Load、サイドバートグル、固定詳細パネル
- **問題**: **実画面**960×540でメニューボタンがページタイトルへ重なり、セル編集後の詳細パネルが最大72vhで作業表の大半を覆った。390×844ではGantt表の開始が約550px、Member Load表はファーストビュー外だった。
- **根拠**: `frontend/css/index.css:3049-3114`で1024px以下の詳細パネルを固定配置し、タイトル側の安全領域を確保しない。Member Loadは内部表が実測`scrollWidth 1388px / clientWidth 390px`だった。
- **ユーザーへの影響**: 拡大表示や小窓で文脈を失い、編集対象と結果を同時に見られない。横・縦スクロールが連鎖する。
- **ブランドへの影響**: 高DPI Windowsを想定する製品として未完成に見える。
- **推奨修正**: 960px以下では詳細をインライン・ドロワー・専用編集モードのいずれか一つへ統一し、ヘッダーに44px以上のメニュー安全領域を予約する。Member Loadは概要を折りたたみ可能にし、名前列＋直近月を優先表示する。
- **関連ファイル**: `frontend/css/index.css:3049-3175`, `frontend/css/member-view.css`, `frontend/js/gantt/gantt-renderer.js`
- **修正後の確認方法**: 390×844、768×720、960×540、1280×720、1920×1080、Windows 125/150/200%実機で、重なり・二重スクロール・フォーカス遮蔽がないことをスクリーンショット差分で確認する。

### 3位: 共通フォーカスリングがWCAG 2.2 AA相当を満たさない

- **重大度**: Critical
- **対象画面／コンポーネント**: ボタン、ナビゲーション、スケール切替、閉じるボタン、サイドバートグル
- **問題**: `outline: none`の代わりに半透明の紫色haloだけを使う。**計測**で背景とのコントラストはダーク約1.12:1、ライト約1.16:1で、必要な3:1に届かない。
- **根拠**: `frontend/css/index.css:43,66-69,104-107,419-425`。本文色は十分なため、問題はフォーカス表現そのものに限定できる。
- **ユーザーへの影響**: キーボード利用時に現在位置を見失う。長い表では誤編集の危険が高い。
- **ブランドへの影響**: 見た目の静けさを優先して操作可能性を犠牲にした未成熟な設計に見える。
- **推奨修正**: 2pxの不透明な内側／外側リングと2pxオフセットを基本にし、ダークとライトで3:1以上の専用`focus-ring`色を定義する。選択状態とは形状も変える。
- **関連ファイル**: `frontend/css/index.css`, `frontend/css/gantt.css`, `frontend/css/member-view.css`
- **修正後の確認方法**: すべての操作要素をTab移動し、隣接色3:1以上、遮蔽なし、選択との区別を自動コントラスト検査＋目視で確認する。

### 4位: デザインシステムが宣言と実態で分裂している

- **重大度**: Critical
- **対象画面／コンポーネント**: 全画面、3つのCSSファイル、グラフ、状態色
- **問題**: ルートにはトークンがあるが、画面別CSSには多数の直色・個別影・個別半径が残る。**計測**では3 CSSに色リテラル238件、字句上159種類（うち1件は`#add-theme-btn`の誤検出、実質158種類）が存在した。
- **根拠**: `frontend/css/index.css:11-122`に基盤トークンがある一方、`gantt.css`と`member-view.css`、ライトテーマ個別上書きに意味未定義の色が散在する。
- **ユーザーへの影響**: 同じ警告・選択・背景でも画面により見え方が変わり、学習が転用できない。
- **ブランドへの影響**: 「一つの製品」ではなく、局所的に整えた画面の集合に見える。
- **推奨修正**: 役割ベースのトークンへ集約し、グラフ系列、負荷段階、フォーカス、境界を別名前空間に分ける。直色の追加をlintで禁止する。
- **関連ファイル**: `frontend/css/index.css`, `frontend/css/gantt.css`, `frontend/css/member-view.css`, `frontend/js/insights-view.js`
- **修正後の確認方法**: 許可リスト外の色リテラル0件、ダーク／ライト両方の視覚回帰、状態意味の対応表レビューを完了する。

### 5位: 12px中心のタイポグラフィが精密さではなく窮屈さを作る

- **重大度**: Critical
- **対象画面／コンポーネント**: 表、補足、ボタン、グラフ軸、カード副情報
- **問題**: 基本14px、small 13px、extra-small 12pxで、画面の大部分が12～13pxに収束する。一部は`0.7rem`（約11.2px）。1920×1080でも文字が小さいままセルだけが伸び、情報階層が強くならない。
- **根拠**: `frontend/css/index.css:13-19,413-417`、グラフラベル`frontend/js/insights-view.js:354`。**実画面**で長時間読む補足、軸、表操作が同じ小ささに見えた。
- **ユーザーへの影響**: 高DPI、疲労、低視力で可読性が下がり、数値誤読を招く。
- **ブランドへの影響**: 高級感ではなく、情報を詰め込んだ古い業務ソフトに見える。
- **推奨修正**: 16px本文、14pxコンパクト表、12pxは短いcaption限定とする。見出し、数値、状態、注釈の役割をサイズ＋ウェイト＋余白で分離する。
- **関連ファイル**: `frontend/css/index.css`, `frontend/css/gantt.css`, `frontend/css/member-view.css`, `frontend/js/insights-view.js`
- **修正後の確認方法**: 100/125/150/200%で文字切れなし、表の1画面情報量を過度に失わず、5名以上の可読性テストで誤読率を測る。

### 6位: Member Loadの説明が実装された操作と矛盾する

- **重大度**: Major
- **対象画面／コンポーネント**: Member Loadガイド、月セル
- **問題**: ガイドは「セルを選ぶと内訳を固定表示できます」と説明するが、**実画面**では月セルクリックは列強調だけで固定内訳を表示しない。内訳はhover popupだけである。
- **根拠**: `frontend/index.html:357-366`の説明に対し、`frontend/js/member/member-view.js:491-501`はmouseenter/leaveだけでpopupを管理する。固定詳細パネルDOMは存在しない。
- **ユーザーへの影響**: 存在しない操作を探し続け、機能故障と誤認する。タッチ・キーボード利用者は内訳へ到達しにくい。
- **ブランドへの影響**: 文言と製品挙動の最終QAが行われていない印象を与える。
- **推奨修正**: 意図を決める。固定表示を復活させないなら「ポイントすると内訳を表示」に修正し、キーボード／タッチ向け詳細ボタンを別途用意する。
- **関連ファイル**: `frontend/index.html`, `frontend/js/member/member-view.js`, `frontend/tests/member-view.test.js`
- **修正後の確認方法**: マウス、Enter/Space、タッチで説明どおりの同一情報へ到達し、クリックで不要なパネルが復活しないことを確認する。

### 7位: マウス専用のコンテキストメニューとグラフホットスポット

- **重大度**: Major
- **対象画面／コンポーネント**: Ganttコンテキストメニュー、Insightsリボングラフ
- **問題**: コンテキストメニュー項目は`div`でrole/tabindexがない。SVGの透明`rect`はclick対象だがrole、tabindex、キーボードhandlerがない。
- **根拠**: `frontend/index.html:571-576`、`frontend/js/insights-view.js:301-345`。SVG自体の`role="img"`はあるが、内部の対話要素を操作可能にはしない。
- **ユーザーへの影響**: キーボード、スイッチ入力、音声操作では編集・詳細確認の経路が欠ける。
- **ブランドへの影響**: 成熟したデスクトップ製品と比較して入力手段の設計が浅い。
- **推奨修正**: メニューを`role="menu"`＋`button/menuitem`へ変更し、矢印キー、Home/End、Escape、フォーカス復帰を実装する。グラフ詳細は下部のアクセシブル表またはbuttonリストを正規経路にする。
- **関連ファイル**: `frontend/index.html`, `frontend/js/gantt/gantt-renderer.js`, `frontend/js/insights-view.js`
- **修正後の確認方法**: マウスなしで全項目実行、グラフ月／テーマ詳細到達、スクリーンリーダーで名前・状態・順序を確認する。

### 8位: 入力中のEscapeで共有モーダルを閉じられない

- **重大度**: Major
- **対象画面／コンポーネント**: テーマ／メンバー／ユーザーモーダル
- **問題**: **実画面**でテーマ名入力へフォーカス中にEscapeを押しても閉じなかった。グローバルhandlerが入力要素を先に除外するためである。
- **根拠**: `frontend/js/app.js:234-256`は`shouldIgnoreShortcut(event)`でreturnした後にEscape判定する。Tabフォーカストラップ自体は`frontend/js/app.js:1208-1254`に実装されている。
- **ユーザーへの影響**: 閉じる挙動がフォーカス位置で変わり、キーボード習慣を裏切る。
- **ブランドへの影響**: Windowsデスクトップ製品として基本的なダイアログ契約が未完成。
- **推奨修正**: モーダルのEscapeを入力ショートカット除外より先に処理する。入力候補やIME変換中は`isComposing`で例外化する。未保存時は確認を出す。
- **関連ファイル**: `frontend/js/app.js`, `frontend/tests/shortcut-utils.test.js`
- **修正後の確認方法**: すべての入力種類、IME変換、未保存、確認ダイアログでEscapeとフォーカス復帰をE2E検証する。

### 9位: 表の水平スクロール量が大きく、比較文脈を失う

- **重大度**: Major
- **対象画面／コンポーネント**: Gantt、Member Loadの月次表
- **問題**: **計測**1280pxのMember Loadで表は`scrollWidth 1532px / clientWidth 1052px`、390pxで`1388px / 390px`。固定名前列はあるが、期間・合計・異常状態を俯瞰できない。Ganttも狭幅で内部横スクロールが必須になる。
- **根拠**: 月列の固定幅と多数の操作を同じ画面へ常時表示する設計。`frontend/js/member/member-view.js:339-355`、`frontend/css/index.css:3112-3114`。
- **ユーザーへの影響**: メンバー名と遠い月を往復し、異常の横比較で見落としが生じる。
- **ブランドへの影響**: データを精密に扱う製品なのに、情報の優先順位をUIが決めていない。
- **推奨修正**: 表示期間プリセット、直近月優先、固定サマリー列、異常ジャンプ、密度切替、列仮想化を段階導入する。
- **関連ファイル**: `frontend/js/member/member-view.js`, `frontend/js/gantt/gantt-renderer.js`, `frontend/css/member-view.css`, `frontend/css/gantt.css`
- **修正後の確認方法**: 6/12/24/60か月、10/100/1000行で比較タスクの完了時間とスクロール回数を測る。

### 10位: エラー文言・通知・操作領域が製品品質に達していない

- **重大度**: Major
- **対象画面／コンポーネント**: ログイン、APIエラー、icon-only・smallボタン
- **問題**: **実画面**ログイン失敗が英語`Invalid credentials`のまま表示された。メッセージ要素には`role="alert"`/`aria-live`がない。パスワード表示切替は実測約42×27px、smallボタンはCSS上30px高で、頻繁な操作に必要な余裕がない。
- **根拠**: `backend/routes/auth.py:45`、`frontend/js/api.js:23-27`、`frontend/index.html:40`、`frontend/css/index.css:413-417`。
- **ユーザーへの影響**: 日本語利用者は原因と対処を理解しにくく、支援技術は失敗を通知できない。高DPIで押し間違えやすい。
- **ブランドへの影響**: ローカライズと細部QAが不十分なOEMアプリに見える。
- **推奨修正**: UI側のエラーコード辞書、対処文、alert live regionを導入する。主要操作44px、コンパクト操作36px、絶対下限24pxを用途別に規定する。
- **関連ファイル**: `backend/routes/auth.py`, `frontend/js/api.js`, `frontend/js/app.js`, `frontend/index.html`, `frontend/css/index.css`
- **修正後の確認方法**: 401/403/409/500/ネットワーク断を日本語表示し、NVDAで通知、200%でターゲット寸法と誤操作率を確認する。

## 5. 画面別レビュー

### 5.1 ログイン

- **目的**: 認証と製品への最初の入口。
- **第一印象**: 余白は静かだが、汎用カードと簡素な線画ロゴで製品固有の信頼感は弱い。
- **良い点**: 明示ラベル、`autocomplete`、パスワード表示切替、送信中の二重送信防止がある。
- **問題点**: 英語の認証エラー、live region欠如、27px高の表示切替、エラーの対処説明不足。ブランドマークは独自性より仮ロゴ感が強い。
- **Sony製品水準との差**: 初回接触で言語・障害・セキュリティの説明が一貫せず、仕上げ前の管理画面に見える。
- **修正方針**: 認証状態の日本語辞書、alert通知、44px操作、製品名／用途／バージョンを簡潔に整理する。
- **重要度**: Major。

### 5.2 Gantt

- **目的**: テーマ、メンバー、月次配賦、マイルストーンを同一時間軸で編集する主画面。
- **第一印象**: 機能量は豊富だが、オンボーディング、見出し、サマリー、期間操作、表示倍率、出力、表、詳細が一度に競合する。
- **良い点**: 未設定と0を分離し、固定列、キーボード移動、PNG/CSV出力、展開／折りたたみを備える。明示的な現在月表示も良い。
- **問題点**: 12px中心、紫の主ボタンが複数、狭幅でタイトル重なり、セル編集popoverと固定詳細が同時に現れ、文脈を覆う。右クリックメニューはマウス専用。
- **Sony製品水準との差**: 高機能だが操作優先順位が可視化されず、「全部を置いた」印象がある。
- **修正方針**: 表示・編集・出力を3群へ整理し、詳細は一つの方式へ統合する。コンパクト／標準密度と期間プリセットを用意する。
- **重要度**: Critical。

### 5.3 Member Load

- **目的**: メンバー別負荷を月次・テーマ内訳で比較し、過負荷を発見する。
- **第一印象**: 色分けと積層バーは理解しやすいが、カード、凡例、説明の後に巨大な表が続き、データへ到達するまでが長い。
- **良い点**: 過負荷に数値と文言があり、色だけに依存していない。メンバー行の展開、月列選択、空値表現がある。
- **問題点**: ガイドと実挙動の矛盾、hover依存の内訳、1280pxでも480pxの横スクロール、390pxで表がファーストビュー外、凡例4段階の色が細かい。
- **Sony製品水準との差**: 異常検知画面なのに、異常へ最短で移動する導線より説明とスクロールが先に来る。
- **修正方針**: 異常優先のサマリー、凡例折りたたみ、直近期間、アクセシブルな詳細開示、異常ジャンプを導入する。
- **重要度**: Critical。

### 5.4 Insights

- **目的**: 配賦状況の要約、負荷推移、シナリオ比較を行う。
- **第一印象**: 主要数値とグラフは見栄えがするが、エラー耐性とグラフの精密な読み取りが弱い。
- **良い点**: 要約カード、基準線、凡例、全画面表示、シナリオ入力、ダーク／ライト対応がある。SVG全体に名称がある。
- **問題点**: API失敗の生表示と状態矛盾、透明click hotspotのキーボード非対応、軸・内部ラベル12px、色数が多い、凡例がチャート下部で小画面では遠い。
- **Sony製品水準との差**: 図は華やかでも、データの確実な読み取り、欠損、再試行、代替表が未整備で技術製品として弱い。
- **修正方針**: グラフの目的・単位・欠損を明示し、選択月の詳細表とキーボード経路を正規機能にする。
- **重要度**: Critical。

### 5.5 テーマ一覧

- **目的**: テーマの検索、並べ替え、追加、編集、削除。
- **第一印象**: 2列カードは理解しやすいが、カード内の色帯、バッジ、直接操作、説明が多く、管理画面テンプレート感がある。
- **良い点**: 検索0件の空状態は原因と解除方法が分かる。編集／削除が隠れず、長いテーマ名でもカードが破綻しなかった。
- **問題点**: 多数カードで縦に長く、主情報とメタ情報の差が小さい。削除が各カードで常時露出し、視覚ノイズになる。
- **Sony製品水準との差**: 一覧の走査性能より各カードの装飾が優先されている。
- **修正方針**: 標準は密度の高い行一覧、カードは概要モードとして選択可能にする。破壊操作は選択後の明確なコンテキストへ置く。
- **重要度**: Major。

### 5.6 メンバー一覧

- **目的**: メンバー属性・上限・編集操作の管理。
- **第一印象**: テーマ一覧と似た構造だが、情報量に対してカード面積が大きく、一覧比較が遅い。
- **良い点**: 氏名、部署、上限のまとまりは分かる。画面間のカード文法は一定程度揃う。
- **問題点**: 部署・上限を多数人で比較しにくい。カードの余白と枠が情報より目立つ。
- **Sony製品水準との差**: 管理対象の走査・比較効率より汎用カードの見た目が支配的。
- **修正方針**: 行一覧＋詳細編集、列ソート、状態フィルタを基本とする。
- **重要度**: Major。

### 5.7 ユーザー管理

- **目的**: 管理者によるユーザー作成、権限、認証状態の管理。
- **第一印象**: SECURITYラベルと説明パネルで別製品のようなトーンになる。
- **良い点**: 管理者限定の重要領域として区別しようとする意図は明確。
- **問題点**: 日本語UIに英語の装飾語が混ざり、右ガイドは画面幅を消費する。権限変更の影響・確認・監査情報が視覚的に弱い。
- **Sony製品水準との差**: 安全性の演出はあるが、実務に必要な説明責任と操作結果の追跡が前面に出ない。
- **修正方針**: 装飾的ラベルを減らし、権限差分、最終ログイン、変更者、危険操作確認を構造化する。
- **重要度**: Major。

### 5.8 共有モーダル、通知、コンテキストメニュー

- **目的**: CRUD入力、確認、セル編集、成功／失敗通知。
- **第一印象**: 共通モーダルは整っているが、入力量が多いと長い内部スクロールになり、メニュー・通知はアクセシビリティが不足する。
- **良い点**: テーマ作成モーダルは390×844でも画面外へはみ出さず、bodyスクロールとfooter固定を維持した。初期フォーカスとTab trap実装がある。
- **問題点**: 390px時のbodyは実測`scrollHeight 1391px / clientHeight 661px`、入力中Escape不動作、メニューのrole欠如、失敗通知のlive region不足。
- **Sony製品水準との差**: 状態ごとに微妙に異なる基本操作契約が残り、デスクトップアプリらしい予測可能性がない。
- **修正方針**: モーダル契約、通知契約、メニュー契約を共通コンポーネントとしてテストする。
- **重要度**: Major。

## 6. 項目別レビュー

### 6.1 デザイン全体

画面全体は暗色サーフェス、角丸カード、ピル、薄い枠、紫アクセントという典型的なSaaS管理画面の文法で構成される。最低限の統一はあるが、Sony水準に必要な「情報の意味から導かれた形」より、既知のUIパターンを並べた印象が強い。特にGanttとMember Loadは、説明・操作・カード・表がすべて同程度に主張し、視線の入口が多すぎる。

安っぽく見える主因は原色や強いグラデーションではなく、次の積み重ねである。

- 小さい文字を大量に詰めて情報密度を作っている。
- ほぼ全領域をカード、枠、角丸、ピルで区切り、重要度の差を面で表せていない。
- 画面別の色・影・半径が増え、細部の規則性が見えない。
- 紫、青、水色、緑、黄、赤を状態・テーマ・グラフで同時使用し、意味の優先順位が弱い。
- 狭幅でコンテンツを再設計せず、縦積み＋内部横スクロールへ逃がしている。

### 6.2 配色

本文コントラストは強い。ダークの本文`#f2f4f7`対`#0b0d11`は17.65:1、secondaryは10.07:1、mutedも7.17:1。ライトの本文`#0f172a`対`#f5f7f9`は16.62:1、secondaryは白背景で7.58:1、mutedは6.31:1でAAを満たす。一方、境界線はダーク1.60～2.02:1、ライト1.35～1.73:1で、入力境界や区切りを色だけで識別させる箇所には弱い。フォーカスリングはCriticalで述べた通り不合格である。

主要色の監査:

| 現在色 | 使用箇所・意図 | 問題 | 推奨 | コントラスト懸念 |
| --- | --- | --- | --- | --- |
| `#0b0d11` | dark background | 黒に近く長時間では階層が黒つぶれしやすい | `#101216` | 本文は十分、隣接surface差を再設計 |
| `#15181e` / `#1c2028` | elevated/card | 近い暗色が多く意味差が曖昧 | `#181b20` / `#20242b` | 境界線依存を減らす |
| `#303640` / `#424b59` | border | 1.60～2.02:1で操作境界には不足 | subtle `#3a414d`、strong `#667180` | 操作部品は3:1以上 |
| `#4f46e5` | primary | 多画面で主操作・選択・装飾に兼用 | accent `#5b5ce2`、用途制限 | 白文字は6.29:1 |
| `rgba(79,70,229,.18/.10)` | focus/subtle | focusとして1.12/1.16:1 | 不透明`#8b8cff`/`#3f42c7`の2px線 | 現状は3:1未達 |
| `#22c55e` / `#117a37` | success | 保存済みと負荷状態で意味競合し得る | status-successを専用化 | 背景組合せごとに検証 |
| `#f59e0b` / `#d97706` | warning | グラフ・負荷色と競合 | `#c67a12`＋警告アイコン | 色以外の形を併用 |
| `#f87171` / `#b91c1c` | error | 危険、過負荷、削除にまたがる | errorとdanger-actionを分離 | subtle背景上を再計測 |
| `#38bdf8`, `#6366f1`等 | graph/theme | 系列数が増えると識別困難 | 6色上限＋線種／パターン | 色覚シミュレーション必須 |

### 6.3 フォント

`"Yu Gothic UI", "Meiryo UI", "Noto Sans JP", system-ui`で、Windows日本語UIとして無難だが、OSごとに字幅とウェイトが変わる。ブランドフォントを無理に追加する必要はないが、フォントを変える前に用途別ウェイトと数値組版を固定すべきである。表数値には`font-variant-numeric: tabular-nums`を共通適用し、コード・HTTP診断・IDだけは`ui-monospace, "Cascadia Mono", monospace`へ分ける。本文600以上の擬似太字を多用せず、400/600/700の3段階に制限する。文字間隔と用途別の字幅方針は明文化されていない。font smoothingをCSSで強制していない点はWindowsのClearTypeへ任せる意味で妥当だが、Yu Gothic UIとNoto Sans JPで改行が変わるため、両stackで長文・高DPI回帰を持つべきである。

### 6.4 文字サイズ

現在のscaleは12/13/14/16/20/24pxで、本文が14px、compact UIが12pxへ偏る。推奨は次の通り。

| 用途 | 推奨サイズ / 行高 / weight |
| --- | --- |
| Display | 32 / 40 / 600（限定使用） |
| Page title | 24 / 32 / 600 |
| Section title | 20 / 28 / 600 |
| Subsection / panel | 16 / 24 / 600 |
| Body | 16 / 24 / 400 |
| Compact body / table | 14 / 20 / 400 |
| Caption | 12 / 18 / 400（短文限定） |
| Numeric emphasis | 24 / 28 / 600、tabular nums |
| Button label | 14 / 20 / 600 |
| Graph axis / legend | 13～14 / 18 / 400 |
| Error / status | 14 / 20 / 600 |
| Log / code | 13 / 20 / 400、monospace |

### 6.5 余白と整列

4/8/12/16/20/24/32pxのscaleは成立しており、基盤として良い。ただしコンポーネントがそれを一貫して使わず、30pxのsmall button、36pxの通常control、44pxのモバイルmenu、24pxのselect、16pxのmilestone chipが混在する。視覚整列では、960px時のページタイトルと44pxメニューボタンの安全領域が欠ける。カード間隔を増やすより、カード自体を減らし、セクション境界を余白と見出しで作るべきである。

### 6.6 視認性

通常本文は良いが、境界・focus・グラフ内部・小さい補足が弱い。ダークテーマはサーフェス差が狭く、ライトテーマは白いカードと淡い罫線へ依存する。長時間利用では12pxと横スクロールによる眼球移動が疲労を生む。`prefers-contrast`、Windows High Contrast、強制色モードのCSSは見つからず、**推定**では一部の背景・box-shadow中心の状態が消える可能性がある。

### 6.7 ボタン

Primary/Secondary/Ghost/Danger/Icon-onlyはCSS上存在するが、実画面ではPrimaryの紫が「保存」「出力」「主要遷移」へ広がり、操作階層が薄い。30～36px高は密度の高いデスクトップ表では許容できる場合もあるが、ページ主要操作と200%環境には小さい。押下状態はhoverほど明確でなく、非同期読み込み中は一部のsubmit無効化以外にspinner/progressの統一契約がない。

### 6.8 入力フォーム

ラベルは概ね明示されるが、必須・任意、入力制約、単位、上限下限、保存タイミングの説明が画面ごとに異なる。Ganttセル編集はpopoverと詳細panelの二つが同時に開き、値確定経路が過剰である。シナリオ入力は操作可能だが、API障害時のdisabled／stale表示がない。産業用途を想定するなら、入力前値、変更後値、検証エラー、保存結果を同じ状態モデルで示す必要がある。

### 6.9 表

固定列とcurrent monthは有効だが、長期間で横スクロールに依存する。数値は中央寄せが多く、列比較には右揃えまたは小数点揃えが望ましい。空値`-`、明示0、過負荷は区別される点は良い。大量データの仮想化は見つからず、**推定**では1000行級でDOM量、sticky、hover popupの性能劣化が懸念される。10/100/1000行の性能基準を設けるべきである。

### 6.10 グラフ

Insightsのリボングラフには凡例、基準線、タイトル、全画面表示がある。しかし、目的・単位・選択状態・欠損データの説明が十分でなく、透明rectのclickに詳細閲覧を依存する。複数色の細い帯は小負荷で読めず、内部ラベル12pxも厳しい。色だけでなく、選択アウトライン、パターン、詳細表、キーボード月選択を追加する必要がある。

### 6.11 アイコン

主にインラインSVGで線幅`1.9`を使い、基本方針は良い。一方、`★`、`✓`、`⚠`、矢印、`×`などの文字記号がSVGと混在し、OSフォントによる形状差が残る。絵文字そのものの大量利用は確認していないが、状態記号は16/20pxの統一SVGまたはテキスト＋SVGへ寄せる。icon-onlyには常に可視tooltipとaccessible nameを付ける。

### 6.12 文言と情報設計

Member Loadの固定表示説明は明確な誤りである。ログインエラーとHTTPエラーは英語／生コードのまま。`SECURITY`など装飾的な英語も日本語中心の製品トーンを乱す。エラーは「何が起きたか」「現在のデータは使えるか」「何をすべきか」「詳細コード」の順で書き、診断コードを主文にしない。

### 6.13 状態表示

通常、hover、選択、過負荷、未設定、保存済みは複数表現を持つが、読込中、古いデータ、切断、権限なしの共通表現が不足する。特にグローバル「最新」と局所APIエラーの矛盾はCriticalである。保存状態とデータ取得状態を一つの表示へ混ぜず、「編集保存」「サーバー接続」「表示データ時刻」の3軸に分けるべきである。

### 6.14 ダイアログと通知

モーダルはaria-modal、タイトル、初期focus、Tab trapを備える。390pxでもviewport外へはみ出さない点は良い。ただしEscapeが入力中に機能しない。トースト／ログインメッセージのscreen reader通知、連続通知の集約、失敗の保持時間は不足する。ブラウザ標準alert/confirmの常用は実画面では確認しなかった。

### 6.15 レスポンシブ対応

1024pxと720pxのbreakpointがあり、document全体の横overflowは390pxで抑えられた。ただし「収まる」ことと「作業できる」ことは別で、主要表は内部横スクロール、概要は縦積み、詳細は固定overlayになる。1920pxではGanttが広く使える一方、文字と情報密度が大画面向けに再調整されず間延びする。実OS 4K/150/200%は未確認なので、CSS viewport結果だけで合格とはしない。

### 6.16 アクセシビリティ

良い点は、表セルの`role="button"`、`tabindex="0"`、aria-label、展開ボタンのaria-expanded、モーダルのaria-modal、SVG全体のaria-labelである。重大な欠陥は、focus ring、menu role、SVG hotspot、login alert、hover-only detail、small targetである。Tab順はモーダルのコード上trapを確認したが、NVDA/JAWS/VoiceOver実機は未確認。WCAG 2.2 AA適合を名乗れる状態ではない。

### 6.17 実装品質

Vanilla JSの画面モジュール分割とVitestは一定の品質を持つ。現在のテストは10ファイル93件が通過した。しかし、Playwright等の既存E2E、視覚回帰、axe系監査は見つからず、今回の重なり、誤文言、Escape、focus contrast、障害状態矛盾は93件を通過したまま残る。アプリ内のGantt PNG出力は`html-to-image`とテストを持つが、製品UI全体の回帰キャプチャとは別物である。

### 6.18 競合視点

- **大手メーカーの設定アプリとの差**: 接続・更新・保存・権限が一つの一貫した状態語彙で管理されず、障害時の信頼感で劣る。
- **高級オーディオ／映像ツールとの差**: 暗色であること自体を高級感に使い、タイポグラフィ、数値整列、操作の静けさまで設計し切れていない。
- **計測器／産業機器ツールとの差**: 単位、上限下限、欠損、古いデータ、異常値の厳密な表示と入力確認が不足する。
- **成熟したデスクトップアプリとの差**: Escape、menu keyboard、focus、High Contrast、高DPIなどOSに沿った基本契約が弱い。
- **高品質SaaSとの差**: デザインtoken、component state matrix、E2E/visual/a11y regressionが製品横断の仕組みになっていない。
- **ブランド感の差**: 競合はロゴではなく、状態の正確さ、細部の予測可能性、余計な装飾を削った階層で信頼を作る。Manageはまだ画面ごとの工夫が先行する。

### 6.19 役割別の敵対的レビュー

#### Sonyのブランド責任者

承認しない。通信障害と「最新」の矛盾はブランド毀損に直結する。汎用dark dashboard、過剰なカード、小さい文字、画面別の色は安価なOEM管理ソフトの印象を作る。ロゴ追加では解決しない。

#### シニアUIデザイナー

基盤tokenはあるが、238件の色リテラル、12px偏重、30/36/44pxの操作高さ、個別responsive overrideが体系を壊している。Gantt、Member、Insightsで情報階層の作り方も異なる。まずcomponent contractとsemantic tokenを固定する。

#### UXリサーチャー

初見ユーザーはGanttの多数の操作、Memberガイドの誤説明、セル編集の二重surfaceで迷う。熟練化しても横scrollと詳細表示の往復が残り、学習で解消できない負荷である。タスク別の最短経路を観察し、説明文ではなく構造で案内すべきである。

#### アクセシビリティ監査担当

WCAG 2.2 AA適合とは判定できない。focus 3:1未達、mouse-only menu/SVG、hover-only detail、login alert欠如、small target、forced-colors未対応がある。表セルのaria-labelとmodal trapは良い出発点だが、製品全体の操作経路は閉じていない。

#### 品質保証担当

960×540の重なり、390pxのfirst-view消失、API 500の状態矛盾、入力中Escape、英語errorを回帰ケースにする。さらに0/1/多数データ、60か月、1000行、長い日英文字列、125/150/200%、EXE WebViewを組合せる。現行unit testだけでは表示品質を保証できない。

#### 競合企業のデザイナー

製品紹介に使うなら、390px Member、960px Gantt detail、network error、UsersのSECURITYパネルは掲載を避けるだろう。その時点で製品全体の完成度が揃っていない。競合は正常時の一枚だけでなく、障害時と高DPIでも同じブランド品質を保つ点で優位に立てる。

#### 初めて使用する一般ユーザー

オンボーディング文はあるが、Ganttで最初に押すべき操作がprimary色の複数buttonに埋もれる。Memberの説明は実際の結果と違い、故障と感じる。エラーがHTTPコードだけでは自分が何をすべきか分からない。

#### 熟練ユーザー

セルのkeyboard移動、undo/redo、展開、出力は評価できる。一方、期間jump、異常jump、密度切替、全画面横断command、安定したshortcut helpが不足する。長期利用ではhover、scroll、panel開閉の繰り返しが速度を制限する。

## 7. 問題一覧

Blockerは0件。主要操作が全環境で完全に不能になる事象は確認しなかった。ただし、Critical 5件を解消するまで出荷可とはしない。

| ID | 重大度 | 画面 | コンポーネント | 問題 | ユーザー影響 | 修正案 | 関連ファイル |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-001 | Critical | Insights | 状態／エラー | HTTP 500中も「最新」と表示 | データの現在性を誤認 | 接続・取得・保存の状態機械を分離 | `insights-view.js`, `shared-state.js` |
| UI-002 | Critical | Gantt | responsive detail | 960×540で詳細が作業面を覆う | 編集文脈を喪失 | drawer/inlineの単一方式へ | `index.css`, `gantt-renderer.js` |
| UI-003 | Critical | 全画面 | focus ring | 1.12/1.16:1で3:1未達 | キーボード位置を見失う | 不透明2px ring＋offset | `index.css` |
| UI-004 | Critical | 全画面 | color system | 実質158種類の色リテラル表記 | 意味と見た目が画面ごとに変化 | role tokenへ集約、lint追加 | 3 CSS、`insights-view.js` |
| UI-005 | Critical | 全画面 | typography | 12～13px偏重、11.2pxも存在 | 疲労、数値誤読、高DPI不利 | 本文16px、compact14px基準 | 3 CSS、`insights-view.js` |
| UI-006 | Major | Member Load | guide | 固定内訳の説明と実装が不一致 | 存在しない操作を探索 | 文言修正＋非hover経路 | `index.html`, `member-view.js` |
| UI-007 | Major | Gantt | context menu | `div`項目でrole/tabindexなし | マウスなしで利用不能 | menu/menuitem契約を実装 | `index.html`, `gantt-renderer.js` |
| UI-008 | Major | Insights | SVG hotspot | click可能rectがキーボード非対応 | グラフ詳細へ到達不能 | 詳細表／button一覧を追加 | `insights-view.js` |
| UI-009 | Major | CRUD modal | Escape | 入力focus中に閉じない | 挙動がfocus位置で変わる | Escape判定順を修正 | `app.js` |
| UI-010 | Major | 全画面 | target size | 27～36pxの主要操作がある | 200%・運動障害で誤操作 | 主要44px、compact36px | `index.css` |
| UI-011 | Major | Login | error locale | `Invalid credentials`を生表示 | 原因・対処を理解しにくい | error code辞書と自然な日本語 | `auth.py`, `api.js`, `app.js` |
| UI-012 | Major | Login／通知 | live announcement | login messageにalert/liveなし | 支援技術が失敗を通知しない | `role=alert`と通知manager | `index.html`, `app.js` |
| UI-013 | Major | Member Load | table width | 1280pxでも480px横scroll | 月比較で文脈を失う | 期間・密度・異常jump | `member-view.js`, `member-view.css` |
| UI-014 | Major | Gantt | dual editor | popoverと固定詳細が同時表示 | 確定経路が曖昧 | 編集surfaceを一つに統合 | `gantt-renderer.js`, `index.css` |
| UI-015 | Major | Insights | graph semantics | 欠損・単位・代替表が弱い | 技術データを誤読 | 単位、欠損、詳細表を追加 | `insights-view.js` |
| UI-016 | Major | 全画面 | button hierarchy | Primaryが保存・出力等に拡散 | 主操作が識別しにくい | 1領域1 primaryを原則化 | `index.html`, 3 CSS |
| UI-017 | Major | Gantt | responsive header | 960pxでmenuとtitleが重なる | タイトル欠け、操作不安 | 44px安全領域を予約 | `index.css` |
| UI-018 | Major | Member Load | hover detail | 内訳がhover依存 | touch/keyboard利用者が不利 | 明示button/row detail | `member-view.js` |
| UI-019 | Major | 状態全般 | stale/loading | 古い・切断・部分失敗が未定義 | 復旧判断ができない | 共通状態patternを追加 | `shared-state.js`, 各view |
| UI-020 | Major | 全画面 | high contrast | forced-colors対応なし | 状態・境界が消える恐れ | `forced-colors`対応 | 3 CSS |
| UI-021 | Minor | Theme modal | long form | 390pxでbodyが1391px | 見通しが悪い | セクション化・段階入力 | `app.js`, `index.css` |
| UI-022 | Minor | 全画面 | icon | SVGと文字記号が混在 | OSで形状と位置が変わる | 統一SVGセット | `index.html`, 各JS |
| UI-023 | Minor | Theme/Member | cards | 枠・角丸・バッジが過多 | 走査が遅くテンプレート感 | 行一覧を基本にする | `index.css`, `app.js` |
| UI-024 | Minor | Users | wording | 日本語中に装飾英語`SECURITY` | 製品トーンが分裂 | 用語辞書で統一 | `index.html` |
| UI-025 | Minor | 全画面 | disabled state | opacity中心で理由が不明 | 操作不能の原因が不明 | 補足・tooltip・aria-describedby | 3 CSS、各JS |
| UI-026 | Minor | Graph/Table | numeric layout | 数値の整列規則が不統一 | 桁比較が遅い | tabular nums＋右揃え規則 | 3 CSS |
| UI-027 | Minor | 全画面 | localization | 文言をHTML/JSへ直書き | 英語・長文化に弱い | message catalog導入 | `index.html`, 各JS |
| UI-028 | Polish | 全画面 | elevation | 影とsurfaceの意味が曖昧 | 奥行きの一貫性が弱い | 3段階elevationへ | 3 CSS |
| UI-029 | Polish | Themes/Members | card actions | 削除が常時視覚競合 | 一覧が騒がしい | 選択時dangerへ | `app.js`, `index.css` |
| UI-030 | Polish | 全画面 | motion | motion/reduced-motion契約がない | 動きの質と配慮が不均一 | duration tokenとreduce対応 | 3 CSS |
| UI-031 | Polish | 全画面 | scrollbars | 内部scroll領域が多い | 視線・操作が分断 | 画面ごとの主scrollを一つに | 3 CSS |
| UI-032 | Major | Test | visual regression | E2E/visual/a11y回帰がない | 同種不具合が再発 | Playwright＋axe＋baseline | `frontend/tests`, CI |
| UI-033 | Major | Table | large data | 1000行・60か月未検証 | 性能・sticky崩れのリスク | fixtureと性能budget | tests、member/gantt |

## 8. 推奨デザインシステム

既存のCSS変数と4px基準を捨てず、意味のない直値を段階的に吸収する。

### 8.1 カラートークン

| Role | Dark | Light | 用途 |
| --- | --- | --- | --- |
| `background-primary` | `#101216` | `#F4F6F8` | アプリ全体 |
| `background-secondary` | `#15191F` | `#EBEFF3` | ナビ／補助領域 |
| `surface-primary` | `#1B2027` | `#FFFFFF` | 標準surface |
| `surface-elevated` | `#232A33` | `#FFFFFF` | modal/menuのみ |
| `text-primary` | `#F3F5F7` | `#111827` | 本文・主要値 |
| `text-secondary` | `#BEC5CE` | `#475569` | 補助本文 |
| `text-disabled` | `#7A8491` | `#7C8795` | 無効状態、説明併用 |
| `border-subtle` | `#37404C` | `#D3DAE3` | 非操作区切り |
| `border-strong` | `#687586` | `#667085` | 入力・選択境界 |
| `accent-primary` | `#6267DF` | `#5054C8` | 主要操作、1領域1つ |
| `accent-hover` | `#767BE8` | `#4246AF` | hover |
| `accent-pressed` | `#4B50BE` | `#343897` | pressed |
| `focus-ring` | `#A8ACFF` | `#3539A6` | 2px不透明focus |
| `status-success` | `#4CCB7A` | `#197A42` | 成功のみ |
| `status-warning` | `#E5A33C` | `#A95F05` | 警告のみ |
| `status-error` | `#FF7B82` | `#B4232C` | 失敗のみ |
| `status-info` | `#61B8E8` | `#176C9B` | 情報のみ |

負荷レベルとテーマ系列はstatus色から分離する。テーマ系列は6色を上限にし、7系列目以降は線種、ハッチ、明度、直接ラベルを併用する。提案値は最終採用前に全組合せを再計測する。

### 8.2 タイポグラフィ

- `font-ui`: 現行Windows日本語stackを維持し、400/600/700だけ許可。
- `font-numeric`: 同stack＋`font-variant-numeric: tabular-nums lining-nums`。
- `font-code`: `ui-monospace, "Cascadia Mono", "SFMono-Regular", Consolas, monospace`。
- サイズは6.4の表をtoken化し、11px台は禁止。caption 12pxは一行・非必須情報だけに限定。
- 日本語の本文行長は40～60文字を目安にし、説明文を全幅へ伸ばさない。

### 8.3 スペーシング

`space-1=4`, `2=8`, `3=12`, `4=16`, `6=24`, `8=32`, `12=48`, `16=64`。現行20pxは移行用aliasに留める。画面外周24～32px、狭幅16px、カード内16～24px、form row間16px、関連button間8px、非関連group間24pxを原則にする。

### 8.4 角丸・境界・影

- radius: input/button 6px、panel 8px、modal 12px。999pxはstatus chipだけ。
- border: 1px subtle、操作部品は1px strong、選択／focusは2px。
- shadow: level 0なし、level 1 menu、level 2 modalの3段階。カード常時shadowは禁止。
- elevationは「クリック可能」ではなく「重なっている層」にだけ使う。

### 8.5 ボタン種別

- **Primary**: 1 dialog/sectionにつき原則1つ。保存、作成、実行。
- **Secondary**: 同等ではない補助操作。出力、複製。
- **Tertiary/Ghost**: 表示切替、折りたたみ、戻る。
- **Danger**: 削除確定のみ。通常一覧では赤面を常時表示しない。
- **Icon-only**: 36px compact／44px standard。accessible nameとtooltip必須。
- loading、disabled reason、pressed、focusを全種に定義する。

### 8.6 入力欄・パネル

- inputは44px standard、36px compact table editor。label、help、error、unit、required/optionalを共通slot化。
- 数値入力は単位を入力欄外の固定位置に置き、min/max/stepを可視化する。
- panelは`section`（背景なし）、`surface`（静的情報）、`interactive-row`（選択可能）、`modal`、`drawer`だけに限定する。
- カードの入れ子と、カード内の追加ピルは原則禁止する。

### 8.7 状態色とフォーカス

状態は色＋アイコン＋短い文言を組み合わせる。保存状態、接続状態、データ時刻を分離する。focusは2px ring＋2px offsetを全操作へ適用し、選択は背景＋border＋check/markerで別表現にする。`forced-colors: active`ではsystem colorを使用する。

### 8.8 アイコンとアニメーション

- 16/20/24pxのstroke SVG、stroke 1.75～2.0、round cap/joinに統一。
- 文字記号、OS絵文字、独自SVGの混在をなくす。
- motionはfast 120ms、base 180ms、panel 240ms。opacity/transformだけを基本とし、`prefers-reduced-motion: reduce`で無効化する。
- 装飾のためのbounce、glow、連続animationは使用しない。

### 8.9 段階移行

1. 現行変数へ新role aliasを追加し、見た目を変えず参照先を集約する。
2. 共通button/input/focus/modalから直値を除去する。
3. Gantt、Member Load、Insightsの順に画面固有色をsemantic tokenへ置換する。
4. 許可外の色、font-size、radius、z-indexをlintで検出する。
5. dark/light/high-contrastのbaseline screenshotをCIへ追加する。

## 9. 改善ロードマップ

### Phase 0: 出荷を妨げる問題

- **目的**: 状態誤認、操作遮蔽、キーボード可視性を解消し、出荷判定の最低線を作る。
- **対象**: UI-001～UI-005、UI-009、UI-017。
- **主な修正**: 接続／取得／保存状態の分離、APIエラー画面、960px以下の詳細UI、ヘッダー安全領域、focus ring、最低文字サイズ、Escape。
- **依存関係**: 共通state enum、最低限のsemantic color token、主要viewportのE2E fixture。
- **完了条件**: API障害時に矛盾なし、390～1920pxと200%実機で操作遮蔽なし、全focus 3:1以上、本文・表の最小サイズ基準を満たす。
- **検証方法**: Playwrightで正常／500／offline、keyboard-only、390×844、960×540、1280×720、1920×1080を自動化。NVDA smoke testとコントラスト計測を行う。

### Phase 1: デザイン基盤の統一

- **目的**: 画面ごとの局所調整を止め、一つの製品として予測可能にする。
- **対象**: 色、font、spacing、radius、border、shadow、button、input、modal、toast、menu、icon。
- **主な修正**: 8章のtoken導入、共通class再編、直色と任意サイズの段階削除、button/input state matrix、文字記号のSVG化。
- **依存関係**: Phase 0の状態とfocus定義。既存ID、`data-*`、テストselectorを維持する移行設計。
- **完了条件**: 許可外色0、11px台0、共通button/input/modalが全画面で同一契約、dark/light視覚差分を承認。
- **検証方法**: stylelint相当のcustom check、component fixture page、dark/light/forced-colors screenshot、既存Vitest回帰。

### Phase 2: 主要画面の再設計

- **目的**: 最頻出作業の認知負荷とスクロール量を減らし、精密な比較を可能にする。
- **対象**: Gantt、Member Load、Insights。
- **主な修正**: Ganttの操作群再編と編集surface統合、Member Loadの異常優先・期間／密度切替、Insightsの詳細表・欠損・再試行・キーボードグラフ。
- **依存関係**: Phase 1の共通componentとtoken。API契約は原則維持する。
- **完了条件**: 主要タスクで迷いなく編集・比較・復旧でき、12か月表示の横移動とクリック数が現状より明確に減る。
- **検証方法**: 初見／熟練ユーザーのタスクテスト、6/12/24/60か月と10/100/1000行fixture、操作時間・誤操作・スクロール回数を記録する。

### Phase 3: アクセシビリティとレスポンシブ対応

- **目的**: WCAG 2.2 AA相当とWindows高DPIの実用性を担保する。
- **対象**: menu、SVG、hover detail、live region、target size、Tab順、zoom、high contrast、screen reader。
- **主な修正**: semantic menu、代替詳細表、keyboard/touch detail、alert/status、44/36px target、forced-colors、reduced-motion、focus遮蔽防止。
- **依存関係**: Phase 1/2で操作surfaceが安定していること。
- **完了条件**: keyboard-onlyで全主要タスク完了、axe重大違反0、200%で二次元scrollを必要最小化、NVDAで名前・役割・状態が理解できる。
- **検証方法**: axe＋手動WCAG checklist、NVDA、Windows 125/150/200%、High Contrast、touch emulation、IMEを含むE2E。

### Phase 4: 最終ポリッシュ

- **目的**: 市販製品としての静けさ、精密さ、画面間一貫性を仕上げる。
- **対象**: elevation、icon、microcopy、motion、empty/loading/error、scrollbar、数pxの整列。
- **主な修正**: card削減、見出し基線、数値整列、文言辞書、transition、tooltip、最終iconセット、全画面の比較レビュー。
- **依存関係**: 前Phaseの構造を固定し、polish中に情報設計を再変更しない。
- **完了条件**: 主要画面のdesign QA指摘0、全状態screenshot承認、用語表一致、競合水準のレビューでA判定以上。
- **検証方法**: pixel review、ダーク／ライト、空／通常／大量／error、全viewportのapproved baseline、5営業日以上のdogfooding記録。

## 10. 実装指示候補

### Task 1: Insightsの状態整合性を修正する

- **対象ファイル**: `frontend/js/insights-view.js`, `frontend/js/shared-state.js`, `frontend/js/api.js`, `frontend/index.html`, 関連tests
- **問題**: HTTP 500中も「最新」と表示し、生コードを重複表示する。
- **修正方針**: 保存、接続、データ取得を別stateとして扱う。
- **実装内容**: `loading/fresh/stale/offline/error`を定義し、前回取得時刻、再試行button、日本語メッセージ、diagnostic codeを実装する。
- **受け入れ条件**: 部分API失敗を含め、局所表示とglobal statusが矛盾しない。
- **テスト内容**: Vitestで各state、E2Eで500/offline/recover/401。
- **スクリーンショット条件**: 1280 dark/light、390 light、960×540 darkの正常・error・復旧後。

### Task 2: Ganttの小画面編集surfaceを一本化する

- **対象ファイル**: `frontend/css/index.css`, `frontend/css/gantt.css`, `frontend/js/gantt/gantt-renderer.js`, `frontend/index.html`, Gantt tests
- **問題**: popoverと固定詳細が同時に開き、960×540で表を覆う。
- **修正方針**: viewportに応じても編集モデルは一つにし、背景文脈を保持する。
- **実装内容**: desktopはside detail、960px以下はbottom drawerまたは専用editorの一つに統合。title safe areaとfocus restoreを実装。
- **受け入れ条件**: 編集対象、現在値、保存／clear／cancelが常に見え、表と重ならない。
- **テスト内容**: keyboard navigation、Enter/Space、Escape、save/clear/cancel、focus復帰。
- **スクリーンショット条件**: 390×844、960×540、1280×720、1920×1080、dark/light。

### Task 3: フォーカスと操作領域をWCAG基準へ引き上げる

- **対象ファイル**: 3 CSS、`frontend/index.html`, component tests
- **問題**: focus ringが3:1未達、主要操作に27～36pxがある。
- **修正方針**: 専用tokenとtarget size policyを共通化する。
- **実装内容**: 2px ring＋offset、44px standard/36px compact、24px absolute minimum、focus遮蔽補正、forced-colorsを追加。
- **受け入れ条件**: 全操作のfocusが3:1以上、200%で見失わず、主要button 44px以上。
- **テスト内容**: CSS token check、axe、Tab traversal、contrast script。
- **スクリーンショット条件**: 各主要画面のfocus状態をdark/light/high contrastで保存。

### Task 4: Member Loadの説明と詳細表示契約を修正する

- **対象ファイル**: `frontend/index.html`, `frontend/js/member/member-view.js`, `frontend/css/member-view.css`, `frontend/tests/member-view.test.js`
- **問題**: 固定表示の説明が誤り、内訳がhoverに依存する。
- **修正方針**: click-opened上部panelを復活させず、明示的かつアクセシブルな詳細経路を作る。
- **実装内容**: ガイド文言を実挙動へ合わせ、cell内詳細buttonまたはrow detailをEnter/Space/touch対応で追加する。
- **受け入れ条件**: マウス、keyboard、touchで同じ内訳へ到達し、旧上部panel DOMは存在しない。
- **テスト内容**: hover、Enter/Space、touch-equivalent click、月highlight、detail close。
- **スクリーンショット条件**: 1280 dark/lightの通常・詳細、390の詳細表示。

### Task 5: 共通モーダルとメニューのキーボード契約を完成させる

- **対象ファイル**: `frontend/js/app.js`, `frontend/index.html`, `frontend/js/gantt/gantt-renderer.js`, `frontend/css/index.css`, tests
- **問題**: 入力中Escapeが効かず、context menuがマウス専用。
- **修正方針**: Windows desktopの予測可能なdialog/menu操作へ合わせる。
- **実装内容**: Escape優先、IME例外、未保存確認、menu role、roving tabindex、矢印/Home/End/Escape、triggerへfocus restore。
- **受け入れ条件**: focus位置にかかわらず契約が一定で、screen readerが項目とdisabledを読み上げる。
- **テスト内容**: unit＋Playwright keyboard matrix、IME composition mock。
- **スクリーンショット条件**: theme modal、cell context menuのfocus/disabled/danger状態を両themeで確認。

### Task 6: semantic design tokenへ段階移行する

- **対象ファイル**: `frontend/css/index.css`, `frontend/css/gantt.css`, `frontend/css/member-view.css`, `frontend/js/insights-view.js`, lint tool
- **問題**: 実質158種類の色リテラル表記と画面別例外がある。
- **修正方針**: 現行見た目を一度alias化してから、role値を調整する。
- **実装内容**: 8章token、graph/load palette、elevation、radius、z-indexを定義。許可外literal checkを追加。
- **受け入れ条件**: 画面コードに許可外色0、同じ意味は同じtoken、dark/light双方に値がある。
- **テスト内容**: token completeness、lint、component visual regression。
- **スクリーンショット条件**: 全主要画面のbefore/afterを同一データ・viewportで比較。

### Task 7: タイポグラフィと数値整列を再設計する

- **対象ファイル**: 3 CSS、`frontend/js/insights-view.js`, 全一覧／表markup
- **問題**: 12px偏重、11.2px、軸・注釈・表が同じ階層、数値整列が不統一。
- **修正方針**: 16px body/14px compactを基準に用途tokenを適用する。
- **実装内容**: type token、tabular nums、数値右揃え、単位style、caption制限、graph label 13～14pxを実装。
- **受け入れ条件**: 11px台0、200%で切れず、表密度をcompact modeで選べる。
- **テスト内容**: CSS check、長い日本語、負数、小数、大桁、200% screenshot。
- **スクリーンショット条件**: Gantt/Member/Insightsの100/125/150/200%比較。

### Task 8: Member Load/Ganttの期間・密度ナビゲーションを追加する

- **対象ファイル**: `member-view.js`, `gantt-renderer.js`, 2 CSS、関連tests
- **問題**: 長期間で横scrollが大きく、比較文脈を失う。
- **修正方針**: 表の全列を縮めるのではなく、ユーザーが観測窓を選べるようにする。
- **実装内容**: 6/12/24か月preset、現在月へ移動、異常へ移動、compact/comfortable密度、sticky summaryを追加。
- **受け入れ条件**: 直近12か月と最初の異常へ1操作で到達し、選択状態を保持する。
- **テスト内容**: 60か月fixture、1000行、scroll/focus保持、CSV契約非変更。
- **スクリーンショット条件**: 390、960、1280、1920で各densityと期間を比較。

### Task 9: Insightsグラフへアクセシブルな詳細表を追加する

- **対象ファイル**: `frontend/js/insights-view.js`, `frontend/css/index.css`, `frontend/tests/insights-view.test.js`
- **問題**: 透明SVG hotspotがclick専用で、単位・欠損・細い帯を確実に読めない。
- **修正方針**: SVGを概要、表を正確な読み取り経路にする。
- **実装内容**: 月選択button、詳細table、単位、欠損、基準超過、系列toggle、focus同期を実装。
- **受け入れ条件**: 色を見なくても月・テーマ・負荷・capacityを取得できる。
- **テスト内容**: keyboard、screen reader name、欠損、0、過負荷、多系列、small viewport。
- **スクリーンショット条件**: 通常／選択／欠損／過負荷、dark/light、390/1280/fullscreen。

### Task 10: UI回帰基盤をCIへ追加する

- **対象ファイル**: `frontend/e2e/`新設、Playwright設定、CI、test fixture、docs
- **問題**: unit 93件では視覚・状態・keyboard回帰を検出できない。
- **修正方針**: 安定したseed DBと主要状態のbrowser testを持つ。
- **実装内容**: login、7画面、dark/light、empty/error/modal、390/960/1280/1920、axe、screenshot baselineを追加。
- **受け入れ条件**: 本報告のCritical/Major再現ケースを自動検出し、差分artifactをCIで確認できる。
- **テスト内容**: deterministic seed、animation停止、時刻固定、retry、focus、visual threshold。
- **スクリーンショット条件**: OS/font差を管理したWindows CI baselineを正とする。

## 付録A. 事前調査結果

| 調査項目 | 確認結果 |
| --- | --- |
| UIフレームワーク | Vite＋Vanilla JavaScript＋HTML/CSS。React/Vue等なし |
| 画面構成 | Login、Gantt、Member Load、Insights、Themes、Members、UsersのSPA |
| ダイアログ／パネル | 共有CRUD modal、cell editor、Gantt detail、context menu、toast、ribbon fullscreen |
| 共通部品 | `.btn*`, form field, summary card, nav, modal, toast, status chip。JSは`app.js`中心に各view module |
| theme/style | `frontend/css/index.css`, `gantt.css`, `member-view.css`。CSS custom propertiesでdark/light |
| responsive | 1024px、720px等のmedia queryあり。内部table scroll方式 |
| dark/light | あり。localStorageで保持し実画面確認済み |
| icon | 外部libraryなし。inline SVG＋一部文字記号 |
| graph/table/form | Insights SVG ribbon、Gantt/Member tables、共有dialog input、scenario form |
| screenshot生成 | 製品機能はGanttのみ`html-to-image`の`toPng`。監査はin-app browserで全画面capture |
| 起動方法 | Backend `..\.venv\Scripts\python.exe app.py`、frontend `npm run dev`。監査時はtemp DBとport 5001を使用 |
| UI test | Vitest＋jsdom 10 files/93 tests。既存E2E、visual regression、axeは見つからず |
| package | PyInstaller onefile `dist/manage_app.exe`。今回はreviewのみのためEXEは起動・再buildしていない |

コード入口は`frontend/index.html`、`frontend/js/app.js`、`frontend/js/api.js`、`frontend/js/shared-state.js`、`frontend/js/gantt/gantt-renderer.js`、`frontend/js/member/member-view.js`、`frontend/js/insights-view.js`。バックエンドの認証エラーは`backend/routes/auth.py`、配賦は`backend/services/allocation_service.py`へ接続する。

## 付録B. 実画面の証拠

保存先: `C:\Users\galax\.codex\visualizations\2026\07\14\019f60c5-d5cd-7303-bba1-995aa57e06f1`

| ファイル | 条件 | 主な確認事項 |
| --- | --- | --- |
| `01-gantt-dark-default.png` | 1280×720 dark | 初期Gantt、sidebar、操作密度、横scroll |
| `03-member-load-expanded-dark.png` | 1280×720 dark | メンバー展開、テーマ内訳行 |
| `04-insights-dark-default.png` | 1280×720 dark | summaryとribbon chart |
| `05-insights-scenario-dark.png` | 1280×720 dark | scenario formとfocus |
| `07-themes-empty-search-dark.png` | 1280×720 dark | 検索0件のempty state |
| `08-theme-create-modal-dark.png` | 1280×720 dark | 長いCRUD modal |
| `10-users-dark-default.png` | 1280×720 dark | 管理者画面、英語装飾語 |
| `13-member-load-light-default.png` | 1280×720 light | 480px相当の内部横scroll、ガイド |
| `15-insights-light-390x844.png` | 390×844 light | narrow stack、chart位置 |
| `16-gantt-light-390x844.png` | 390×844 light | 表開始位置、内部scroll |
| `17-member-load-light-390x844.png` | 390×844 light | first viewに表が出ない |
| `19-theme-modal-light-390x844.png` | 390×844 light | modal内1391px scroll、footer固定 |
| `21-gantt-dark-1920x1080.png` | 1920×1080 dark | 大画面の間延びと12px密度 |
| `22-gantt-dark-960x540-200pct-equivalent.png` | 960×540 dark | 200%相当、menu/title重なり |
| `23-gantt-cell-editor-keyboard-dark.png` | 960×540 dark | keyboard編集、固定detail遮蔽 |
| `25-insights-network-error-dark.png` | 1280×720 dark | HTTP 500と「最新」の矛盾 |
| `26-login-dark-default.png` | 1280×720 dark | login control寸法 |
| `27-login-error-dark.png` | 1280×720 dark | 英語error、低い通知性 |

補足: 既定環境はDPR 1.25。960×540はFull HD 200%時の有効CSS領域を近似したもので、実OS 200%のフォントラスタライズやWebView挙動を完全再現するものではない。`24-member-load-hover-dark-dpr125.png`では自動操作によるhover popup出現を確認できなかったため、hover不具合の証拠には使用していない。

## 付録C. 実行・検証結果

- `git status --short`: 開始時からfrontend 8ファイル等にユーザーの未コミット変更と未追跡物が存在。レビュー対象として保持し、変更・巻き戻ししていない。
- Vite dev server＋Flaskを起動。Flaskは既存`backend/database.db`を使わず一時コピーDBを指定し、通常画面と認証画面を確認した。
- `npm test -- --run`: **10 files / 93 tests passed**。
- `npm run lint`: **Frontend lint checks passed**。
- `npm run format:check`: **Frontend formatting looks good**。
- `npm run build`: **Vite production build passed**（28 modules、約0.47秒）。生成先`frontend/dist`は監査成果物として変更・コミットしない。
- ブラウザ確認: 主要7画面＋login、dark/light、390×844、960×540、1280×720、1920×1080、empty、error、modal、keyboard cell edit。
- 未実施: backend pytest、EXE build/起動、実OS 150/200%、4K、NVDA/JAWS、High Contrast、1000行性能。今回はreview-onlyであり、フロント実画面評価に不要な配布物を変更しないため。

## 付録D. 検証の限界と残存リスク

- 監査対象は未コミット変更を含む現在のワーキングツリーであり、`main`や配布済みEXEと同一とは限らない。
- 実データは11テーマ、6メンバー、128のセル操作要素を含むが、「大量データ」の性能限界ではない。
- 英語locale切替は存在を確認できず、完全な英語表示・長い英語文言は未検証。
- 実OS DPI、WebView2、screen reader、forced colorsは別途実機検証が必要。
- 色コントラストは代表tokenと隣接背景を計算した。全158色表記の全組合せを適合判定したわけではない。
- セキュリティ、API契約、DB移行、配賦計算は今回のUI review対象外で、変更もしていない。

## 最終判断

Manageは機能を実装しただけの段階は超えている。しかし、Sonyブランドの技術製品として出荷するには、外観のpolishより先に、状態の真実性、拡大表示、keyboard/accessibility、共通デザイン規則を直す必要がある。Critical 5件をPhase 0/1で解消し、主要3画面をPhase 2で再設計した後に、初めてAランクを狙える。現在はCランクであり、ロゴや表面的な色変更だけでは品質差は埋まらない。
