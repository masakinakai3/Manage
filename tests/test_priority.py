
#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

from models import Theme

def test_theme_priority(app):
    """Test Theme priority field."""
    with app.app_context():
        from models import db
        t = Theme(name='Priority Test Theme', priority=5)
        db.session.add(t)
        db.session.commit()
        
        saved_theme = db.session.get(Theme, t.theme_id)
        assert saved_theme.priority == 5

        # Test default value
        t2 = Theme(name='Default Priority Theme')
        db.session.add(t2)
        db.session.commit()
        
        saved_theme2 = db.session.get(Theme, t2.theme_id)
        assert saved_theme2.priority == 0
