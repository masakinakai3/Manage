"""Authorization helpers."""

from functools import wraps

from flask import jsonify
from flask_login import current_user


def admin_required(view_func):
    """Allow access only to authenticated admin users."""

    @wraps(view_func)
    def wrapped(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({'error': 'Authentication required'}), 401
        if current_user.role != 'admin':
            return jsonify({'error': 'Admin only'}), 403
        return view_func(*args, **kwargs)

    return wrapped
