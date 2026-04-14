#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

import json
from models import db, Theme, Member, Allocation, SavedView

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
        'status': 'planning'
    })
    assert response.status_code == 201
    assert response.json['name'] == 'New Theme'

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
    assert isinstance(data['health_checks'], list)
    assert isinstance(data['recommendations'], list)
    assert 'dashboard' in data
    assert any(item['code'] == 'closed_theme_with_remaining_allocation' for item in data['health_checks'])


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
