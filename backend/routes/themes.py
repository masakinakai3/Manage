#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

"""Theme CRUD routes."""

from flask import Blueprint, request, jsonify
from flask_login import login_required
from models import db, Theme, ThemeMilestone, Allocation, Member
from sqlalchemy import func

themes_bp = Blueprint('themes', __name__)


def _normalize_milestones(data):
    raw_milestones = data.get('milestones')
    if raw_milestones is None:
        legacy_month = (data.get('milestone_month') or '').strip()
        legacy_label = (data.get('milestone_label') or '').strip()
        raw_milestones = [{'month': legacy_month, 'label': legacy_label}] if legacy_month else []

    milestones = []
    for index, item in enumerate(raw_milestones):
        if not isinstance(item, dict):
            continue
        month = (item.get('month') or '').strip()
        label = (item.get('label') or '').strip() or None
        if not month:
            continue
        milestones.append({
            'month': month,
            'label': label,
            'position': index,
            'is_completed': item.get('is_completed', False),
        })
    return milestones


def _replace_theme_milestones(theme, items):
    theme.milestones = [
        ThemeMilestone(
            month=item['month'],
            label=item['label'],
            position=item['position'],
            is_completed=item['is_completed'],
        )
        for item in items
    ]
    first = items[0] if items else None
    theme.milestone_month = first['month'] if first else None
    theme.milestone_label = first['label'] if first else None


@themes_bp.route('', methods=['GET'])
@login_required
def list_themes():
    themes = Theme.query.order_by(Theme.theme_id).all()
    result = []
    for t in themes:
        td = t.to_dict()
        # Add summary info
        allocs = Allocation.query.filter_by(theme_id=t.theme_id).filter(
            Allocation.allocation_rate > 0
        )
        allocs_list = allocs.all()  # Execute query once
        months = [a.month for a in allocs_list]
        # Currently assigned members (via association) or those with allocations
        assigned_ids = set(m.member_id for m in t.members)
        alloc_ids = set(a.member_id for a in allocs_list)
        all_member_ids = assigned_ids | alloc_ids
        
        # Use stored dates or calculated fallback
        td['start_month'] = t.start_month or (min(months) if months else None)
        td['end_month'] = t.end_month or (max(months) if months else None)
        td['member_count'] = len(all_member_ids)
        td['member_ids'] = list(all_member_ids)
        result.append(td)
    return jsonify(result)


@themes_bp.route('', methods=['POST'])
@login_required
def create_theme():
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'name is required'}), 400
    theme = Theme(
        name=data['name'],
        category=data.get('category', ''),
        status=data.get('status', 'planning'),
        color=data.get('color', '#6366f1'),
        priority=data.get('priority', 0),
        start_month=data.get('start_month'),
        end_month=data.get('end_month'),
        dev_complete_month=data.get('dev_complete_month'),
    )
    _replace_theme_milestones(theme, _normalize_milestones(data))
    db.session.add(theme)
    db.session.commit()
    return jsonify(theme.to_dict()), 201


@themes_bp.route('/<int:theme_id>', methods=['PUT'])
@login_required
def update_theme(theme_id):
    theme = db.session.get(Theme, theme_id)
    if not theme:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json()
    for field in ('name', 'category', 'status', 'color', 'priority', 'start_month', 'end_month', 'dev_complete_month'):
        if field in data:
            setattr(theme, field, data[field])

    if 'milestones' in data or 'milestone_month' in data or 'milestone_label' in data:
        _replace_theme_milestones(theme, _normalize_milestones(data))
    
    # Optional: Bulk update member assignments if provided
    if 'member_ids' in data:
        theme.members = [db.session.get(Member, mid) for mid in data['member_ids'] if db.session.get(Member, mid)]
        
    db.session.commit()
    return jsonify(theme.to_dict())


@themes_bp.route('/<int:theme_id>', methods=['DELETE'])
@login_required
def delete_theme(theme_id):
    theme = db.session.get(Theme, theme_id)
    if not theme:
        return jsonify({'error': 'Not found'}), 404
    db.session.delete(theme)
    db.session.commit()
    return jsonify({'message': 'Deleted'})


@themes_bp.route('/<int:theme_id>/members', methods=['POST'])
@login_required
def assign_member(theme_id):
    theme = db.session.get(Theme, theme_id)
    if not theme:
        return jsonify({'error': 'Theme not found'}), 404
    data = request.get_json()
    member_id = data.get('member_id')
    member = db.session.get(Member, member_id)
    if not member:
        return jsonify({'error': 'Member not found'}), 404
    
    if member not in theme.members:
        theme.members.append(member)
        db.session.commit()
    return jsonify(theme.to_dict())


@themes_bp.route('/<int:theme_id>/members/bulk', methods=['POST'])
@login_required
def assign_members_bulk(theme_id):
    theme = db.session.get(Theme, theme_id)
    if not theme:
        return jsonify({'error': 'Theme not found'}), 404
    data = request.get_json()
    member_ids = data.get('member_ids', [])
    
    if not isinstance(member_ids, list):
        return jsonify({'error': 'member_ids must be a list'}), 400
    
    added_count = 0
    for mid in member_ids:
        member = db.session.get(Member, mid)
        if member and member not in theme.members:
            theme.members.append(member)
            added_count += 1
            
    if added_count > 0:
        db.session.commit()
        
    return jsonify({'message': f'Added {added_count} members', 'theme': theme.to_dict()})



@themes_bp.route('/<int:theme_id>/members/<int:member_id>', methods=['DELETE'])
@login_required
def unassign_member(theme_id, member_id):
    theme = db.session.get(Theme, theme_id)
    if not theme:
        return jsonify({'error': 'Theme not found'}), 404
    member = db.session.get(Member, member_id)
    if not member:
        return jsonify({'error': 'Member not found'}), 404
    
    if member in theme.members:
        theme.members.remove(member)
        db.session.commit()
    return jsonify(theme.to_dict())
