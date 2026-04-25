#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

"""JSON import endpoint — restores all application data from a backup file."""

import json
from flask import Blueprint, request, jsonify
from models import db, Theme, ThemeMilestone, Member, Allocation, theme_members as theme_members_table
from authz import admin_required
from routes.themes import _normalize_dev_rank

import_data_bp = Blueprint('import_data', __name__)


@import_data_bp.route('/json', methods=['POST'])
@admin_required
def import_json():
    """
    Import JSON backup
    ---
    tags:
      - Import
    requestBody:
      content:
        multipart/form-data:
          schema:
            type: object
            required:
              - file
            properties:
              file:
                type: string
                format: binary
                description: JSON backup file exported from /api/export/json
    responses:
      200:
        description: Import successful with counts of restored records
      400:
        description: Invalid file or missing required keys
      500:
        description: Import failed (transaction rolled back)
    """
    file = request.files.get('file')
    if not file:
        return jsonify({'error': 'No file uploaded'}), 400

    try:
        raw = file.read().decode('utf-8-sig')  # strip BOM if present
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        return jsonify({'error': f'Invalid JSON file: {e}'}), 400

    # Basic schema validation
    required_keys = {'themes', 'members', 'allocations', 'theme_members'}
    if not required_keys.issubset(data.keys()):
        missing = required_keys - data.keys()
        return jsonify({'error': f'Missing required keys: {missing}'}), 400

    try:
        # --- Delete existing data inside a transaction ---
        db.session.execute(theme_members_table.delete())
        Allocation.query.delete()
        ThemeMilestone.query.delete()
        Theme.query.delete()
        Member.query.delete()

        # --- Re-create members, track old_id -> new Member object ---
        member_map = {}  # old member_id -> new Member
        for m in data['members']:
            new_member = Member(
                display_name=m['display_name'],
                department=m.get('department', ''),
                capacity=m.get('capacity', 100),
                is_active=m.get('is_active', True),
            )
            db.session.add(new_member)
            db.session.flush()  # get new PK
            member_map[m['member_id']] = new_member

        # --- Re-create themes, track old_id -> new Theme object ---
        theme_map = {}  # old theme_id -> new Theme
        for t in data['themes']:
            new_theme = Theme(
                name=t['name'],
                category=t.get('category', ''),
                status=t.get('status', 'planning'),
                color=t.get('color', '#6366f1'),
                priority=t.get('priority', 0),
                dev_rank=_normalize_dev_rank(t.get('dev_rank')),
                start_month=t.get('start_month'),
                end_month=t.get('end_month'),
                milestone_month=t.get('milestone_month'),
                milestone_label=t.get('milestone_label'),
            )
            dev_complete_months = t.get('dev_complete_months')
            if dev_complete_months is None:
                dev_complete_months = [t.get('dev_complete_month')] if t.get('dev_complete_month') else []
            elif isinstance(dev_complete_months, str):
                dev_complete_months = [dev_complete_months]
            normalized_dev_complete_months = []
            seen_dev_complete_months = set()
            for raw_month in dev_complete_months or []:
                if isinstance(raw_month, dict):
                    month = str(raw_month.get('month') or '').strip()
                    is_completed = bool(raw_month.get('is_completed', False))
                else:
                    month = str(raw_month or '').strip()
                    is_completed = False
                if month and month not in seen_dev_complete_months:
                    normalized_dev_complete_months.append({'month': month, 'is_completed': is_completed})
                    seen_dev_complete_months.add(month)
            new_theme.dev_complete_month = normalized_dev_complete_months[0]['month'] if normalized_dev_complete_months else None
            new_theme.dev_complete_months = json.dumps(normalized_dev_complete_months, ensure_ascii=False) if normalized_dev_complete_months else None
            db.session.add(new_theme)
            db.session.flush()
            theme_map[t['theme_id']] = new_theme

            # Restore milestones from the milestones array (v2+ format)
            for idx, ms in enumerate(t.get('milestones') or []):
                month = (ms.get('month') or '').strip()
                if not month:
                    continue
                new_theme.milestones.append(ThemeMilestone(
                    month=month,
                    label=(ms.get('label') or '').strip() or None,
                    position=ms.get('position', idx),
                    is_completed=ms.get('is_completed', False),
                ))

        # --- Re-create theme-member associations ---
        for tm in data['theme_members']:
            old_tid = tm.get('theme_id')
            old_mid = tm.get('member_id')
            new_theme = theme_map.get(old_tid)
            new_member = member_map.get(old_mid)
            if new_theme and new_member and new_member not in new_theme.members:
                new_theme.members.append(new_member)

        # --- Re-create allocations ---
        for a in data['allocations']:
            old_tid = a.get('theme_id')
            old_mid = a.get('member_id')
            new_theme = theme_map.get(old_tid)
            new_member = member_map.get(old_mid)
            if not new_theme or not new_member:
                continue  # skip orphaned allocations
            alloc = Allocation(
                theme_id=new_theme.theme_id,
                member_id=new_member.member_id,
                month=a['month'],
                allocation_rate=a.get('allocation_rate', 0),
                memo=a.get('memo', ''),
            )
            db.session.add(alloc)

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Import failed: {e}'}), 500

    return jsonify({
        'message': 'Import successful',
        'themes': len(theme_map),
        'members': len(member_map),
        'allocations': len(data['allocations']),
    })
