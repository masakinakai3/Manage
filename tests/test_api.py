#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

import io
import json
from app import create_app
from models import db, Theme, ThemeMilestone, Member, Allocation, SavedView, User

def test_login(client):
    """Test login functionality."""
    # Success
    response = client.post('/api/auth/login', json={
        'username': 'admin',
        'password': 'admin'
    })
    assert response.status_code == 200
    assert response.json['username'] == 'admin'

    # Failure
    response = client.post('/api/auth/login', json={
        'username': 'admin',
        'password': 'wrongpassword'
    })
    assert response.status_code == 401


def test_requires_login_for_protected_api(client):
    response = client.get('/api/themes')
    assert response.status_code == 401


def test_non_admin_cannot_access_admin_user_management(user_client):
    response = user_client.get('/api/auth/users')
    assert response.status_code == 403


def test_non_admin_cannot_export_or_import_data(user_client):
    export_response = user_client.get('/api/export/json')
    assert export_response.status_code == 403

    payload = {
        'themes': [],
        'members': [],
        'theme_members': [],
        'allocations': [],
    }
    import_response = user_client.post(
        '/api/import/json',
        data={'file': (io.BytesIO(json.dumps(payload).encode('utf-8')), 'backup.json')},
        content_type='multipart/form-data',
    )
    assert import_response.status_code == 403


def test_admin_can_manage_users(auth_client, app):
    create_response = auth_client.post('/api/auth/users', json={
        'username': 'planner',
        'password': 'initial-pass',
        'role': 'user',
    })
    assert create_response.status_code == 201
    user_id = create_response.json['id']

    list_response = auth_client.get('/api/auth/users')
    assert list_response.status_code == 200
    assert any(item['username'] == 'planner' for item in list_response.json)

    update_response = auth_client.put(f'/api/auth/users/{user_id}', json={
        'username': 'planner-admin',
        'role': 'admin',
        'password': 'next-pass',
    })
    assert update_response.status_code == 200
    assert update_response.json['username'] == 'planner-admin'
    assert update_response.json['role'] == 'admin'

    with app.app_context():
        user = db.session.get(User, user_id)
        assert user is not None
        assert user.check_password('next-pass')

    delete_response = auth_client.delete(f'/api/auth/users/{user_id}')
    assert delete_response.status_code == 200

    with app.app_context():
        assert db.session.get(User, user_id) is None


def test_admin_cannot_delete_self(auth_client, app):
    with app.app_context():
        admin = User.query.filter_by(username='admin').first()
        admin_id = admin.id

    response = auth_client.delete(f'/api/auth/users/{admin_id}')
    assert response.status_code == 400


def test_startup_can_reset_admin_password():
    reset_app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
        "INITIAL_ADMIN_PASSWORD": "admin",
        "RESET_ADMIN_PASSWORD": "rescue-pass",
        "AUTO_LOGIN": False,
    })

    with reset_app.app_context():
        admin = User.query.filter_by(username='admin').first()
        assert admin is not None
        assert admin.check_password('rescue-pass')

def test_get_themes(auth_client, app):
    """Test fetching themes."""
    # Seed a theme with app context
    with app.app_context():
        t = Theme(name='API Test Theme')
        db.session.add(t)
        db.session.commit()

    response = auth_client.get('/api/themes')
    assert response.status_code == 200
    data = response.json
    assert any(item['name'] == 'API Test Theme' for item in data)

def test_create_theme(auth_client):
    """Test creating a new theme."""
    response = auth_client.post('/api/themes', json={
        'name': 'New Theme',
        'category': 'Test',
        'status': 'planning',
        'dev_rank': 'L',
        'milestones': [
            {'month': '2026-06', 'label': 'Release'},
            {'month': '2026-08', 'label': 'Audit'},
        ],
        'dev_complete_months': [
            {'month': '2026-07', 'is_completed': True},
            {'month': '2026-09', 'is_completed': False},
        ],
    })
    assert response.status_code == 201
    assert response.json['name'] == 'New Theme'
    assert response.json['dev_rank'] == 'L'
    assert response.json['milestone_month'] == '2026-06'
    assert response.json['milestone_label'] == 'Release'
    assert [item['month'] for item in response.json['milestones']] == ['2026-06', '2026-08']
    assert [item['label'] for item in response.json['milestones']] == ['Release', 'Audit']
    assert response.json['dev_complete_month'] == '2026-07'
    assert response.json['dev_complete_months'] == [
        {'month': '2026-07', 'is_completed': True},
        {'month': '2026-09', 'is_completed': False},
    ]

def test_update_theme_milestone(auth_client, app):
    with app.app_context():
        theme = Theme(name='Milestone Theme')
        db.session.add(theme)
        db.session.commit()
        theme_id = theme.theme_id

    response = auth_client.put(f'/api/themes/{theme_id}', json={
        'status': 'stop',
        'dev_rank': 'S',
        'milestones': [
            {'month': '2026-09', 'label': 'Go Live'},
            {'month': '2026-10', 'label': 'Hypercare'},
        ],
    })
    assert response.status_code == 200
    assert response.json['status'] == 'stop'
    assert response.json['dev_rank'] == 'S'
    assert response.json['milestone_month'] == '2026-09'
    assert response.json['milestone_label'] == 'Go Live'
    assert [item['label'] for item in response.json['milestones']] == ['Go Live', 'Hypercare']

    with app.app_context():
        saved = ThemeMilestone.query.filter_by(theme_id=theme_id).order_by(ThemeMilestone.position).all()
        assert [item.month for item in saved] == ['2026-09', '2026-10']

def test_update_theme_allows_empty_dev_rank(auth_client, app):
    with app.app_context():
        theme = Theme(name='No Rank Theme', dev_rank='S')
        db.session.add(theme)
        db.session.commit()
        theme_id = theme.theme_id

    response = auth_client.put(f'/api/themes/{theme_id}', json={
        'dev_rank': '',
    })
    assert response.status_code == 200
    assert response.json['dev_rank'] == ''


def test_import_json_preserves_dev_rank(auth_client, app):
    with app.app_context():
        existing_theme = Theme(name='Existing Theme', dev_rank='M')
        existing_member = Member(display_name='Existing Member')
        db.session.add_all([existing_theme, existing_member])
        db.session.commit()

    payload = {
        'themes': [{
            'theme_id': 10,
            'name': 'Imported Theme',
            'category': 'Platform',
            'status': 'active',
            'color': '#123456',
            'priority': 2,
            'dev_rank': 'S',
            'start_month': '2026-04',
            'end_month': '2026-06',
            'dev_complete_months': [
                {'month': '2026-06', 'is_completed': False},
                {'month': '2026-08', 'is_completed': True},
            ],
            'milestones': [
                {'month': '2026-05', 'label': 'Beta', 'is_completed': False},
            ],
        }],
        'members': [{
            'member_id': 20,
            'display_name': 'Imported Member',
            'department': 'Platform',
            'capacity': 100,
            'is_active': True,
        }],
        'theme_members': [{
            'theme_id': 10,
            'member_id': 20,
        }],
        'allocations': [{
            'theme_id': 10,
            'member_id': 20,
            'month': '2026-05',
            'allocation_rate': 60,
            'memo': 'Imported allocation',
        }],
    }

    response = auth_client.post(
        '/api/import/json',
        data={'file': (io.BytesIO(json.dumps(payload).encode('utf-8')), 'backup.json')},
        content_type='multipart/form-data',
    )

    assert response.status_code == 200
    assert response.json['themes'] == 1

    response = auth_client.get('/api/themes')
    assert response.status_code == 200
    assert response.json[0]['name'] == 'Imported Theme'
    assert response.json[0]['dev_rank'] == 'S'
    assert response.json[0]['dev_complete_month'] == '2026-06'
    assert response.json[0]['dev_complete_months'] == [
        {'month': '2026-06', 'is_completed': False},
        {'month': '2026-08', 'is_completed': True},
    ]

def test_bulk_allocations(auth_client, app):
    """Test bulk update of allocations."""
    # Setup: Create Theme and Member
    with app.app_context():
        t = Theme(name='Alloc Theme')
        m = Member(display_name='Alloc Member')
        db.session.add_all([t, m])
        db.session.commit()
        t_id = t.theme_id
        m_id = m.member_id

    # 1. Insert new allocation
    payload = [{
        'theme_id': t_id,
        'member_id': m_id,
        'month': '2024-05',
        'allocation_rate': 60
    }]
    response = auth_client.put('/api/allocations/bulk', json=payload)
    assert response.status_code == 200
    assert 'updated' in response.json
    assert response.json['updated'] == 1

    # Verify insertion
    with app.app_context():
        alloc = Allocation.query.filter_by(theme_id=t_id, member_id=m_id, month='2024-05').first()
        assert alloc is not None
        assert alloc.allocation_rate == 60

    # 2. Update existing allocation to 0 (should persist as an explicit 0, not delete)
    payload[0]['allocation_rate'] = 0
    response = auth_client.put('/api/allocations/bulk', json=payload)
    assert response.status_code == 200

    with app.app_context():
        alloc = Allocation.query.filter_by(theme_id=t_id, member_id=m_id, month='2024-05').first()
        assert alloc is not None
        assert alloc.allocation_rate == 0

    # 3. Clearing with a null rate should delete the allocation
    payload[0]['allocation_rate'] = None
    response = auth_client.put('/api/allocations/bulk', json=payload)
    assert response.status_code == 200

    with app.app_context():
        alloc = Allocation.query.filter_by(theme_id=t_id, member_id=m_id, month='2024-05').first()
        assert alloc is None


def test_single_allocation_zero_persists_and_null_clears(auth_client, app):
    """Entering 0% must be saved distinctly from clearing the cell."""
    with app.app_context():
        t = Theme(name='Single Alloc Theme')
        m = Member(display_name='Single Alloc Member')
        db.session.add_all([t, m])
        db.session.commit()
        t_id = t.theme_id
        m_id = m.member_id

    base_payload = {'theme_id': t_id, 'member_id': m_id, 'month': '2024-07'}

    # Saving an explicit 0 persists a real row showing "0%", not nothing.
    response = auth_client.put('/api/allocations/single', json={**base_payload, 'allocation_rate': 0})
    assert response.status_code == 200
    with app.app_context():
        alloc = Allocation.query.filter_by(theme_id=t_id, member_id=m_id, month='2024-07').first()
        assert alloc is not None
        assert alloc.allocation_rate == 0

    # The zero-rate row is now visible through the list endpoint.
    response = auth_client.get(f'/api/allocations?theme_id={t_id}&member_id={m_id}')
    assert response.status_code == 200
    assert any(item['month'] == '2024-07' and item['allocation_rate'] == 0 for item in response.json)

    # Clearing (null) deletes the row entirely.
    response = auth_client.put('/api/allocations/single', json={**base_payload, 'allocation_rate': None})
    assert response.status_code == 200
    assert response.json.get('message') == 'Deleted'
    with app.app_context():
        alloc = Allocation.query.filter_by(theme_id=t_id, member_id=m_id, month='2024-07').first()
        assert alloc is None

    response = auth_client.get(f'/api/allocations?theme_id={t_id}&member_id={m_id}')
    assert response.status_code == 200
    assert response.json == []


def test_insights_overview(auth_client, app):
    """Test insights overview for dashboard, health checks, and recommendations."""
    with app.app_context():
        theme = Theme(
            name='Insight Theme',
            category='Platform',
            status='completed',
            start_month='2024-04',
            end_month='2024-05',
        )
        member_a = Member(display_name='Insight Alice', department='Platform', capacity=100)
        member_b = Member(display_name='Insight Bob', department='Platform', capacity=100)
        db.session.add_all([theme, member_a, member_b])
        db.session.commit()

        theme.members.append(member_a)
        db.session.add_all([
            Allocation(theme_id=theme.theme_id, member_id=member_a.member_id, month='2024-05', allocation_rate=70),
            Allocation(theme_id=theme.theme_id, member_id=member_a.member_id, month='2024-06', allocation_rate=50),
            Allocation(theme_id=theme.theme_id, member_id=member_b.member_id, month='2024-06', allocation_rate=20),
        ])
        db.session.commit()

    response = auth_client.get('/api/insights/overview?from=2024-05&to=2024-06')
    assert response.status_code == 200
    data = response.json
    assert data['summary']['theme_count'] >= 1
    assert data['summary']['total_shortage'] >= 0
    assert data['summary']['total_spare'] >= 0
    assert isinstance(data['health_checks'], list)
    assert isinstance(data['health_groups'], list)
    assert isinstance(data['recommendations'], list)
    assert 'dashboard' in data
    assert 'project_ribbon' in data['dashboard']
    assert 'forecast' in data['dashboard']
    assert 'department_load' in data['dashboard']
    assert 'impact_themes' in data['dashboard']
    assert data['dashboard']['project_ribbon']['months'] == ['2024-05', '2024-06']
    assert data['dashboard']['project_ribbon']['items'][1]['projects'][0]['name'] == 'Insight Theme'
    assert any(item['code'] == 'closed_theme_with_remaining_allocation' for item in data['health_checks'])
    assert any(group['category'] == 'resource_operations' for group in data['health_groups'])
    assert data['dashboard']['forecast'][0]['month'] == '2024-05'
    assert data['dashboard']['department_load'][0]['department'] == 'Platform'


def test_project_ribbon_aggregates_theme_load_per_month(auth_client, app):
    with app.app_context():
        theme = Theme(
            name='Ribbon Aggregate Theme',
            category='Platform',
            status='active',
        )
        member_a = Member(display_name='Ribbon Alice', department='Platform', capacity=100)
        member_b = Member(display_name='Ribbon Bob', department='Platform', capacity=100)
        db.session.add_all([theme, member_a, member_b])
        db.session.commit()

        db.session.add_all([
            Allocation(theme_id=theme.theme_id, member_id=member_a.member_id, month='2024-03', allocation_rate=35),
            Allocation(theme_id=theme.theme_id, member_id=member_b.member_id, month='2024-03', allocation_rate=45),
        ])
        db.session.commit()

    response = auth_client.get('/api/insights/overview?from=2024-03&to=2024-03')
    assert response.status_code == 200
    data = response.json
    ribbon_item = data['dashboard']['project_ribbon']['items'][0]
    assert ribbon_item['total_load'] == 80
    assert len(ribbon_item['projects']) == 1
    assert ribbon_item['projects'][0]['name'] == 'Ribbon Aggregate Theme'
    assert ribbon_item['projects'][0]['load'] == 80


def test_insights_scenario_suggestions_start_fixed(auth_client, app):
    with app.app_context():
        target_theme = Theme(
            name='Scenario Existing Theme',
            category='Platform',
            status='active',
            priority=1,
        )
        shift_theme = Theme(
            name='Scenario Shift Theme',
            category='Support',
            status='planning',
            priority=3,
        )
        member_a = Member(display_name='Scenario Alice', department='Platform', capacity=100)
        member_b = Member(display_name='Scenario Bob', department='Platform', capacity=100)
        member_c = Member(display_name='Scenario Carol', department='Platform', capacity=100)
        db.session.add_all([target_theme, shift_theme, member_a, member_b, member_c])
        db.session.commit()

        target_theme.members.append(member_a)
        target_theme.members.append(member_b)
        db.session.add_all([
            Allocation(theme_id=target_theme.theme_id, member_id=member_a.member_id, month='2024-05', allocation_rate=60),
            Allocation(theme_id=target_theme.theme_id, member_id=member_b.member_id, month='2024-05', allocation_rate=40),
            Allocation(theme_id=shift_theme.theme_id, member_id=member_c.member_id, month='2024-05', allocation_rate=70),
        ])
        db.session.commit()
        target_theme_id = target_theme.theme_id

    response = auth_client.post('/api/insights/scenario-suggestions', json={
        'mode': 'start_fixed',
        'start_month': '2024-05',
        'duration_months': 1,
        'effort_person_months': 1.2,
        'target_theme_id': target_theme_id,
        'preferred_department': 'Platform',
    })
    assert response.status_code == 200
    data = response.json
    assert data['mode'] == 'start_fixed'
    assert len(data['candidates']) == 3
    assert any(candidate['type'] == 'shift_with_assignments' for candidate in data['candidates'])
    assert any(candidate['monthly_plan'][0]['assignments'] for candidate in data['candidates'])


def test_insights_scenario_suggestions_keep_schedule(auth_client, app):
    with app.app_context():
        theme = Theme(
            name='Busy Theme',
            category='Platform',
            status='active',
            priority=1,
        )
        member = Member(display_name='Start Finder', department='Platform', capacity=100)
        db.session.add_all([theme, member])
        db.session.commit()

        db.session.add_all([
            Allocation(theme_id=theme.theme_id, member_id=member.member_id, month='2024-05', allocation_rate=100),
            Allocation(theme_id=theme.theme_id, member_id=member.member_id, month='2024-06', allocation_rate=100),
        ])
        db.session.commit()

    response = auth_client.post('/api/insights/scenario-suggestions', json={
        'mode': 'keep_schedule',
        'start_month': '2024-05',
        'duration_months': 1,
        'effort_person_months': 1.0,
        'preferred_department': 'Platform',
    })
    assert response.status_code == 200
    data = response.json
    assert data['mode'] == 'keep_schedule'
    assert data['candidates'][0]['start_month'] == '2024-07'
    assert data['candidates'][0]['uncovered_points'] == 0


def test_saved_views_crud(auth_client, app):
    payload = {
        'id': 'view-1',
        'name': 'Planning view',
        'view': 'gantt',
        'state': {
            'startMonth': '2026-04',
            'scale': 1,
            'groupBy': 'none',
        },
    }

    response = auth_client.post('/api/saved-views', json=payload)
    assert response.status_code == 201
    assert response.json['id'] == 'view-1'
    assert response.json['name'] == 'Planning view'

    response = auth_client.get('/api/saved-views')
    assert response.status_code == 200
    assert any(item['id'] == 'view-1' for item in response.json)

    with app.app_context():
        saved_view = db.session.get(SavedView, 'view-1')
        assert saved_view is not None
        assert json.loads(saved_view.state)['startMonth'] == '2026-04'

    response = auth_client.delete('/api/saved-views/view-1')
    assert response.status_code == 204

    with app.app_context():
        assert db.session.get(SavedView, 'view-1') is None
