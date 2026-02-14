"""Flask application factory and initialization."""

import os
import sys
from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_login import LoginManager
from models import db, User


def create_app():
    # Determine paths
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle
        bundle_dir = sys._MEIPASS
        dist_folder = os.path.join(bundle_dir, 'dist')
    else:
        # Running dev
        dist_folder = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'dist')

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

    # Extensions
    CORS(app, supports_credentials=True)
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

    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(themes_bp, url_prefix='/api/themes')
    app.register_blueprint(members_bp, url_prefix='/api/members')
    app.register_blueprint(allocations_bp, url_prefix='/api/allocations')
    app.register_blueprint(export_bp, url_prefix='/api/export')

    # Serve React App
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve(path):
        if path and os.path.exists(os.path.join(app.static_folder, path)):
            return app.send_static_file(path)
        return send_from_directory(app.template_folder, 'index.html')

    # Initialize database
    with app.app_context():
        db.create_all()
        _migrate_allocations_unique_index()
        _seed_admin(app)

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


def _seed_admin(app):
    """Create default admin user if none exists."""
    if User.query.filter_by(role='admin').first() is None:
        admin = User(username='admin', role='admin')
        admin.set_password('admin')
        db.session.add(admin)
        db.session.commit()


if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, port=5001)
