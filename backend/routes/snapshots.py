#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

"""Snapshot API endpoints."""

import json
from flask import Blueprint, request, jsonify
from flask_login import login_required
from models import db, Snapshot

snapshots_bp = Blueprint('snapshots', __name__)

@snapshots_bp.route('', methods=['GET'])
@login_required
def list_snapshots():
    """List all snapshots."""
    snapshots = Snapshot.query.order_by(Snapshot.created_at.desc()).all()
    # Don't return the full data blob by default
    res = []
    for s in snapshots:
        res.append({
            'id': s.id,
            'name': s.name,
            'created_at': s.created_at.isoformat() if s.created_at else None
        })
    return jsonify(res)

@snapshots_bp.route('/<int:id>', methods=['GET'])
@login_required
def get_snapshot(id):
    """Get a specific snapshot including data."""
    s = db.session.get(Snapshot, id)
    if not s:
        return {'error': 'Snapshot not found'}, 404
    return jsonify(s.to_dict())

@snapshots_bp.route('', methods=['POST'])
@login_required
def create_snapshot():
    """Create a new snapshot."""
    req = request.get_json()
    if not req or 'name' not in req or 'data' not in req:
        return {'error': 'Invalid payload'}, 400
        
    s = Snapshot(
        name=req['name'],
        data=json.dumps(req['data'])
    )
    db.session.add(s)
    db.session.commit()
    
    return jsonify({'id': s.id, 'name': s.name}), 201

@snapshots_bp.route('/<int:id>', methods=['DELETE'])
@login_required
def delete_snapshot(id):
    """Delete a snapshot."""
    s = db.session.get(Snapshot, id)
    if not s:
        return {'error': 'Snapshot not found'}, 404
        
    db.session.delete(s)
    db.session.commit()
    return '', 204
