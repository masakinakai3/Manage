"""Insights routes for dashboard, health checks, and recommendations."""

from collections import defaultdict

from flask import Blueprint, jsonify, request
from flask_login import login_required

from models import Allocation, Member, Theme
from services.allocation_service import get_member_loads, get_warnings

insights_bp = Blueprint("insights", __name__)


def _collect_context(from_month=None, to_month=None):
    themes = Theme.query.order_by(Theme.theme_id).all()
    members = Member.query.order_by(Member.member_id).all()
    query = Allocation.query.filter(Allocation.allocation_rate > 0)
    if from_month:
        query = query.filter(Allocation.month >= from_month)
    if to_month:
        query = query.filter(Allocation.month <= to_month)
    allocations = query.order_by(Allocation.month, Allocation.theme_id, Allocation.member_id).all()
    return themes, members, allocations


def _month_sort_key(month_value):
    return month_value or ""


def _month_range(start_month, end_month):
    if not start_month or not end_month:
        return []

    start_year, start_mon = map(int, start_month.split("-"))
    end_year, end_mon = map(int, end_month.split("-"))
    cursor_year, cursor_mon = start_year, start_mon
    months = []

    while (cursor_year, cursor_mon) <= (end_year, end_mon):
        months.append(f"{cursor_year}-{cursor_mon:02d}")
        cursor_mon += 1
        if cursor_mon > 12:
            cursor_year += 1
            cursor_mon = 1

    return months


def _build_health_checks(themes, members, allocations):
    issues = []
    allocations_by_theme = defaultdict(list)
    allocations_by_member_month = defaultdict(list)

    for allocation in allocations:
        allocations_by_theme[allocation.theme_id].append(allocation)
        allocations_by_member_month[(allocation.member_id, allocation.month)].append(allocation)

    for theme in themes:
        assigned_ids = {member.member_id for member in theme.members}
        has_allocations = bool(allocations_by_theme.get(theme.theme_id))
        if not assigned_ids and not has_allocations:
            issues.append({
                "code": "unassigned_theme",
                "severity": "high",
                "entity_type": "theme",
                "entity_id": theme.theme_id,
                "entity_name": theme.name,
                "message": "メンバーの割り当ても配分も設定されていません。",
            })

        if theme.start_month and theme.end_month and theme.start_month > theme.end_month:
            issues.append({
                "code": "period_inconsistency",
                "severity": "high",
                "entity_type": "theme",
                "entity_id": theme.theme_id,
                "entity_name": theme.name,
                "message": f"テーマ期間が逆転しています: {theme.start_month} から {theme.end_month}",
            })

        for allocation in allocations_by_theme.get(theme.theme_id, []):
            if theme.start_month and allocation.month < theme.start_month:
                issues.append({
                    "code": "allocation_before_theme_start",
                    "severity": "medium",
                    "entity_type": "allocation",
                    "entity_id": allocation.id,
                    "entity_name": theme.name,
                    "message": f"テーマ開始月より前に配分があります ({allocation.month} < {theme.start_month})。",
                })
            if theme.end_month and allocation.month > theme.end_month:
                issues.append({
                    "code": "allocation_after_theme_end",
                    "severity": "medium",
                    "entity_type": "allocation",
                    "entity_id": allocation.id,
                    "entity_name": theme.name,
                    "message": f"テーマ終了月より後に配分があります ({allocation.month} > {theme.end_month})。",
                })
            if theme.status in {"completed", "cancelled"} and theme.end_month and allocation.month >= theme.end_month:
                issues.append({
                    "code": "closed_theme_with_remaining_allocation",
                    "severity": "high",
                    "entity_type": "allocation",
                    "entity_id": allocation.id,
                    "entity_name": theme.name,
                    "message": "終了済みテーマに終了月以降の配分が残っています。",
                })

    duplicate_theme_names = defaultdict(list)
    for theme in themes:
        duplicate_theme_names[theme.name.strip().lower()].append(theme)
    for key, dupes in duplicate_theme_names.items():
        if key and len(dupes) > 1:
            issues.append({
                "code": "duplicate_theme_name",
                "severity": "low",
                "entity_type": "theme",
                "entity_id": dupes[0].theme_id,
                "entity_name": dupes[0].name,
                "message": f"同名テーマが {len(dupes)} 件あります。",
            })

    duplicate_member_names = defaultdict(list)
    for member in members:
        duplicate_member_names[member.display_name.strip().lower()].append(member)
    for key, dupes in duplicate_member_names.items():
        if key and len(dupes) > 1:
            issues.append({
                "code": "duplicate_member_name",
                "severity": "low",
                "entity_type": "member",
                "entity_id": dupes[0].member_id,
                "entity_name": dupes[0].display_name,
                "message": f"同名メンバーが {len(dupes)} 件あります。",
            })

    for (member_id, month), rows in allocations_by_member_month.items():
        non_zero_rows = [row for row in rows if row.allocation_rate > 0]
        if len(non_zero_rows) > 6:
            member = next((item for item in members if item.member_id == member_id), None)
            issues.append({
                "code": "too_many_parallel_allocations",
                "severity": "medium",
                "entity_type": "member",
                "entity_id": member_id,
                "entity_name": member.display_name if member else str(member_id),
                "message": f"{month} に {len(non_zero_rows)} 件の並行配分があります。",
            })

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda item: (severity_rank.get(item["severity"], 9), item["code"], item["entity_name"]))
    return issues


def _build_dashboard(themes, members, allocations, from_month=None, to_month=None):
    month_totals = defaultdict(int)
    month_theme_counts = defaultdict(set)
    dept_totals = defaultdict(int)
    dept_counts = defaultdict(int)
    category_counts = defaultdict(int)
    status_counts = defaultdict(int)
    theme_catalog = {
        theme.theme_id: {
            "theme_id": theme.theme_id,
            "name": theme.name,
            "color": theme.color or "#6366f1",
            "status": theme.status,
        }
        for theme in themes
    }
    ribbon_month_projects = defaultdict(list)

    for theme in themes:
        category_counts[theme.category or "Uncategorized"] += 1
        status_counts[theme.status or "unknown"] += 1

    member_loads = get_member_loads(from_month, to_month)
    for member in members:
        dept = member.department or "Unassigned"
        loads = list((member_loads.get(member.member_id) or {}).values())
        average = round(sum(loads) / len(loads)) if loads else 0
        dept_totals[dept] += average
        dept_counts[dept] += 1

    for allocation in allocations:
        month_totals[allocation.month] += allocation.allocation_rate
        month_theme_counts[allocation.month].add(allocation.theme_id)
        theme_meta = theme_catalog.get(allocation.theme_id)
        if theme_meta and allocation.allocation_rate > 0:
            ribbon_month_projects[allocation.month].append({
                **theme_meta,
                "load": allocation.allocation_rate,
            })

    if from_month and to_month:
        dashboard_months = _month_range(from_month, to_month)
    else:
        dashboard_months = sorted(month_totals.keys(), key=_month_sort_key)

    monthly_trend = [
        {
            "month": month,
            "total_allocation": month_totals[month],
            "active_theme_count": len(month_theme_counts[month]),
        }
        for month in dashboard_months
    ]

    department_load = [
        {
            "department": department,
            "average_load": round(dept_totals[department] / dept_counts[department]) if dept_counts[department] else 0,
            "member_count": dept_counts[department],
        }
        for department in sorted(dept_totals.keys())
    ]

    top_themes = []
    for theme in themes:
        total = sum(item.allocation_rate for item in allocations if item.theme_id == theme.theme_id)
        top_themes.append({
            "theme_id": theme.theme_id,
            "name": theme.name,
            "status": theme.status,
            "category": theme.category or "Uncategorized",
            "total_allocation": total,
        })
    top_themes.sort(key=lambda item: item["total_allocation"], reverse=True)

    project_ribbon = []
    for month in dashboard_months:
        projects = sorted(
            ribbon_month_projects.get(month, []),
            key=lambda item: (-item["load"], item["name"].lower(), item["theme_id"]),
        )
        project_ribbon.append({
            "month": month,
            "total_load": month_totals[month],
            "projects": projects,
        })

    return {
        "monthly_trend": monthly_trend,
        "department_load": department_load,
        "category_distribution": [{"label": key, "count": value} for key, value in sorted(category_counts.items())],
        "status_distribution": [{"label": key, "count": value} for key, value in sorted(status_counts.items())],
        "top_themes": top_themes[:5],
        "project_ribbon": {
            "months": dashboard_months,
            "max_total_load": max(month_totals.values(), default=0),
            "items": project_ribbon,
        },
    }


def _build_recommendations(themes, members, allocations, from_month=None, to_month=None):
    warnings = get_warnings(from_month, to_month)
    member_loads = get_member_loads(from_month, to_month)
    member_by_id = {member.member_id: member for member in members if member.is_active}
    theme_by_id = {theme.theme_id: theme for theme in themes}
    recommendations = []
    seen = set()

    for warning in warnings:
        member_id = warning["member_id"]
        month = warning["month"]
        overload_key = (member_id, month)
        if overload_key in seen:
            continue
        seen.add(overload_key)

        overloaded_member = member_by_id.get(member_id)
        if not overloaded_member:
            continue

        related_allocations = [
            allocation for allocation in allocations
            if allocation.member_id == member_id and allocation.month == month and allocation.allocation_rate > 0
        ]
        if not related_allocations:
            continue

        theme_candidates = []
        for allocation in sorted(related_allocations, key=lambda row: row.allocation_rate, reverse=True):
            theme = theme_by_id.get(allocation.theme_id)
            if not theme:
                continue

            candidate_members = []
            for member in member_by_id.values():
                if member.member_id == member_id:
                    continue
                current_load = (member_loads.get(member.member_id) or {}).get(month, 0)
                spare = member.capacity - current_load
                if spare <= 0:
                    continue
                score = spare
                if overloaded_member.department and member.department == overloaded_member.department:
                    score += 20
                candidate_members.append({
                    "member_id": member.member_id,
                    "display_name": member.display_name,
                    "department": member.department or "",
                    "capacity": member.capacity,
                    "current_load": current_load,
                    "spare_capacity": spare,
                    "score": score,
                })

            candidate_members.sort(key=lambda item: (-item["score"], item["current_load"], item["display_name"]))
            theme_candidates.append({
                "theme_id": theme.theme_id,
                "theme_name": theme.name,
                "suggested_shift": min(allocation.allocation_rate, warning["excess"]),
                "candidate_members": candidate_members[:3],
            })

        recommendations.append({
            "member_id": overloaded_member.member_id,
            "display_name": overloaded_member.display_name,
            "department": overloaded_member.department or "",
            "month": month,
            "load": warning["load"],
            "capacity": warning["capacity"],
            "excess": warning["excess"],
            "themes": theme_candidates[:3],
        })

    return recommendations


@insights_bp.route("/overview", methods=["GET"])
@login_required
def overview():
    """Return dashboard metrics, health checks, and staffing recommendations."""
    from_month = request.args.get("from")
    to_month = request.args.get("to")
    themes, members, allocations = _collect_context(from_month, to_month)
    health_checks = _build_health_checks(themes, members, allocations)
    dashboard = _build_dashboard(themes, members, allocations, from_month, to_month)
    recommendations = _build_recommendations(themes, members, allocations, from_month, to_month)
    member_loads = get_member_loads(from_month, to_month)
    assigned_member_count = len({allocation.member_id for allocation in allocations})
    average_member_load = 0
    if members:
        total_average = 0
        for member in members:
            loads = list((member_loads.get(member.member_id) or {}).values())
            total_average += round(sum(loads) / len(loads)) if loads else 0
        average_member_load = round(total_average / len(members))

    return jsonify({
        "summary": {
            "theme_count": len(themes),
            "member_count": len(members),
            "allocation_count": len(allocations),
            "health_issue_count": len(health_checks),
            "recommendation_count": len(recommendations),
            "active_theme_count": len([theme for theme in themes if theme.status == "active"]),
            "warning_cell_count": len(get_warnings(from_month, to_month)),
            "assigned_member_count": assigned_member_count,
            "average_member_load": average_member_load,
            "overloaded_member_count": len({item["member_id"] for item in get_warnings(from_month, to_month)}),
        },
        "health_checks": health_checks,
        "dashboard": dashboard,
        "recommendations": recommendations,
    })
