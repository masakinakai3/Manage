"""Flask application factory and initialization."""

#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

import os
import sys
import time
from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_login import LoginManager
from models import db, User, Theme, ThemeMilestone

APP_HOST = "127.0.0.1"
APP_PORT = 5001
APP_URL = f"http://{APP_HOST}:{APP_PORT}/"
LOOPBACK_ORIGINS = [APP_URL.rstrip("/"), f"http://localhost:{APP_PORT}"]


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
    
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

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
        _seed_admin()

    @app.before_request
    def auto_login():
        """Auto-login is restricted to localhost only to avoid unintended access."""
        from flask import request as flask_request
        from flask_login import current_user, login_user
        # Only auto-login from loopback addresses
        if flask_request.remote_addr not in ('127.0.0.1', '::1'):
            return
        if not current_user.is_authenticated:
            user = db.session.query(User).filter_by(username='admin').first()
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


def _seed_admin():
    """Create default admin user if none exists."""
    if User.query.filter_by(role='admin').first() is None:
        admin = User(username='admin', role='admin')
        admin.set_password('admin')
        db.session.add(admin)
        db.session.commit()


def _open_browser_when_ready(url, timeout_seconds=20):
    """Wait for the local server, then open the default browser."""
    import socket
    import webbrowser

    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with socket.create_connection((APP_HOST, APP_PORT), timeout=1):
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
    
    # When running as an executable, open the browser automatically
    if getattr(sys, 'frozen', False):
        import threading
        # Ensure debug is False when frozen to avoid reloader issues
        debug_mode = False
        threading.Thread(
            target=_open_browser_when_ready,
            args=(APP_URL,),
            daemon=True,
        ).start()
    else:
        debug_mode = True

    app.run(debug=debug_mode, host=APP_HOST, port=APP_PORT)
