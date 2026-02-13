"""Allocation CRUD routes with bulk update and load calculation."""

from flask import Blueprint, request, jsonify
from flask_login import login_required
from models import db, Allocation, Member
from services.allocation_service import get_member_loads, get_theme_loads, get_warnings

allocations_bp = Blueprint('allocations', __name__)


@allocations_bp.route('', methods=['GET'])
@login_required
def list_allocations():
    """Get allocations with optional filters: theme_id, member_id, from, to."""
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
    """Bulk update allocations. Expects JSON array of {theme_id, member_id, month, allocation_rate, memo?}."""
    data = request.get_json()
    if not isinstance(data, list):
        return jsonify({'error': 'Expected array'}), 400

    results = []
    for item in data:
        theme_id = item['theme_id']
        member_id = item['member_id']
        month = item['month']
        rate = item['allocation_rate']

        existing = Allocation.query.filter_by(
            theme_id=theme_id, member_id=member_id, month=month
        ).first()

        if rate == 0:
            # Delete allocation when rate is 0
            if existing:
                db.session.delete(existing)
        elif existing:
            existing.allocation_rate = rate
            existing.memo = item.get('memo', existing.memo)
            results.append(existing)
        else:
            alloc = Allocation(
                theme_id=theme_id,
                member_id=member_id,
                month=month,
                allocation_rate=rate,
                memo=item.get('memo', ''),
            )
            db.session.add(alloc)
            results.append(alloc)

    db.session.commit()
    return jsonify({'updated': len(results)})


@allocations_bp.route('/single', methods=['PUT'])
@login_required
def update_single():
    """Update a single allocation cell."""
    data = request.get_json()
    theme_id = data['theme_id']
    member_id = data['member_id']
    month = data['month']
    rate = data['allocation_rate']

    existing = Allocation.query.filter_by(
        theme_id=theme_id, member_id=member_id, month=month
    ).first()

    if rate == 0:
        if existing:
            db.session.delete(existing)
            db.session.commit()
        return jsonify({'message': 'Deleted'})

    if existing:
        existing.allocation_rate = rate
        existing.memo = data.get('memo', existing.memo)
    else:
        existing = Allocation(
            theme_id=theme_id, member_id=member_id,
            month=month, allocation_rate=rate,
            memo=data.get('memo', ''),
        )
        db.session.add(existing)

    db.session.commit()
    return jsonify(existing.to_dict())


@allocations_bp.route('/load/themes', methods=['GET'])
@login_required
def theme_loads():
    """Get theme monthly loads for gantt summary rows."""
    from_month = request.args.get('from')
    to_month = request.args.get('to')
    loads = get_theme_loads(from_month, to_month)
    return jsonify(loads)


@allocations_bp.route('/load/members', methods=['GET'])
@login_required
def member_loads():
    """Get member monthly loads for member view."""
    from_month = request.args.get('from')
    to_month = request.args.get('to')
    loads = get_member_loads(from_month, to_month)
    return jsonify(loads)


@allocations_bp.route('/warnings', methods=['GET'])
@login_required
def warnings():
    """Get overload warnings."""
    from_month = request.args.get('from')
    to_month = request.args.get('to')
    warns = get_warnings(from_month, to_month)
    return jsonify(warns)
