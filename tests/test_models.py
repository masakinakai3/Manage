#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

from models import User, Member, Theme, Allocation

def test_password_hashing():
    """Test User password hashing and verification."""
    u = User(username='testuser')
    u.set_password('cat')
    assert u.check_password('cat')
    assert not u.check_password('dog')

def test_member_creation(app):
    """Test Member creation."""
    with app.app_context():
        from models import db
        m = Member(display_name='Test Member', department='Dev', capacity=80)
        db.session.add(m)
        db.session.commit()
        
        assert m.display_name == 'Test Member'
        assert m.department == 'Dev'
        assert m.capacity == 80
        assert m.is_active is True  # Default value

def test_theme_creation(app):
    """Test Theme creation."""
    with app.app_context():
        from models import db
        t = Theme(name='Test Theme', status='active')
        db.session.add(t)
        db.session.commit()
        
        assert t.name == 'Test Theme'
        assert t.status == 'active'
        assert t.color == '#6366f1'  # Default value

def test_allocation_unique_constraint(app):
    """Test that Allocations are unique per theme/member/month."""
    from models import db
    from sqlalchemy.exc import IntegrityError
    import pytest

    with app.app_context():
        # Setup data
        t = Theme(name='T1')
        m = Member(display_name='M1')
        db.session.add_all([t, m])
        db.session.commit()

        # First allocation
        a1 = Allocation(theme_id=t.theme_id, member_id=m.member_id, month='2024-01', allocation_rate=50)
        db.session.add(a1)
        db.session.commit()

        # Duplicate allocation should fail
        a2 = Allocation(theme_id=t.theme_id, member_id=m.member_id, month='2024-01', allocation_rate=100)
        db.session.add(a2)
        
        with pytest.raises(IntegrityError):
            db.session.commit()
        
        db.session.rollback()
