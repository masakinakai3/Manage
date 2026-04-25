#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

"""Saved view API endpoints."""

import json

from flask import Blueprint, jsonify, request
from flask_login import login_required

from models import SavedView, db

saved_views_bp = Blueprint('saved_views', __name__)


@saved_views_bp.route('', methods=['GET'])
@login_required
def list_saved_views():
    """
    List saved views
    ---
    tags:
      - Saved Views
    responses:
      200:
        description: List of saved views
    """
    views = SavedView.query.order_by(SavedView.name.asc()).all()
    return jsonify([view.to_dict() for view in views])


@saved_views_bp.route('', methods=['POST'])
@login_required
def create_or_update_saved_view():
    """
    Create or update a saved view
    ---
    tags:
      - Saved Views
    requestBody:
      content:
        application/json:
          schema:
            type: object
            required:
              - id
              - name
            properties:
              id:
                type: string
              name:
                type: string
              view:
                type: string
                default: gantt
              state:
                type: object
    responses:
      201:
        description: Saved view created or updated
      400:
        description: Invalid input
    """
    payload = request.get_json() or {}
    if not payload.get('id') or not payload.get('name'):
        return {'error': 'id and name are required'}, 400

    state = payload.get('state', {})
    if not isinstance(state, dict):
        return {'error': 'state must be an object'}, 400

    saved_view = db.session.get(SavedView, payload['id'])
    if saved_view is None:
        saved_view = SavedView(id=payload['id'])
        db.session.add(saved_view)

    saved_view.name = payload['name']
    saved_view.view = payload.get('view', 'gantt')
    saved_view.state = json.dumps(state, ensure_ascii=False)
    db.session.commit()
    return jsonify(saved_view.to_dict()), 201


@saved_views_bp.route('/<string:view_id>', methods=['DELETE'])
@login_required
def delete_saved_view(view_id):
    """
    Delete a saved view
    ---
    tags:
      - Saved Views
    parameters:
      - in: path
        name: view_id
        required: true
        schema:
          type: string
    responses:
      204:
        description: Deleted
      404:
        description: Not found
    """
    saved_view = db.session.get(SavedView, view_id)
    if not saved_view:
        return {'error': 'Saved view not found'}, 404

    db.session.delete(saved_view)
    db.session.commit()
    return '', 204
