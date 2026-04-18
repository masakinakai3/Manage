"""Insights routes for dashboard, health checks, and recommendations."""

from collections import defaultdict

from flask import Blueprint, jsonify, request
from flask_login import login_required

from models import Allocation, Member, Theme
from services.allocation_service import get_member_loads, get_warnings

insights_bp = Blueprint("insights", __name__)

ISSUE_CATEGORY_LABELS = {
    "data_quality": "データ整合性リスク",
    "resource_operations": "配員運営リスク",
    "future_risk": "将来逼迫リスク",
}


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


def _bucket_allocations(allocations):
    allocations_by_theme = defaultdict(list)
    allocations_by_member_month = defaultdict(list)
    allocations_by_theme_month = defaultdict(list)

    for allocation in allocations:
        allocations_by_theme[allocation.theme_id].append(allocation)
        allocations_by_member_month[(allocation.member_id, allocation.month)].append(allocation)
        allocations_by_theme_month[(allocation.theme_id, allocation.month)].append(allocation)

    return allocations_by_theme, allocations_by_member_month, allocations_by_theme_month


def _member_maps(members):
    active_members = [member for member in members if member.is_active]
    member_by_id = {member.member_id: member for member in members}
    active_member_by_id = {member.member_id: member for member in active_members}
    return active_members, member_by_id, active_member_by_id


def _build_capacity_maps(members, months):
    total_capacity = sum(member.capacity for member in members if member.is_active)
    monthly_capacity = {month: total_capacity for month in months}
    department_capacity = defaultdict(dict)

    departments = sorted({(member.department or "未設定") for member in members if member.is_active})
    for department in departments:
        department_total = sum(
            member.capacity for member in members if member.is_active and (member.department or "未設定") == department
        )
        for month in months:
            department_capacity[department][month] = department_total

    return monthly_capacity, dict(department_capacity)


def _build_forecast(themes, members, allocations, months):
    active_members, member_by_id, _ = _member_maps(members)
    member_loads = get_member_loads(months[0], months[-1]) if months else {}
    warnings = get_warnings(months[0], months[-1]) if months else []
    warning_lookup = defaultdict(list)
    for warning in warnings:
        warning_lookup[warning["month"]].append(warning)

    monthly_capacity, department_capacity = _build_capacity_maps(active_members, months)
    month_demand = defaultdict(int)
    department_demand = defaultdict(lambda: defaultdict(int))
    theme_demand = defaultdict(lambda: defaultdict(int))

    for allocation in allocations:
        month_demand[allocation.month] += allocation.allocation_rate
        member = member_by_id.get(allocation.member_id)
        if member and member.is_active:
            department = member.department or "未設定"
            department_demand[department][allocation.month] += allocation.allocation_rate
        theme_demand[allocation.theme_id][allocation.month] += allocation.allocation_rate

    monthly_rows = []
    department_monthly = defaultdict(list)
    future_risks = []

    for month in months:
        demand = month_demand[month]
        capacity = monthly_capacity.get(month, 0)
        shortage = max(demand - capacity, 0)
        spare = max(capacity - demand, 0)
        overloaded_members = warning_lookup.get(month, [])
        monthly_rows.append({
            "month": month,
            "demand": demand,
            "capacity": capacity,
            "shortage": shortage,
            "spare": spare,
            "overloaded_member_count": len(overloaded_members),
        })

        if shortage > 0:
            future_risks.append({
                "code": "forecast_total_shortage",
                "severity": "high",
                "category": "future_risk",
                "entity_type": "month",
                "entity_id": month,
                "entity_name": month,
                "message": f"{month} は総需要 {demand}% に対して供給能力 {capacity}% で、{shortage}% 不足しています。",
            })

        for department, by_month in department_demand.items():
            dept_demand = by_month.get(month, 0)
            dept_capacity = department_capacity.get(department, {}).get(month, 0)
            dept_shortage = max(dept_demand - dept_capacity, 0)
            dept_spare = max(dept_capacity - dept_demand, 0)
            department_monthly[department].append({
                "month": month,
                "demand": dept_demand,
                "capacity": dept_capacity,
                "shortage": dept_shortage,
                "spare": dept_spare,
            })
            if dept_shortage > 0:
                future_risks.append({
                    "code": "forecast_department_shortage",
                    "severity": "medium",
                    "category": "future_risk",
                    "entity_type": "department",
                    "entity_id": department,
                    "entity_name": department,
                    "message": f"{month} の {department} は {dept_shortage}% 分の追加余力が必要です。",
                })

    return {
        "monthly": monthly_rows,
        "department_monthly": dict(department_monthly),
        "theme_monthly": dict(theme_demand),
        "warnings": warnings,
        "member_loads": member_loads,
        "future_risks": future_risks,
    }


def _build_health_checks(themes, members, allocations, forecast_context):
    issues = []
    allocations_by_theme, allocations_by_member_month, _ = _bucket_allocations(allocations)

    for theme in themes:
        assigned_ids = {member.member_id for member in theme.members}
        has_allocations = bool(allocations_by_theme.get(theme.theme_id))
        if not assigned_ids and not has_allocations:
            issues.append({
                "code": "unassigned_theme",
                "severity": "high",
                "category": "resource_operations",
                "entity_type": "theme",
                "entity_id": theme.theme_id,
                "entity_name": theme.name,
                "message": "担当メンバーと負荷がどちらも設定されていません。",
            })

        if theme.start_month and theme.end_month and theme.start_month > theme.end_month:
            issues.append({
                "code": "period_inconsistency",
                "severity": "high",
                "category": "data_quality",
                "entity_type": "theme",
                "entity_id": theme.theme_id,
                "entity_name": theme.name,
                "message": f"テーマ期間が逆転しています。{theme.start_month} から {theme.end_month}",
            })

        for allocation in allocations_by_theme.get(theme.theme_id, []):
            if theme.start_month and allocation.month < theme.start_month:
                issues.append({
                    "code": "allocation_before_theme_start",
                    "severity": "medium",
                    "category": "resource_operations",
                    "entity_type": "allocation",
                    "entity_id": allocation.id,
                    "entity_name": theme.name,
                    "message": f"開始前の {allocation.month} に配員があります。",
                })
            if theme.end_month and allocation.month > theme.end_month:
                issues.append({
                    "code": "allocation_after_theme_end",
                    "severity": "medium",
                    "category": "resource_operations",
                    "entity_type": "allocation",
                    "entity_id": allocation.id,
                    "entity_name": theme.name,
                    "message": f"終了後の {allocation.month} に配員があります。",
                })
            if theme.status in {"completed", "cancelled"} and theme.end_month and allocation.month >= theme.end_month:
                issues.append({
                    "code": "closed_theme_with_remaining_allocation",
                    "severity": "high",
                    "category": "resource_operations",
                    "entity_type": "allocation",
                    "entity_id": allocation.id,
                    "entity_name": theme.name,
                    "message": "完了または中止テーマに終了月以降の配員が残っています。",
                })

    duplicate_theme_names = defaultdict(list)
    for theme in themes:
        duplicate_theme_names[theme.name.strip().lower()].append(theme)
    for key, dupes in duplicate_theme_names.items():
        if key and len(dupes) > 1:
            issues.append({
                "code": "duplicate_theme_name",
                "severity": "low",
                "category": "data_quality",
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
                "category": "data_quality",
                "entity_type": "member",
                "entity_id": dupes[0].member_id,
                "entity_name": dupes[0].display_name,
                "message": f"同名メンバーが {len(dupes)} 件あります。",
            })

    member_by_id = {member.member_id: member for member in members}
    for (member_id, month), rows in allocations_by_member_month.items():
        non_zero_rows = [row for row in rows if row.allocation_rate > 0]
        if len(non_zero_rows) > 6:
            member = member_by_id.get(member_id)
            issues.append({
                "code": "too_many_parallel_allocations",
                "severity": "medium",
                "category": "resource_operations",
                "entity_type": "member",
                "entity_id": member_id,
                "entity_name": member.display_name if member else str(member_id),
                "message": f"{month} に並行アサインが {len(non_zero_rows)} 件あります。",
            })

    issues.extend(forecast_context["future_risks"])

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    issues.sort(
        key=lambda item: (
            severity_rank.get(item["severity"], 9),
            item.get("category", ""),
            item["code"],
            item["entity_name"],
        )
    )
    return issues


def _group_health_checks(issues):
    grouped = []
    for category in ("resource_operations", "future_risk", "data_quality"):
        items = [issue for issue in issues if issue.get("category") == category]
        grouped.append({
            "category": category,
            "label": ISSUE_CATEGORY_LABELS.get(category, category),
            "count": len(items),
            "high_count": len([item for item in items if item["severity"] == "high"]),
            "items": items[:5],
        })
    return grouped


def _build_gap_summary(themes, members, allocations, forecast_context):
    warnings = forecast_context["warnings"]
    monthly_forecast = forecast_context["monthly"]
    active_members, _, _ = _member_maps(members)
    member_loads = forecast_context["member_loads"]

    total_shortage = sum(item["excess"] for item in warnings)
    total_spare = 0
    underutilized_members = 0
    for member in active_members:
        loads = member_loads.get(member.member_id, {})
        max_load = max(loads.values(), default=0)
        if max_load <= max(30, round(member.capacity * 0.5)):
            underutilized_members += 1
        for month in [item["month"] for item in monthly_forecast]:
            load = loads.get(month, 0)
            total_spare += max(member.capacity - load, 0)

    bottleneck_departments = 0
    for _, rows in forecast_context["department_monthly"].items():
        if any(row["shortage"] > 0 for row in rows):
            bottleneck_departments += 1

    future_shortage_months = [item for item in monthly_forecast if item["shortage"] > 0]

    return {
        "theme_count": len(themes),
        "member_count": len(members),
        "allocation_count": len(allocations),
        "health_issue_count": 0,
        "recommendation_count": 0,
        "active_theme_count": len([theme for theme in themes if theme.status == "active"]),
        "warning_cell_count": len(warnings),
        "assigned_member_count": len({allocation.member_id for allocation in allocations}),
        "average_member_load": round(
            sum(
                round(sum(loads.values()) / len(loads)) if loads else 0
                for loads in (member_loads.get(member.member_id, {}) for member in members)
            ) / len(members)
        ) if members else 0,
        "overloaded_member_count": len({item["member_id"] for item in warnings}),
        "total_shortage": total_shortage,
        "total_spare": total_spare,
        "bottleneck_department_count": bottleneck_departments,
        "upcoming_shortage_months": len(future_shortage_months),
        "underutilized_member_count": underutilized_members,
    }


def _build_department_load(members, forecast_context):
    active_members, _, _ = _member_maps(members)
    member_loads = forecast_context["member_loads"]
    by_department = defaultdict(list)

    for member in active_members:
        department = member.department or "未設定"
        loads = list((member_loads.get(member.member_id) or {}).values())
        avg_load = round(sum(loads) / len(loads)) if loads else 0
        peak_load = max(loads, default=0)
        by_department[department].append({
            "member_id": member.member_id,
            "display_name": member.display_name,
            "capacity": member.capacity,
            "avg_load": avg_load,
            "peak_load": peak_load,
        })

    results = []
    for department in sorted(by_department.keys()):
        members_in_department = by_department[department]
        avg_loads = [item["avg_load"] for item in members_in_department]
        peak_loads = [item["peak_load"] for item in members_in_department]
        avg_department_load = round(sum(avg_loads) / len(avg_loads)) if avg_loads else 0
        peak_department_load = max(peak_loads, default=0)
        spread = peak_department_load - min(peak_loads, default=0)
        overloaded_count = len([item for item in members_in_department if item["peak_load"] > item["capacity"]])
        underutilized_count = len([
            item for item in members_in_department if item["peak_load"] <= max(30, round(item["capacity"] * 0.5))
        ])
        shortage_total = sum(row["shortage"] for row in forecast_context["department_monthly"].get(department, []))
        spare_total = sum(row["spare"] for row in forecast_context["department_monthly"].get(department, []))
        results.append({
            "department": department,
            "average_load": avg_department_load,
            "peak_load": peak_department_load,
            "spread": spread,
            "member_count": len(members_in_department),
            "overloaded_member_count": overloaded_count,
            "underutilized_member_count": underutilized_count,
            "shortage_total": shortage_total,
            "spare_total": spare_total,
        })

    return results


def _build_impact_themes(themes, members, allocations, forecast_context):
    active_members, member_by_id, _ = _member_maps(members)
    member_loads = forecast_context["member_loads"]
    theme_allocations = defaultdict(list)
    member_set_by_theme = defaultdict(set)

    for allocation in allocations:
        theme_allocations[allocation.theme_id].append(allocation)
        member_set_by_theme[allocation.theme_id].add(allocation.member_id)

    rows = []
    for theme in themes:
        theme_rows = theme_allocations.get(theme.theme_id, [])
        total_allocation = sum(row.allocation_rate for row in theme_rows)
        overload_contribution = 0
        active_months = sorted({row.month for row in theme_rows})
        for row in theme_rows:
            member = member_by_id.get(row.member_id)
            if not member or not member.is_active:
                continue
            month_load = (member_loads.get(row.member_id) or {}).get(row.month, 0)
            member_excess = max(month_load - member.capacity, 0)
            if month_load > 0 and member_excess > 0:
                overload_contribution += round((row.allocation_rate / month_load) * member_excess)

        member_count = len(member_set_by_theme.get(theme.theme_id, set()))
        concentration_risk = round(total_allocation / max(member_count, 1)) if total_allocation else 0
        deadline_risk = 0
        if theme.end_month:
            deadline_rows = [row for row in theme_rows if row.month >= theme.end_month]
            deadline_risk = sum(row.allocation_rate for row in deadline_rows)

        impact_score = overload_contribution * 4 + concentration_risk * 2 + deadline_risk
        rows.append({
            "theme_id": theme.theme_id,
            "name": theme.name,
            "status": theme.status,
            "total_allocation": total_allocation,
            "overload_contribution": overload_contribution,
            "member_count": member_count,
            "concentration_risk": concentration_risk,
            "deadline_risk": deadline_risk,
            "impact_score": impact_score,
            "last_active_month": active_months[-1] if active_months else "",
        })

    rows.sort(key=lambda item: (-item["impact_score"], -item["overload_contribution"], item["name"].lower()))
    return rows[:5]


def _build_dashboard(themes, members, allocations, from_month=None, to_month=None):
    month_totals = defaultdict(int)
    month_theme_counts = defaultdict(set)
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
        category_counts[theme.category or "未分類"] += 1
        status_counts[theme.status or "unknown"] += 1

    for allocation in allocations:
        month_totals[allocation.month] += allocation.allocation_rate
        month_theme_counts[allocation.month].add(allocation.theme_id)
        theme_meta = theme_catalog.get(allocation.theme_id)
        if theme_meta and allocation.allocation_rate > 0:
            ribbon_month_projects[allocation.month].append({
                **theme_meta,
                "load": allocation.allocation_rate,
            })

    dashboard_months = _month_range(from_month, to_month) if from_month and to_month else sorted(month_totals.keys(), key=_month_sort_key)
    forecast_context = _build_forecast(themes, members, allocations, dashboard_months)
    department_load = _build_department_load(members, forecast_context)
    impact_themes = _build_impact_themes(themes, members, allocations, forecast_context)

    monthly_trend = [
        {
            "month": month,
            "total_allocation": month_totals[month],
            "active_theme_count": len(month_theme_counts[month]),
            "shortage": next((item["shortage"] for item in forecast_context["monthly"] if item["month"] == month), 0),
            "spare": next((item["spare"] for item in forecast_context["monthly"] if item["month"] == month), 0),
        }
        for month in dashboard_months
    ]

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
        "forecast": forecast_context["monthly"],
        "department_load": department_load,
        "category_distribution": [{"label": key, "count": value} for key, value in sorted(category_counts.items())],
        "status_distribution": [{"label": key, "count": value} for key, value in sorted(status_counts.items())],
        "impact_themes": impact_themes,
        "project_ribbon": {
            "months": dashboard_months,
            "max_total_load": max(month_totals.values(), default=0),
            "items": project_ribbon,
        },
        "department_monthly": forecast_context["department_monthly"],
    }, forecast_context


def _build_recommendations(themes, members, allocations, forecast_context):
    warnings = forecast_context["warnings"]
    member_loads = forecast_context["member_loads"]
    _, _, active_member_by_id = _member_maps(members)
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

        overloaded_member = active_member_by_id.get(member_id)
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

            proposed_shift = min(allocation.allocation_rate, warning["excess"])
            candidate_members = []
            for member in active_member_by_id.values():
                if member.member_id == member_id:
                    continue
                current_load = (member_loads.get(member.member_id) or {}).get(month, 0)
                spare = member.capacity - current_load
                if spare <= 0:
                    continue
                feasible_shift = min(proposed_shift, spare)
                resolution_ratio = round((feasible_shift / warning["excess"]) * 100) if warning["excess"] > 0 else 0
                score = feasible_shift * 3 + spare
                if overloaded_member.department and member.department == overloaded_member.department:
                    score += 20
                candidate_members.append({
                    "member_id": member.member_id,
                    "display_name": member.display_name,
                    "department": member.department or "",
                    "capacity": member.capacity,
                    "current_load": current_load,
                    "spare_capacity": spare,
                    "feasible_shift": feasible_shift,
                    "target_load_after_shift": current_load + feasible_shift,
                    "source_load_after_shift": warning["load"] - feasible_shift,
                    "resolution_ratio": resolution_ratio,
                    "cross_department": bool(
                        overloaded_member.department and member.department != overloaded_member.department
                    ),
                    "score": score,
                })

            candidate_members.sort(
                key=lambda item: (-item["score"], item["cross_department"], item["current_load"], item["display_name"])
            )
            best_option = candidate_members[0] if candidate_members else None
            theme_candidates.append({
                "theme_id": theme.theme_id,
                "theme_name": theme.name,
                "suggested_shift": proposed_shift,
                "recommended_resolution_ratio": best_option["resolution_ratio"] if best_option else 0,
                "candidate_members": candidate_members[:3],
            })

        best_theme_option = max(
            (
                {
                    "theme_name": theme_item["theme_name"],
                    **theme_item["candidate_members"][0],
                }
                for theme_item in theme_candidates if theme_item["candidate_members"]
            ),
            key=lambda item: (item["resolution_ratio"], item["feasible_shift"]),
            default=None,
        )

        recommendations.append({
            "member_id": overloaded_member.member_id,
            "display_name": overloaded_member.display_name,
            "department": overloaded_member.department or "",
            "month": month,
            "load": warning["load"],
            "capacity": warning["capacity"],
            "excess": warning["excess"],
            "themes": theme_candidates[:3],
            "best_option": best_theme_option,
        })

    recommendations.sort(key=lambda item: (-item["excess"], item["month"], item["display_name"]))
    return recommendations


@insights_bp.route("/overview", methods=["GET"])
@login_required
def overview():
    """Return dashboard metrics, health checks, and staffing recommendations."""
    from_month = request.args.get("from")
    to_month = request.args.get("to")
    themes, members, allocations = _collect_context(from_month, to_month)
    dashboard, forecast_context = _build_dashboard(themes, members, allocations, from_month, to_month)
    health_checks = _build_health_checks(themes, members, allocations, forecast_context)
    health_groups = _group_health_checks(health_checks)
    recommendations = _build_recommendations(themes, members, allocations, forecast_context)
    summary = _build_gap_summary(themes, members, allocations, forecast_context)
    summary["health_issue_count"] = len(health_checks)
    summary["recommendation_count"] = len(recommendations)

    return jsonify({
        "summary": summary,
        "health_checks": health_checks,
        "health_groups": health_groups,
        "dashboard": dashboard,
        "recommendations": recommendations,
    })
