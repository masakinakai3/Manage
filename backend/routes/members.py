#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

"""Member CRUD and monthly capacity routes."""

import re

from flask import Blueprint, request, jsonify
from flask_login import login_required
from models import db, Member, MemberCapacity

members_bp = Blueprint('members', __name__)
MONTH_RE = re.compile(r'^\d{4}-(0[1-9]|1[0-2])$')


def _validated_capacity(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 200:
        raise ValueError('capacity must be an integer between 1 and 200')
    return value


@members_bp.route('', methods=['GET'])
@login_required
def list_members():
    """
    List members
    ---
    tags:
      - Members
    parameters:
      - in: query
        name: active
        schema:
          type: boolean
          default: true
        description: If true, return only active members
    responses:
      200:
        description: List of members
    """
    active_only = request.args.get('active', 'true').lower() == 'true'
    query = Member.query
    if active_only:
        query = query.filter_by(is_active=True)
    members = query.order_by(Member.member_id).all()
    return jsonify([m.to_dict() for m in members])


@members_bp.route('', methods=['POST'])
@login_required
def create_member():
    """
    Create a member
    ---
    tags:
      - Members
    requestBody:
      content:
        application/json:
          schema:
            type: object
            required:
              - display_name
            properties:
              display_name:
                type: string
              department:
                type: string
              capacity:
                type: integer
                default: 100
    responses:
      201:
        description: Member created
      400:
        description: display_name is required
    """
    data = request.get_json()
    if not data or not data.get('display_name'):
        return jsonify({'error': 'display_name is required'}), 400
    try:
        capacity = _validated_capacity(data.get('capacity', 100))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    member = Member(
        display_name=data['display_name'],
        department=data.get('department', ''),
        capacity=capacity,
    )
    db.session.add(member)
    db.session.commit()
    return jsonify(member.to_dict()), 201


@members_bp.route('/<int:member_id>', methods=['PUT'])
@login_required
def update_member(member_id):
    """
    Update a member
    ---
    tags:
      - Members
    parameters:
      - in: path
        name: member_id
        required: true
        schema:
          type: integer
    requestBody:
      content:
        application/json:
          schema:
            type: object
            properties:
              display_name:
                type: string
              department:
                type: string
              capacity:
                type: integer
              is_active:
                type: boolean
    responses:
      200:
        description: Updated member
      404:
        description: Not found
    """
    member = db.session.get(Member, member_id)
    if not member:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json() or {}
    if 'capacity' in data:
        try:
            data['capacity'] = _validated_capacity(data['capacity'])
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
    for field in ('display_name', 'department', 'capacity', 'is_active'):
        if field in data:
            setattr(member, field, data[field])
    db.session.commit()
    return jsonify(member.to_dict())


@members_bp.route('/<int:member_id>/capacities/<month>', methods=['PUT'])
@login_required
def update_member_capacity(member_id, month):
    """Create or replace a member's capacity override for one month."""
    member = db.session.get(Member, member_id)
    if not member:
        return jsonify({'error': 'Not found'}), 404
    if not MONTH_RE.fullmatch(month):
        return jsonify({'error': 'month must use YYYY-MM format'}), 400

    data = request.get_json() or {}
    try:
        capacity = _validated_capacity(data.get('capacity'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    override = MemberCapacity.query.filter_by(member_id=member_id, month=month).first()
    if override:
        override.capacity = capacity
    else:
        db.session.add(MemberCapacity(member_id=member_id, month=month, capacity=capacity))
    db.session.commit()
    return jsonify(member.to_dict())


@members_bp.route('/<int:member_id>/capacities/<month>', methods=['DELETE'])
@login_required
def delete_member_capacity(member_id, month):
    """Remove a monthly override so the member's normal capacity applies again."""
    member = db.session.get(Member, member_id)
    if not member:
        return jsonify({'error': 'Not found'}), 404
    if not MONTH_RE.fullmatch(month):
        return jsonify({'error': 'month must use YYYY-MM format'}), 400

    override = MemberCapacity.query.filter_by(member_id=member_id, month=month).first()
    if override:
        db.session.delete(override)
        db.session.commit()
    return jsonify(member.to_dict())


@members_bp.route('/<int:member_id>', methods=['DELETE'])
@login_required
def delete_member(member_id):
    """
    Delete a member
    ---
    tags:
      - Members
    parameters:
      - in: path
        name: member_id
        required: true
        schema:
          type: integer
    responses:
      200:
        description: Deleted
      404:
        description: Not found
    """
    member = db.session.get(Member, member_id)
    if not member:
        return jsonify({'error': 'Not found'}), 404
    db.session.delete(member)
    db.session.commit()
    return jsonify({'message': 'Deleted'})
