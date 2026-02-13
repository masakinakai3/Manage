"""CSV export endpoint for Gantt chart data."""

from flask import Blueprint, request, Response
from flask_login import login_required

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
