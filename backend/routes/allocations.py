"""Allocation CRUD routes with bulk update and load calculation."""

#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from flask_login import login_required
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from models import db, Allocation, Member
from services.allocation_service import get_member_loads, get_theme_loads, get_warnings

allocations_bp = Blueprint('allocations', __name__)


def _upsert_allocation(theme_id, member_id, month, rate, memo=None):
    """Atomic UPSERT using SQLite's INSERT ... ON CONFLICT ... DO UPDATE.

    This eliminates the TOCTOU race condition where two concurrent requests
    could both see 'no existing record' and both INSERT, creating duplicates.
    """
    if rate == 0:
        # Delete allocation when rate is 0
        Allocation.query.filter_by(
            theme_id=theme_id, member_id=member_id, month=month
        ).delete()
        return None

    stmt = sqlite_insert(Allocation).values(
        theme_id=theme_id,
        member_id=member_id,
        month=month,
        allocation_rate=rate,
        memo=memo or '',
        updated_at=datetime.now(timezone.utc),
    )

    # On conflict with the unique constraint (theme_id, member_id, month),
    # update the existing row instead of inserting a duplicate.
    update_values = {
        'allocation_rate': stmt.excluded.allocation_rate,
        'updated_at': stmt.excluded.updated_at,
    }
    if memo is not None:
        update_values['memo'] = stmt.excluded.memo

    stmt = stmt.on_conflict_do_update(
        index_elements=['theme_id', 'member_id', 'month'],
        set_=update_values,
    )

    db.session.execute(stmt)
    return True


@allocations_bp.route('', methods=['GET'])
@login_required
def list_allocations():
    """
    List allocations
    ---
    tags:
      - Allocations
    parameters:
      - in: query
        name: theme_id
        schema:
          type: integer
      - in: query
        name: member_id
        schema:
          type: integer
      - in: query
        name: from
        schema:
          type: string
          example: "2025-01"
      - in: query
        name: to
        schema:
          type: string
          example: "2025-12"
    responses:
      200:
        description: List of allocations
    """
    query = Allocation.query
    theme_id = request.args.get('theme_id', type=int)
    member_id = request.args.get('member_id', type=int)
    from_month = request.args.get('from')
    to_month = request.args.get('to')

    if theme_id:
        query = query.filter_by(theme_id=theme_id)
    if member_id:
        query = query.filter_by(member_id=member_id)
    if from_month:
        query = query.filter(Allocation.month >= from_month)
    if to_month:
        query = query.filter(Allocation.month <= to_month)

    allocs = query.filter(Allocation.allocation_rate > 0).order_by(
        Allocation.theme_id, Allocation.member_id, Allocation.month
    ).all()
    return jsonify([a.to_dict() for a in allocs])


@allocations_bp.route('/bulk', methods=['PUT'])
@login_required
def bulk_update():
    """
    Bulk update allocations
    ---
    tags:
      - Allocations
    requestBody:
      content:
        application/json:
          schema:
            type: array
            items:
              type: object
              properties:
                theme_id:
                  type: integer
                member_id:
                  type: integer
                month:
                  type: string
                  example: "2025-01"
                allocation_rate:
                  type: integer
                memo:
                  type: string
    responses:
      200:
        description: Number of updated records
      400:
        description: Invalid input
    """
    data = request.get_json()
    if not isinstance(data, list):
        return jsonify({'error': 'Expected array'}), 400

    count = 0
    for item in data:
        # Validate required fields
        missing = [f for f in ('theme_id', 'member_id', 'month', 'allocation_rate') if f not in item]
        if missing:
            return jsonify({'error': f'Missing fields: {missing}'}), 400
        if not isinstance(item.get('allocation_rate'), int):
            return jsonify({'error': 'allocation_rate must be an integer'}), 400
        result = _upsert_allocation(
            theme_id=item['theme_id'],
            member_id=item['member_id'],
            month=item['month'],
            rate=item['allocation_rate'],
            memo=item.get('memo'),
        )
        if result:
            count += 1

    db.session.commit()
    return jsonify({'updated': count})


@allocations_bp.route('/single', methods=['PUT'])
@login_required
def update_single():
    """
    Update a single allocation cell
    ---
    tags:
      - Allocations
    requestBody:
      content:
        application/json:
          schema:
            type: object
            properties:
              theme_id:
                type: integer
              member_id:
                type: integer
              month:
                type: string
                example: "2025-01"
              allocation_rate:
                type: integer
              memo:
                type: string
    responses:
      200:
        description: Updated allocation or deletion confirmation
      400:
        description: Invalid input
    """
    data = request.get_json()
    theme_id = data['theme_id']
    member_id = data['member_id']
    month = data['month']
    rate = data['allocation_rate']

    _upsert_allocation(
        theme_id=theme_id,
        member_id=member_id,
        month=month,
        rate=rate,
        memo=data.get('memo'),
    )
    db.session.commit()

    if rate == 0:
        return jsonify({'message': 'Deleted'})

    alloc = Allocation.query.filter_by(
        theme_id=theme_id, member_id=member_id, month=month
    ).first()
    return jsonify(alloc.to_dict() if alloc else {'message': 'Updated'})


@allocations_bp.route('/load/themes', methods=['GET'])
@login_required
def theme_loads():
    """
    Get theme monthly loads
    ---
    tags:
      - Allocations
    parameters:
      - in: query
        name: from
        schema:
          type: string
          example: "2025-01"
      - in: query
        name: to
        schema:
          type: string
          example: "2025-12"
    responses:
      200:
        description: Theme load data
    """
    from_month = request.args.get('from')
    to_month = request.args.get('to')
    loads = get_theme_loads(from_month, to_month)
    return jsonify(loads)


@allocations_bp.route('/load/members', methods=['GET'])
@login_required
def member_loads():
    """
    Get member monthly loads
    ---
    tags:
      - Allocations
    parameters:
      - in: query
        name: from
        schema:
          type: string
          example: "2025-01"
      - in: query
        name: to
        schema:
          type: string
          example: "2025-12"
    responses:
      200:
        description: Member load data
    """
    from_month = request.args.get('from')
    to_month = request.args.get('to')
    loads = get_member_loads(from_month, to_month)
    return jsonify(loads)


@allocations_bp.route('/warnings', methods=['GET'])
@login_required
def warnings():
    """
    Get overload warnings
    ---
    tags:
      - Allocations
    parameters:
      - in: query
        name: from
        schema:
          type: string
          example: "2025-01"
      - in: query
        name: to
        schema:
          type: string
          example: "2025-12"
    responses:
      200:
        description: List of overload warnings
    """
    from_month = request.args.get('from')
    to_month = request.args.get('to')
    warns = get_warnings(from_month, to_month)
    return jsonify(warns)
