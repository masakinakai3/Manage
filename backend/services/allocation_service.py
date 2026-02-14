"""Allocation service: load calculation, warning detection."""

from collections import defaultdict
#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

from models import db, Allocation, Member, Theme
from sqlalchemy import func


def get_theme_loads(from_month=None, to_month=None):
    """
    Get monthly load per theme (sum of all member allocation_rates).
    Returns: { theme_id: { month: total_rate, ... }, ... }
    """
    query = db.session.query(
        Allocation.theme_id,
        Allocation.month,
        func.sum(Allocation.allocation_rate).label('total')
    ).filter(Allocation.allocation_rate > 0).group_by(
        Allocation.theme_id, Allocation.month
    )

    if from_month:
        query = query.filter(Allocation.month >= from_month)
    if to_month:
        query = query.filter(Allocation.month <= to_month)

    result = defaultdict(dict)
    for theme_id, month, total in query.all():
        result[theme_id][month] = total

    return dict(result)


def get_member_loads(from_month=None, to_month=None):
    """
    Get monthly load per member (sum of all theme allocation_rates).
    Returns: { member_id: { month: total_rate, ... }, ... }
    """
    query = db.session.query(
        Allocation.member_id,
        Allocation.month,
        func.sum(Allocation.allocation_rate).label('total')
    ).filter(Allocation.allocation_rate > 0).group_by(
        Allocation.member_id, Allocation.month
    )

    if from_month:
        query = query.filter(Allocation.month >= from_month)
    if to_month:
        query = query.filter(Allocation.month <= to_month)

    result = defaultdict(dict)
    for member_id, month, total in query.all():
        result[member_id][month] = total

    return dict(result)


def get_warnings(from_month=None, to_month=None):
    """
    Get overload warnings: members whose monthly load exceeds capacity.
    Returns list of { member_id, display_name, month, load, capacity, excess }
    """
    member_loads = get_member_loads(from_month, to_month)
    members = {m.member_id: m for m in Member.query.filter_by(is_active=True).all()}

    warnings = []
    for member_id, months in member_loads.items():
        member = members.get(member_id)
        if not member:
            continue
        for month, load in months.items():
            if load > member.capacity:
                warnings.append({
                    'member_id': member_id,
                    'display_name': member.display_name,
                    'month': month,
                    'load': load,
                    'capacity': member.capacity,
                    'excess': load - member.capacity,
                })

    warnings.sort(key=lambda w: (w['month'], w['member_id']))
    return warnings
