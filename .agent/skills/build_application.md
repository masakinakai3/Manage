---
description: 旧エージェント向けのManageビルド互換入口
---

# Build Application Compatibility

正規手順は `.agents/skills/manage-build-and-test/SKILL.md` に統合されています。

- 反復確認: `.\.venv\Scripts\python.exe build_exe.py --profile dev`
- 配布用onefile: `.\.venv\Scripts\python.exe build_exe.py`

配布完了はログだけでなく `dist/manage_app.exe` の実在、サイズ、更新時刻を確認してください。新しい説明をこのファイルへ追加しないでください。
