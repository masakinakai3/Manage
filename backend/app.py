"""Flask application factory and initialization."""

import os
from flask import Flask
from flask_cors import CORS
from flask_login import LoginManager
from models import db, User


def create_app():
    app = Flask(__name__)

    # Configuration
    base_dir = os.path.abspath(os.path.dirname(__file__))
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{os.path.join(base_dir, "database.db")}'
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


    # Initialize database
    with app.app_context():
        db.create_all()
        _seed_admin(app)

    return app


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
