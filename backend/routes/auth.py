"""Authentication routes."""

#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

from flask import Blueprint, request, jsonify
from flask_login import login_user, logout_user, login_required, current_user
from models import db, User

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(username=data.get('username')).first()
    if user and user.check_password(data.get('password', '')):
        login_user(user)
        return jsonify(user.to_dict())
    return jsonify({'error': 'Invalid credentials'}), 401


@auth_bp.route('/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({'message': 'Logged out'})


@auth_bp.route('/me', methods=['GET'])
@login_required
def me():
    return jsonify(current_user.to_dict())


@auth_bp.route('/users', methods=['GET'])
@login_required
def list_users():
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin only'}), 403
    users = User.query.all()
    return jsonify([u.to_dict() for u in users])


@auth_bp.route('/users', methods=['POST'])
@login_required
def create_user():
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin only'}), 403
    data = request.get_json()
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': 'Username already exists'}), 409
    user = User(username=data['username'], role=data.get('role', 'user'))
    user.set_password(data['password'])
    db.session.add(user)
    db.session.commit()
    return jsonify(user.to_dict()), 201
