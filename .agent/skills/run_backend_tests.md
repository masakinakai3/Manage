---
description: 旧エージェント向けのManage backend test互換入口
---

# Backend Test Compatibility

正規手順は `.agents/skills/manage-build-and-test/SKILL.md` に統合されています。

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_api.py -q
.\.venv\Scripts\python.exe -m pytest -q
```

対象testを先に実行し、変更範囲に応じてfull suiteへ広げてください。
