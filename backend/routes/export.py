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

@export_bp.route('/xlsx', methods=['POST'])
@login_required
def export_xlsx():
    import io
    from openpyxl import Workbook
    from openpyxl.styles import PatternFill, Font, Alignment
    from openpyxl.utils import get_column_letter
    
    data = request.get_json()
    if not data:
        return {'error': 'No data'}, 400
        
    headers = data.get('headers', [])
    rows = data.get('rows', [])
    filename = data.get('filename', 'gantt_export.xlsx')
    filename = re.sub(r'[^\w\-.]', '_', filename)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Gantt"
    
    header_fill = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    summary_fill = PatternFill(start_color="DCE6F1", end_color="DCE6F1", fill_type="solid")
    
    rate_low = PatternFill(start_color="F2F2F2", end_color="F2F2F2", fill_type="solid")
    rate_mid = PatternFill(start_color="E0E0FF", end_color="E0E0FF", fill_type="solid")
    rate_high = PatternFill(start_color="B3B3FF", end_color="B3B3FF", fill_type="solid")
    rate_full = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
    rate_over = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
    
    ws.append(headers)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        
    for r_idx, row_data in enumerate(rows, start=2):
        ws.append(row_data)
        is_summary = row_data[1] == "合算"
        
        for c_idx, val in enumerate(row_data, start=1):
            cell = ws.cell(row=r_idx, column=c_idx)
            if is_summary and c_idx <= 3:
                cell.fill = summary_fill
                cell.font = Font(bold=True)
                
            if c_idx > 3 and val and str(val).endswith('%'):
                rate = int(str(val).replace('%', ''))
                if rate > 100:
                    cell.fill = rate_over
                elif rate == 100:
                    cell.fill = rate_full
                elif rate > 60:
                    cell.fill = rate_high
                elif rate > 30:
                    cell.fill = rate_mid
                else:
                    cell.fill = rate_low
                cell.alignment = Alignment(horizontal="center")
                cell.value = rate / 100
                cell.number_format = '0%'

    ws.column_dimensions['A'].width = 30
    ws.column_dimensions['B'].width = 20
    ws.column_dimensions['C'].width = 15
    for i in range(4, len(headers) + 1):
        ws.column_dimensions[get_column_letter(i)].width = 12
        
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    return Response(
        output.read(),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"'
        }
    )

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
