#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

"""Theme CRUD routes."""

import json

from flask import Blueprint, request, jsonify
from flask_login import login_required
from models import db, Theme, ThemeMilestone, Allocation, Member
from sqlalchemy import func

themes_bp = Blueprint('themes', __name__)

PLAN_CERTAINTIES = {'tentative', 'confirmed'}


def _normalize_dev_rank(value):
    normalized = (value or '').strip()
    return normalized or ''


def _normalize_plan_certainty(value):
    normalized = str(value or '').strip().lower()
    return normalized if normalized in PLAN_CERTAINTIES else 'tentative'


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


def _normalize_dev_complete_months(data):
    raw_months = data.get('dev_complete_months')
    if raw_months is None:
        raw_months = [data.get('dev_complete_month')] if data.get('dev_complete_month') else []
    elif isinstance(raw_months, str):
        raw_months = [raw_months]

    items = []
    seen_months = set()
    for raw_month in raw_months or []:
        if isinstance(raw_month, dict):
            month = str(raw_month.get('month') or '').strip()
            is_completed = bool(raw_month.get('is_completed', False))
        else:
            month = str(raw_month or '').strip()
            is_completed = False
        if month and month not in seen_months:
            items.append({'month': month, 'is_completed': is_completed})
            seen_months.add(month)
    return items


def _set_dev_complete_months(theme, items):
    theme.dev_complete_month = items[0]['month'] if items else None
    theme.dev_complete_months = json.dumps(items, ensure_ascii=False) if items else None


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
    """
    List all themes
    ---
    tags:
      - Themes
    responses:
      200:
        description: List of themes with member counts and date ranges
    """
    themes = Theme.query.order_by(Theme.sort_order, Theme.theme_id).all()
    result = []
    for t in themes:
        td = t.to_dict()
        allocs = Allocation.query.filter_by(theme_id=t.theme_id).filter(
            Allocation.allocation_rate > 0
        )
        allocs_list = allocs.all()
        months = [a.month for a in allocs_list]
        assigned_ids = set(m.member_id for m in t.members)
        alloc_ids = set(a.member_id for a in allocs_list)
        all_member_ids = assigned_ids | alloc_ids

        td['start_month'] = t.start_month or (min(months) if months else None)
        td['end_month'] = t.end_month or (max(months) if months else None)
        td['member_count'] = len(all_member_ids)
        td['member_ids'] = list(all_member_ids)
        result.append(td)
    return jsonify(result)


@themes_bp.route('', methods=['POST'])
@login_required
def create_theme():
    """
    Create a theme
    ---
    tags:
      - Themes
    requestBody:
      content:
        application/json:
          schema:
            type: object
            required:
              - name
            properties:
              name:
                type: string
              category:
                type: string
              status:
                type: string
                enum: [planning, active, completed, on_hold]
              plan_certainty:
                type: string
                enum: [tentative, confirmed]
              color:
                type: string
              priority:
                type: integer
              dev_rank:
                type: string
              start_month:
                type: string
                example: "2025-01"
              end_month:
                type: string
                example: "2025-12"
              milestones:
                type: array
                items:
                  type: object
              dev_complete_months:
                type: array
                items:
                  type: object
    responses:
      201:
        description: Theme created
      400:
        description: name is required
    """
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'name is required'}), 400
    max_sort_order = db.session.query(func.max(Theme.sort_order)).scalar()
    theme = Theme(
        name=data['name'],
        category=data.get('category', ''),
        status=data.get('status', 'planning'),
        plan_certainty=_normalize_plan_certainty(data.get('plan_certainty')),
        color=data.get('color', '#6366f1'),
        priority=data.get('priority', 0),
        sort_order=(max_sort_order or 0) + 1,
        dev_rank=_normalize_dev_rank(data.get('dev_rank')),
        start_month=data.get('start_month'),
        end_month=data.get('end_month'),
    )
    _set_dev_complete_months(theme, _normalize_dev_complete_months(data))
    _replace_theme_milestones(theme, _normalize_milestones(data))
    db.session.add(theme)
    db.session.commit()
    return jsonify(theme.to_dict()), 201


@themes_bp.route('/reorder', methods=['PUT'])
@login_required
def reorder_themes():
    """
    Reorder themes
    ---
    tags:
      - Themes
    requestBody:
      content:
        application/json:
          schema:
            type: object
            required:
              - ordered_ids
            properties:
              ordered_ids:
                type: array
                items:
                  type: integer
    responses:
      200:
        description: Themes reordered
      400:
        description: Invalid input
    """
    data = request.get_json() or {}
    ordered_ids = data.get('ordered_ids')
    if not isinstance(ordered_ids, list) or not ordered_ids:
        return jsonify({'error': 'ordered_ids must be a non-empty list'}), 400

    themes_by_id = {theme.theme_id: theme for theme in Theme.query.all()}
    seen = set()
    position = 0
    for raw_id in ordered_ids:
        try:
            theme_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        theme = themes_by_id.get(theme_id)
        if theme is None or theme_id in seen:
            continue
        theme.sort_order = position
        seen.add(theme_id)
        position += 1

    # Keep any themes not present in the payload after the reordered ones,
    # preserving their previous relative order.
    remaining = sorted(
        (theme for tid, theme in themes_by_id.items() if tid not in seen),
        key=lambda t: (t.sort_order, t.theme_id),
    )
    for theme in remaining:
        theme.sort_order = position
        position += 1

    db.session.commit()
    return jsonify({'message': 'Reordered', 'count': len(seen)})


@themes_bp.route('/<int:theme_id>', methods=['PUT'])
@login_required
def update_theme(theme_id):
    """
    Update a theme
    ---
    tags:
      - Themes
    parameters:
      - in: path
        name: theme_id
        required: true
        schema:
          type: integer
    requestBody:
      content:
        application/json:
          schema:
            type: object
            properties:
              name:
                type: string
              category:
                type: string
              status:
                type: string
              plan_certainty:
                type: string
                enum: [tentative, confirmed]
              color:
                type: string
              priority:
                type: integer
              dev_rank:
                type: string
              start_month:
                type: string
              end_month:
                type: string
              milestones:
                type: array
                items:
                  type: object
              dev_complete_months:
                type: array
                items:
                  type: object
              member_ids:
                type: array
                items:
                  type: integer
    responses:
      200:
        description: Updated theme
      404:
        description: Not found
    """
    theme = db.session.get(Theme, theme_id)
    if not theme:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json()
    for field in ('name', 'category', 'status', 'plan_certainty', 'color', 'priority', 'dev_rank', 'start_month', 'end_month'):
        if field in data:
            if field == 'dev_rank':
                setattr(theme, field, _normalize_dev_rank(data[field]))
            elif field == 'plan_certainty':
                setattr(theme, field, _normalize_plan_certainty(data[field]))
            else:
                setattr(theme, field, data[field])

    if 'dev_complete_months' in data or 'dev_complete_month' in data:
        _set_dev_complete_months(theme, _normalize_dev_complete_months(data))

    if 'milestones' in data or 'milestone_month' in data or 'milestone_label' in data:
        _replace_theme_milestones(theme, _normalize_milestones(data))

    if 'member_ids' in data:
        theme.members = [db.session.get(Member, mid) for mid in data['member_ids'] if db.session.get(Member, mid)]

    db.session.commit()
    return jsonify(theme.to_dict())


@themes_bp.route('/<int:theme_id>', methods=['DELETE'])
@login_required
def delete_theme(theme_id):
    """
    Delete a theme
    ---
    tags:
      - Themes
    parameters:
      - in: path
        name: theme_id
        required: true
        schema:
          type: integer
    responses:
      200:
        description: Deleted
      404:
        description: Not found
    """
    theme = db.session.get(Theme, theme_id)
    if not theme:
        return jsonify({'error': 'Not found'}), 404
    db.session.delete(theme)
    db.session.commit()
    return jsonify({'message': 'Deleted'})


@themes_bp.route('/<int:theme_id>/members', methods=['POST'])
@login_required
def assign_member(theme_id):
    """
    Assign a single member to a theme
    ---
    tags:
      - Themes
    parameters:
      - in: path
        name: theme_id
        required: true
        schema:
          type: integer
    requestBody:
      content:
        application/json:
          schema:
            type: object
            required:
              - member_id
            properties:
              member_id:
                type: integer
    responses:
      200:
        description: Updated theme
      404:
        description: Theme or member not found
    """
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
    """
    Bulk assign members to a theme
    ---
    tags:
      - Themes
    parameters:
      - in: path
        name: theme_id
        required: true
        schema:
          type: integer
    requestBody:
      content:
        application/json:
          schema:
            type: object
            required:
              - member_ids
            properties:
              member_ids:
                type: array
                items:
                  type: integer
    responses:
      200:
        description: Number of members added and updated theme
      400:
        description: Invalid input
      404:
        description: Theme not found
    """
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
    """
    Unassign a member from a theme
    ---
    tags:
      - Themes
    parameters:
      - in: path
        name: theme_id
        required: true
        schema:
          type: integer
      - in: path
        name: member_id
        required: true
        schema:
          type: integer
    responses:
      200:
        description: Updated theme
      404:
        description: Theme or member not found
    """
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
