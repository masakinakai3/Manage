import sys
import os
#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

import pytest

# Add backend to sys.path so we can import app and models
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../backend')))

from app import create_app
from models import db, User

@pytest.fixture
def app():
    """Create and configure a new app instance for each test."""
    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
        "WTF_CSRF_ENABLED": False,  # Disable CSRF for testing
        "INITIAL_ADMIN_PASSWORD": "admin",
        "AUTO_LOGIN": False,
    })

    with app.app_context():
        # create_app already ran db.create_all() and seeded admin
        
        yield app
        
        db.session.remove()
        db.drop_all()

@pytest.fixture
def client(app):
    """A test client for the app."""
    return app.test_client()

@pytest.fixture
def runner(app):
    """A test runner for the app's CLI commands."""
    return app.test_cli_runner()

@pytest.fixture
def auth_client(client):
    """A helper to log in the admin user."""
    client.post('/api/auth/login', json={
        'username': 'admin',
        'password': 'admin'
    })
    return client


@pytest.fixture
def user_client(client, app):
    """A helper to log in a non-admin user."""
    with app.app_context():
        user = User(username='user1', role='user')
        user.set_password('userpass')
        db.session.add(user)
        db.session.commit()

    client.post('/api/auth/login', json={
        'username': 'user1',
        'password': 'userpass'
    })
    return client
