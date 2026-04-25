"""Flask application factory and initialization."""

#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

import os
import socket
import sys
import time
import secrets
from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_login import LoginManager
from flasgger import Swagger
from models import db, User, Theme, ThemeMilestone

APP_HOST = os.environ.get('APP_HOST', '0.0.0.0')
APP_PORT = 5001


def _detect_lan_ip():
    """Best-effort LAN address for sharing the app on the local network."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(('8.8.8.8', 80))
        detected_ip = sock.getsockname()[0]
        if detected_ip and not detected_ip.startswith('127.'):
            return detected_ip
    except OSError:
        return 'localhost'
    finally:
        sock.close()
    return 'localhost'


PUBLIC_APP_HOST = os.environ.get('APP_PUBLIC_HOST')
if not PUBLIC_APP_HOST:
    PUBLIC_APP_HOST = 'localhost' if APP_HOST in ('127.0.0.1', 'localhost') else _detect_lan_ip()

APP_URL = f"http://{PUBLIC_APP_HOST}:{APP_PORT}/"
LOOPBACK_ORIGINS = [
    APP_URL.rstrip("/"),
    f"http://localhost:{APP_PORT}",
    f"http://127.0.0.1:{APP_PORT}",
]


def _resolve_dist_folder():
    if getattr(sys, 'frozen', False):
        external_dist = os.path.join(os.path.dirname(sys.executable), 'dist')
        bundled_dist = os.path.join(sys._MEIPASS, 'dist')
        if os.path.exists(os.path.join(external_dist, 'index.html')):
            return external_dist
        return bundled_dist

    return os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'dist')


def create_app(test_config=None):
    # Determine paths
    dist_folder = _resolve_dist_folder()

    app = Flask(__name__, static_folder=dist_folder, static_url_path='', template_folder=dist_folder)

    # Configuration
    base_dir = os.path.abspath(os.path.dirname(__file__))
    if getattr(sys, 'frozen', False):
        # DB in the same folder as the exe
        db_path = os.path.join(os.path.dirname(sys.executable), 'database.db')
    else:
        db_path = os.path.join(base_dir, 'database.db')
    
    app.config['SECRET_KEY'] = _resolve_secret_key()
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['AUTO_LOGIN'] = os.environ.get('AUTO_LOGIN', '').strip().lower() in ('1', 'true', 'yes', 'on')
    app.config['INITIAL_ADMIN_USERNAME'] = os.environ.get('INITIAL_ADMIN_USERNAME', 'admin').strip() or 'admin'
    app.config['INITIAL_ADMIN_PASSWORD'] = os.environ.get('INITIAL_ADMIN_PASSWORD')
    app.config['RESET_ADMIN_USERNAME'] = os.environ.get('RESET_ADMIN_USERNAME', '').strip()
    app.config['RESET_ADMIN_PASSWORD'] = os.environ.get('RESET_ADMIN_PASSWORD')
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

    if test_config:
        app.config.update(test_config)

    # Extensions
    CORS(app, supports_credentials=True, origins=LOOPBACK_ORIGINS)
    db.init_app(app)

    # Login manager
    login_manager = LoginManager()
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    @login_manager.unauthorized_handler
    def unauthorized():
        return {'error': 'Authentication required'}, 401

    # Register blueprints
    from routes.auth import auth_bp
    from routes.themes import themes_bp
    from routes.members import members_bp
    from routes.allocations import allocations_bp
    from routes.export import export_bp
    from routes.import_data import import_data_bp
    from routes.snapshots import snapshots_bp
    from routes.insights import insights_bp
    from routes.saved_views import saved_views_bp

    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(themes_bp, url_prefix='/api/themes')
    app.register_blueprint(members_bp, url_prefix='/api/members')
    app.register_blueprint(allocations_bp, url_prefix='/api/allocations')
    app.register_blueprint(export_bp, url_prefix='/api/export')
    app.register_blueprint(import_data_bp, url_prefix='/api/import')
    app.register_blueprint(snapshots_bp, url_prefix='/api/snapshots')
    app.register_blueprint(insights_bp, url_prefix='/api/insights')
    app.register_blueprint(saved_views_bp, url_prefix='/api/saved-views')

    # Swagger / OpenAPI
    app.config['SWAGGER'] = {
        'title': 'Resource Manager API',
        'uiversion': 3,
        'openapi': '3.0.1'
    }
    Swagger(app)

    # Serve the bundled single-page app.
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve(path):
        if path and os.path.exists(os.path.join(app.static_folder, path)):
            return app.send_static_file(path)
        return send_from_directory(app.template_folder, 'index.html')

    @app.after_request
    def disable_cache(response):
        """Always serve the latest bundled frontend assets in desktop usage."""
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

    # Initialize database
    with app.app_context():
        db.create_all()
        _migrate_allocations_unique_index()
        _migrate_theme_milestones()
        _seed_admin(app)
        _reset_admin_password_if_requested(app)

    @app.before_request
    def auto_login():
        """Optional auto-login for trusted desktop usage."""
        if not app.config.get('AUTO_LOGIN'):
            return
        from flask import request as flask_request
        from flask_login import current_user, login_user
        remote_addr = flask_request.remote_addr or ''
        is_trusted_desktop_network = remote_addr.startswith('127.') or remote_addr == '::1'
        if not is_trusted_desktop_network:
            return
        if not current_user.is_authenticated:
            user = db.session.query(User).filter_by(username=app.config['INITIAL_ADMIN_USERNAME']).first()
            if user:
                login_user(user)

    return app


def _migrate_allocations_unique_index():
    """Ensure the UNIQUE INDEX on allocations(theme_id, member_id, month) exists.

    If the DB was created before the UniqueConstraint was added, the index
    won't exist and ON CONFLICT won't work. This migration:
    1. Removes duplicate rows (keeps the one with highest id = most recent)
    2. Creates the unique index if missing
    """
    from sqlalchemy import text

    # Check if the unique index already exists
    result = db.session.execute(
        text("SELECT name FROM sqlite_master WHERE type='index' AND name='uq_allocation'")
    ).fetchone()

    if result:
        return  # Index already exists

    # Clean up duplicates: keep the row with the highest id for each (theme_id, member_id, month)
    db.session.execute(text("""
        DELETE FROM allocations
        WHERE id NOT IN (
            SELECT MAX(id)
            FROM allocations
            GROUP BY theme_id, member_id, month
        )
    """))
    db.session.commit()

    # Create the unique index
    try:
        db.session.execute(text(
            "CREATE UNIQUE INDEX uq_allocation ON allocations(theme_id, member_id, month)"
        ))
        db.session.commit()
        print("[Migration] Created UNIQUE INDEX uq_allocation on allocations table.")
    except Exception as e:
        db.session.rollback()
        print(f"[Migration] UNIQUE INDEX may already exist: {e}")


def _migrate_theme_milestones():
    """Ensure milestone storage exists and backfill legacy single-milestone data."""
    from sqlalchemy import text

    existing_columns = {
        row[1]
        for row in db.session.execute(text("PRAGMA table_info(themes)")).fetchall()
    }

    statements = []
    if 'milestone_month' not in existing_columns:
        statements.append("ALTER TABLE themes ADD COLUMN milestone_month VARCHAR(7)")
    if 'milestone_label' not in existing_columns:
        statements.append("ALTER TABLE themes ADD COLUMN milestone_label VARCHAR(200)")
    if 'dev_complete_month' not in existing_columns:
        statements.append("ALTER TABLE themes ADD COLUMN dev_complete_month VARCHAR(7)")
    if 'dev_complete_months' not in existing_columns:
        statements.append("ALTER TABLE themes ADD COLUMN dev_complete_months TEXT")
    if 'dev_rank' not in existing_columns:
        statements.append("ALTER TABLE themes ADD COLUMN dev_rank VARCHAR(1) NOT NULL DEFAULT 'M'")

    for statement in statements:
        db.session.execute(text(statement))

    if statements:
        db.session.commit()
        print("[Migration] Added milestone columns to themes table.")

    # Migrate theme_milestones: added is_completed
    existing_ms_cols = {
        row[1] for row in db.session.execute(text("PRAGMA table_info(theme_milestones)")).fetchall()
    }
    if 'is_completed' not in existing_ms_cols:
        db.session.execute(text("ALTER TABLE theme_milestones ADD COLUMN is_completed BOOLEAN NOT NULL DEFAULT 0"))
        db.session.commit()
        print("[Migration] Added is_completed column to theme_milestones table.")

    themes = Theme.query.filter(Theme.milestone_month.isnot(None)).all()
    inserted = 0
    for theme in themes:
        if theme.milestones:
            continue
        theme.milestones.append(ThemeMilestone(
            month=theme.milestone_month,
            label=theme.milestone_label,
            position=0,
        ))
        inserted += 1

    if inserted:
        db.session.commit()
        print(f"[Migration] Backfilled {inserted} legacy theme milestones.")


def _seed_admin(app):
    """Create default admin user if none exists."""
    if User.query.filter_by(role='admin').first() is None:
        username = app.config.get('INITIAL_ADMIN_USERNAME', 'admin')
        password = app.config.get('INITIAL_ADMIN_PASSWORD')
        generated_password = None
        if not password:
            if app.config.get('TESTING'):
                password = 'admin'
            else:
                generated_password = secrets.token_urlsafe(12)
                password = generated_password

        admin = User(username=username, role='admin')
        admin.set_password(password)
        db.session.add(admin)
        db.session.commit()
        if generated_password:
            _write_initial_admin_password_notice(username, generated_password)


def _reset_admin_password_if_requested(app):
    """Allow a local operator to reset an admin password via startup config."""
    password = app.config.get('RESET_ADMIN_PASSWORD')
    if not password:
        return

    username = app.config.get('RESET_ADMIN_USERNAME') or app.config.get('INITIAL_ADMIN_USERNAME', 'admin')
    user = User.query.filter_by(username=username).first()
    if user is None:
        print(f"[Security] Admin password reset skipped: user '{username}' was not found.")
        return
    if user.role != 'admin':
        print(f"[Security] Admin password reset skipped: user '{username}' is not an admin.")
        return

    user.set_password(password)
    db.session.commit()
    print(f"[Security] Admin password was reset for '{username}'. Remove RESET_ADMIN_PASSWORD after use.")


def _app_runtime_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.abspath(os.path.dirname(__file__))


def _resolve_secret_key():
    configured = os.environ.get('SECRET_KEY')
    if configured:
        return configured

    if 'PYTEST_CURRENT_TEST' in os.environ:
        return 'test-secret-key'

    secret_path = os.path.join(_app_runtime_dir(), 'secret_key.txt')
    if os.path.exists(secret_path):
        try:
            with open(secret_path, 'r', encoding='utf-8') as handle:
                saved = handle.read().strip()
            if saved:
                return saved
        except OSError as exc:
            print(f"[Security] Failed to read secret key file: {exc}")

    generated = secrets.token_urlsafe(32)
    try:
        with open(secret_path, 'w', encoding='utf-8') as handle:
            handle.write(generated)
        print(f"[Security] Generated persistent secret key at {secret_path}")
    except OSError as exc:
        print(f"[Security] Failed to persist secret key: {exc}")
        print("[Security] Falling back to an in-memory secret key for this run.")
    return generated


def _write_initial_admin_password_notice(username, password):
    """Persist the generated initial admin password next to the app database."""
    credentials_path = os.path.join(_app_runtime_dir(), 'initial_admin_password.txt')
    message = (
        "Initial admin account created.\n"
        f"Username: {username}\n"
        f"Password: {password}\n"
        "Change this password immediately after the first login.\n"
    )
    try:
        with open(credentials_path, 'w', encoding='utf-8') as handle:
            handle.write(message)
        print(f"[Security] Wrote generated admin password to {credentials_path}")
    except OSError as exc:
        print(f"[Security] Failed to write generated admin password file: {exc}")
        print(f"[Security] Temporary admin password: {password}")


def _open_browser_when_ready(url, timeout_seconds=20):
    """Wait for the local server, then open the default browser."""
    import webbrowser

    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            probe_host = '127.0.0.1' if APP_HOST == '0.0.0.0' else APP_HOST
            with socket.create_connection((probe_host, APP_PORT), timeout=1):
                break
        except OSError:
            time.sleep(0.25)
    else:
        print(f"[Startup] Timed out waiting for server before opening browser: {url}")
        return

    try:
        if os.name == 'nt':
            os.startfile(url)
        else:
            webbrowser.open(url)
        print(f"[Startup] Opened browser for {url}")
    except OSError as exc:
        print(f"[Startup] Failed to open browser automatically: {exc}")
        webbrowser.open(url)


if __name__ == '__main__':
    app = create_app()
    print(f"[Startup] Listening on http://127.0.0.1:{APP_PORT}/")
    if PUBLIC_APP_HOST not in ('localhost', '127.0.0.1'):
        print(f"[Startup] LAN access URL: {APP_URL}")
    
    # When running as an executable, open the browser automatically
    if getattr(sys, 'frozen', False):
        import threading
        # Ensure debug is False when frozen to avoid reloader issues
        debug_mode = False
        threading.Thread(
            target=_open_browser_when_ready,
            args=(f"http://127.0.0.1:{APP_PORT}/",),
            daemon=True,
        ).start()
    else:
        debug_mode = True

    app.run(debug=debug_mode, host=APP_HOST, port=APP_PORT)
