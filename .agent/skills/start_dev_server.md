---
description: 旧エージェント向けのManage開発サーバー互換入口
---

# Development Server Compatibility

正規手順は `.agents/skills/manage-build-and-test/SKILL.md` に統合されています。次を別ターミナルで実行してください。

```powershell
Set-Location backend
..\.venv\Scripts\python.exe app.py
```

```powershell
Set-Location frontend
npm run dev
```

backendは `http://127.0.0.1:5001`、Viteは `http://localhost:5173` です。
