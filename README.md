# リソース管理ツール

テーマ別ガントとメンバー別負荷の 2 画面で、月次の配分計画を管理する Web アプリです。

## 技術スタック

- Backend: Python 3.10+, Flask, SQLAlchemy, SQLite
- Frontend: Vite, Vanilla JavaScript, HTML, CSS
- Build: PyInstaller

## セットアップ

```bash
cd backend
pip install -r requirements.txt

cd ../frontend
npm install
```

## 開発起動

```bash
cd backend
python app.py

cd ../frontend
npm run dev
```

- Backend: `http://127.0.0.1:5001`
- Frontend: `http://localhost:5173`

## テストと品質チェック

```bash
python -m pytest

cd frontend
npm test
npm run lint
npm run format:check
```

Windows では [`tools/run_checks.ps1`](tools/run_checks.ps1) でまとめて実行できます。

## 主な改善

- 保存状態をサイドバーで常時表示
- JSON インポート/エクスポート時の確認と結果通知を改善
- テーマ管理・メンバー管理に検索と並び替えを追加
- ガントとメンバー負荷の表示期間・検索条件を共有
- メンバー負荷にサマリーカードを追加

## ドキュメント

- [Requirement.md](Requirement.md)
- [SoftwareDesign.md](SoftwareDesign.md)
- [UserManual.md](UserManual.md)
- [UnitTestSpecification.md](UnitTestSpecification.md)

## Recent additions

- First-use onboarding with sample data guidance
- Saved views for recurring search, grouping, and period settings
- Insights screen for health checks, adjustment recommendations, and review dashboards
- Advanced CSV/Excel export templates with selectable columns
- Keyboard shortcut help and responsive narrow-width support
- Documentation and PR workflow standards under `docs/` and `.github/`
