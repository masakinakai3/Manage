#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

"""Member CRUD routes."""

from flask import Blueprint, request, jsonify
from flask_login import login_required
from models import db, Member

members_bp = Blueprint('members', __name__)


@members_bp.route('', methods=['GET'])
@login_required
def list_members():
    active_only = request.args.get('active', 'true').lower() == 'true'
    query = Member.query
    if active_only:
        query = query.filter_by(is_active=True)
    members = query.order_by(Member.member_id).all()
    return jsonify([m.to_dict() for m in members])


@members_bp.route('', methods=['POST'])
@login_required
def create_member():
    data = request.get_json()
    member = Member(
        display_name=data['display_name'],
        department=data.get('department', ''),
        capacity=data.get('capacity', 100),
    )
    db.session.add(member)
    db.session.commit()
    return jsonify(member.to_dict()), 201


@members_bp.route('/<int:member_id>', methods=['PUT'])
@login_required
def update_member(member_id):
    member = db.session.get(Member, member_id)
    if not member:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json()
    for field in ('display_name', 'department', 'capacity', 'is_active'):
        if field in data:
            setattr(member, field, data[field])
    db.session.commit()
    return jsonify(member.to_dict())


@members_bp.route('/<int:member_id>', methods=['DELETE'])
@login_required
def delete_member(member_id):
    member = db.session.get(Member, member_id)
    if not member:
        return jsonify({'error': 'Not found'}), 404
    db.session.delete(member)
    db.session.commit()
    return jsonify({'message': 'Deleted'})
