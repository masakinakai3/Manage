# リソース管理ツール

開発テーマごとの人員配置（誰が・いつ・何割）を可視化し、リソース計画の調整を支援する WEB アプリケーションです。

## アプリケーションへのアクセス

起動後、以下のURLにアクセスしてアプリを使用します。

- **通常起動 (Backendのみ)**: [http://127.0.0.1:5000](http://127.0.0.1:5000)
- **開発モード (Frontend Dev)**: [http://localhost:5173](http://localhost:5173)

## 主な機能

- **テーマ視点ガントチャート**: テーマ × メンバー × 月の割当を表形式で可視化。期間のハイライト、カテゴリ表示、進捗ステータス管理機能付き。
- **メンバー負荷表**: メンバーごとの月次負荷率を集計・表示し、リソースの過不足を一目で特定。
- **直感的な操作**:
  - ドラッグ＆ドロップによるメンバーアサイン移動・期間変更。
  - スピンボタンによる正確な期間設定 (YY-MM)。
  - セルクリックによる稼働率編集。
- **視覚的フィードバック**:
  - 負荷オーバー時の警告アラート。
  - テーマ期間（開始〜終了）の可視化。
  - 折りたたみ時のメンバー別負荷内訳ツールチップ。
- **状態保存**: ガントチャートの展開/折りたたみ状態をブラウザに自動保存。
- **管理機能**: テーマ・メンバーの追加・編集・削除、スキル設定、CSVエクスポート。
- **簡単導入**: 認証不要（自動管理者ログイン）、単一EXEファイルでの配布が可能。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | HTML5, CSS3, Vanilla JS (Vite) |
| バックエンド | Python 3.10+, Flask |
| データベース | SQLite (SQLAlchemy) |
| 配布 | PyInstaller (Single EXE) |

## 動作環境

- Windows 10/11
- 最新のWebブラウザ (Chrome, Edge, Firefox等)

## 開発環境セットアップ

### 前提条件

- Python 3.10+
- Node.js 18+

### インストール

```bash
# バックエンド依存関係
cd backend
pip install -r requirements.txt

# フロントエンド依存関係
cd frontend
npm install
```

### 開発サーバー起動

```bash
# ターミナル1: バックエンド (http://localhost:5001)
cd backend
python app.py

# ターミナル2: フロントエンド (http://localhost:5173)
cd frontend
npm run dev
```

## EXEファイルのビルド

フロントエンドとバックエンドを1つの実行ファイル (`manage_app.exe`) にまとめます。

```bash
# プロジェクトルートで実行
python build_exe.py
```

生成された `dist/manage_app.exe` を配布することで、PythonやNode.jsがインストールされていない環境でも動作します。

## プロジェクト構成

```
Manage/
├── backend/                # Flask Backend
│   ├── app.py              # Entry point & Config
│   ├── models.py           # DB Models
│   ├── routes/             # API Endpoints
│   └── services/           # Business Logic
├── frontend/               # Vite Frontend
│   ├── index.html          # SPA Entry
│   ├── css/                # Styling
│   └── js/                 # Application Logic
│       ├── gantt/          # Gantt Chart Components
│       └── member/         # Member View Components
├── doc/                    # Documentation
│   └── UserManual.md       # ユーザーマニュアル
├── Requirement.md          # 要件定義
└── build_exe.py            # PyInstaller Build Script
```

## ライセンス

Private
