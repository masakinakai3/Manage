#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

"""CSV and JSON export endpoints."""

import re
from flask import Blueprint, request, Response, jsonify
from flask_login import login_required
from models import db, Theme, Member, Allocation

export_bp = Blueprint('export', __name__)


@export_bp.route('/csv', methods=['POST'])
@login_required
def export_csv():
    """Receive CSV content from frontend and return as downloadable file.

    Accepts both JSON and form-encoded data:
    - JSON: { "content": "csv string...", "filename": "gantt_export_202602.csv" }
    - Form: content=csv_string&filename=gantt_export_202602.csv
    Returns the content as a downloadable CSV file with proper Content-Disposition.
    """
    # Handle both JSON and form data
    if request.is_json:
        data = request.get_json()
        csv_content = data.get('content', '')
        filename = data.get('filename', 'gantt_export.csv')
    else:
        csv_content = request.form.get('content', '')
        filename = request.form.get('filename', 'gantt_export.csv')

    # Sanitize filename to prevent header injection (remove newlines and unsafe chars)
    filename = re.sub(r'[^\w\-.]', '_', filename)

    if not csv_content:
        return {'error': 'No CSV content provided'}, 400

    # Add BOM for Excel compatibility
    bom = '\ufeff'
    full_content = bom + csv_content

    response = Response(
        full_content,
        mimetype='text/csv; charset=utf-8',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Type': 'text/csv; charset=utf-8',
        }
    )
    return response


@export_bp.route('/json', methods=['GET'])
@login_required
def export_json():
    """Export all application data (themes, members, allocations) as JSON."""
    # Themes with their member associations
    themes = []
    for t in Theme.query.order_by(Theme.theme_id).all():
        td = t.to_dict()
        themes.append(td)

    # Members
    members = [m.to_dict() for m in Member.query.order_by(Member.member_id).all()]

    # Allocations
    allocations = [a.to_dict() for a in Allocation.query.all()]

    # Theme-member assignment table (many-to-many)
    theme_members = []
    for t in Theme.query.all():
        for m in t.members:
            theme_members.append({'theme_id': t.theme_id, 'member_id': m.member_id})

    payload = {
        'version': 1,
        'exported_at': db.session.execute(
            db.select(db.func.datetime('now'))
        ).scalar(),
        'themes': themes,
        'members': members,
        'allocations': allocations,
        'theme_members': theme_members,
    }

    import json
    from datetime import date
    filename = f'manage_backup_{date.today().strftime("%Y%m%d")}.json'
    response = Response(
        json.dumps(payload, ensure_ascii=False, indent=2),
        mimetype='application/json; charset=utf-8',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
        }
    )
    return response
