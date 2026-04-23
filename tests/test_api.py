#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

import io
import json
from models import db, Theme, ThemeMilestone, Member, Allocation, SavedView

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
    })
    assert response.status_code == 201
    assert response.json['name'] == 'New Theme'
    assert response.json['dev_rank'] == 'L'
    assert response.json['milestone_month'] == '2026-06'
    assert response.json['milestone_label'] == 'Release'
    assert [item['month'] for item in response.json['milestones']] == ['2026-06', '2026-08']
    assert [item['label'] for item in response.json['milestones']] == ['Release', 'Audit']

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
            'dev_complete_month': '2026-06',
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

    # 2. Update existing allocation to 0 (should delete)
    payload[0]['allocation_rate'] = 0
    response = auth_client.put('/api/allocations/bulk', json=payload)
    assert response.status_code == 200

    # Verify deletion
    with app.app_context():
        alloc = Allocation.query.filter_by(theme_id=t_id, member_id=m_id, month='2024-05').first()
        assert alloc is None


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
