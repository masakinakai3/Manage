#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

"""CSV, XLSX, and JSON export endpoints."""

import io
import json
import re
from datetime import date

from flask import Blueprint, Response, request
from flask_login import login_required
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from models import Allocation, Member, Theme, db

export_bp = Blueprint('export', __name__)


@export_bp.route('/csv', methods=['POST'])
@login_required
def export_csv():
    """Return client-generated CSV as a downloadable file."""
    if request.is_json:
        data = request.get_json()
        csv_content = data.get('content', '')
        filename = data.get('filename', 'gantt_export.csv')
    else:
        csv_content = request.form.get('content', '')
        filename = request.form.get('filename', 'gantt_export.csv')

    filename = re.sub(r'[^\w\-.]', '_', filename)
    if not csv_content:
        return {'error': 'No CSV content provided'}, 400

    response = Response(
        '\ufeff' + csv_content,
        mimetype='text/csv; charset=utf-8',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Type': 'text/csv; charset=utf-8',
        },
    )
    return response


@export_bp.route('/xlsx', methods=['POST'])
@login_required
def export_xlsx():
    """Export gantt rows as an XLSX file."""
    data = request.get_json()
    if not data:
        return {'error': 'No data'}, 400

    headers = data.get('headers', [])
    rows = data.get('rows', [])
    filename = re.sub(r'[^\w\-.]', '_', data.get('filename', 'gantt_export.xlsx'))

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = 'Gantt'

    header_fill = PatternFill(start_color='1F497D', end_color='1F497D', fill_type='solid')
    header_font = Font(color='FFFFFF', bold=True)
    summary_fill = PatternFill(start_color='DCE6F1', end_color='DCE6F1', fill_type='solid')

    rate_low = PatternFill(start_color='F2F2F2', end_color='F2F2F2', fill_type='solid')
    rate_mid = PatternFill(start_color='E0E0FF', end_color='E0E0FF', fill_type='solid')
    rate_high = PatternFill(start_color='B3B3FF', end_color='B3B3FF', fill_type='solid')
    rate_full = PatternFill(start_color='C6EFCE', end_color='C6EFCE', fill_type='solid')
    rate_over = PatternFill(start_color='FFC7CE', end_color='FFC7CE', fill_type='solid')

    worksheet.append(headers)
    for cell in worksheet[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center', vertical='center')

    for row_index, row_data in enumerate(rows, start=2):
        worksheet.append(row_data)
        is_summary = len(row_data) > 1 and row_data[1] == '合算'

        for column_index, value in enumerate(row_data, start=1):
            cell = worksheet.cell(row=row_index, column=column_index)
            if is_summary and column_index <= 3:
                cell.fill = summary_fill
                cell.font = Font(bold=True)

            if column_index > 3 and value and str(value).endswith('%'):
                rate = int(str(value).replace('%', ''))
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

                cell.alignment = Alignment(horizontal='center')
                cell.value = rate / 100
                cell.number_format = '0%'

    worksheet.column_dimensions['A'].width = 30
    worksheet.column_dimensions['B'].width = 20
    worksheet.column_dimensions['C'].width = 15
    for index in range(4, len(headers) + 1):
        worksheet.column_dimensions[get_column_letter(index)].width = 12

    output = io.BytesIO()
    workbook.save(output)
    output.seek(0)

    return Response(
        output.read(),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@export_bp.route('/json', methods=['GET'])
@login_required
def export_json():
    """Export all application data as JSON."""
    themes = [theme.to_dict() for theme in Theme.query.order_by(Theme.theme_id).all()]
    members = [member.to_dict() for member in Member.query.order_by(Member.member_id).all()]
    allocations = [allocation.to_dict() for allocation in Allocation.query.all()]

    theme_members = []
    for theme in Theme.query.all():
        for member in theme.members:
            theme_members.append({'theme_id': theme.theme_id, 'member_id': member.member_id})

    payload = {
        'version': 1,
        'exported_at': db.session.execute(db.select(db.func.datetime('now'))).scalar(),
        'themes': themes,
        'members': members,
        'allocations': allocations,
        'theme_members': theme_members,
    }

    filename = f'manage_backup_{date.today().strftime("%Y%m%d")}.json'
    return Response(
        json.dumps(payload, ensure_ascii=False, indent=2),
        mimetype='application/json; charset=utf-8',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )
