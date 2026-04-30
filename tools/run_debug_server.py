import os
import sys

ROOT = r"C:\Users\galax\Desktop\Manage"
BACKEND = os.path.join(ROOT, "backend")

if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

os.environ.setdefault("AUTO_LOGIN", "true")
os.environ.setdefault("INITIAL_ADMIN_PASSWORD", "admin")
os.chdir(ROOT)

from app import APP_PORT, create_app  # noqa: E402

app = create_app()
app.run(debug=False, host="127.0.0.1", port=APP_PORT, use_reloader=False)
