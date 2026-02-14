import json
from models import db, Theme, Member, Allocation

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
