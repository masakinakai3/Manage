#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

"""JSON import endpoint — restores all application data from a backup file."""

import json
from flask import Blueprint, request, jsonify
from flask_login import login_required
from models import db, Theme, Member, Allocation, theme_members as theme_members_table

import_data_bp = Blueprint('import_data', __name__)


@import_data_bp.route('/json', methods=['POST'])
@login_required
def import_json():
    """Replace all application data with the contents of an uploaded JSON backup.

    Expects a multipart/form-data request with a 'file' field containing a
    JSON file produced by the export endpoint.

    The import is performed inside a single transaction:
    1. Delete all allocations, theme-member associations, themes, and members.
    2. Re-create members (mapping old IDs to new DB-assigned IDs).
    3. Re-create themes (mapping old IDs to new DB-assigned IDs).
    4. Re-create theme-member associations.
    5. Re-create allocations.
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
                start_month=t.get('start_month'),
                end_month=t.get('end_month'),
            )
            db.session.add(new_theme)
            db.session.flush()
            theme_map[t['theme_id']] = new_theme

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
