# Core Architecture & Coding Standard

## 技術スタック
- **バックエンド**: Python, Flask, SQLite, SQLAlchemy
- **フロントエンド**: Vanilla JavaScript, Vite, HTML, CSS (ReactやTailwindCSS等は不使用)
- **パッケージマネージャー**: pip (バックエンド), npm (フロントエンド)
- **ビルド・配布**: PyInstaller (EXE化)

## コーディング規約
- **ドキュメントとの整合性**: 常に `SoftwareDesign.md` および `Requirement.md` の仕様に従い、変更があった場合はドキュメントも併せて更新すること。
- **SOLID・KISS原則**: 常にシンプルで可読性の高いコードを維持すること。過剰なエンジニアリングを避ける。
- **DRY原則**: 共通ロジックは再利用可能な関数として抽出する。
- エラーハンドリングを徹底し、必要に応じて適切なログを出力する。

## 制約事項
- 新しいnpmパッケージやpipモジュールをインストールする際は、必ず事前にユーザーへ許可を求めること。
- 既存のディレクトリ構造（backend, frontend）を厳密に遵守すること。
