"""Authentication routes."""

#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

from flask import Blueprint, request, jsonify
from flask_login import login_user, logout_user, login_required, current_user
from models import db, User
from authz import admin_required

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
@admin_required
def list_users():
    users = User.query.all()
    return jsonify([u.to_dict() for u in users])


@auth_bp.route('/users', methods=['POST'])
@admin_required
def create_user():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    role = data.get('role', 'user')
    if not username or not password:
        return jsonify({'error': 'username and password are required'}), 400
    if role not in ('admin', 'user'):
        return jsonify({'error': 'role must be admin or user'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 409
    user = User(username=username, role=role)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return jsonify(user.to_dict()), 201


@auth_bp.route('/users/<int:user_id>', methods=['PUT'])
@admin_required
def update_user(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    data = request.get_json() or {}
    username = (data.get('username') or user.username).strip()
    role = data.get('role', user.role)
    password = data.get('password')

    if not username:
        return jsonify({'error': 'username is required'}), 400
    if role not in ('admin', 'user'):
        return jsonify({'error': 'role must be admin or user'}), 400

    duplicate = User.query.filter(User.username == username, User.id != user.id).first()
    if duplicate:
        return jsonify({'error': 'Username already exists'}), 409

    if user.id == current_user.id and role != 'admin':
        return jsonify({'error': 'You cannot remove your own admin role'}), 400

    if user.role == 'admin' and role != 'admin':
        admin_count = User.query.filter_by(role='admin').count()
        if admin_count <= 1:
            return jsonify({'error': 'At least one admin user is required'}), 400

    user.username = username
    user.role = role
    if password:
        user.set_password(password)
    db.session.commit()
    return jsonify(user.to_dict())


@auth_bp.route('/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if user.id == current_user.id:
        return jsonify({'error': 'You cannot delete your own account'}), 400
    if user.role == 'admin':
        admin_count = User.query.filter_by(role='admin').count()
        if admin_count <= 1:
            return jsonify({'error': 'At least one admin user is required'}), 400

    db.session.delete(user)
    db.session.commit()
    return jsonify({'message': 'Deleted'})
