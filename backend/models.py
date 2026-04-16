"""SQLAlchemy models for the Resource Management Tool."""

from datetime import datetime, timezone
#
# Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
# Released under the MIT license
# https://opensource.org/licenses/mit-license.php
#

from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()


class User(UserMixin, db.Model):
    """Application user with role-based access."""
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(10), nullable=False, default='user')  # 'admin' or 'user'

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'role': self.role,
        }


theme_members = db.Table('theme_members',
    db.Column('theme_id', db.Integer, db.ForeignKey('themes.theme_id'), primary_key=True),
    db.Column('member_id', db.Integer, db.ForeignKey('members.member_id'), primary_key=True)
)


class Member(db.Model):
    """Development team member."""
    __tablename__ = 'members'

    member_id = db.Column(db.Integer, primary_key=True)
    display_name = db.Column(db.String(100), nullable=False)
    department = db.Column(db.String(100), default='')
    capacity = db.Column(db.Integer, nullable=False, default=100)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    allocations = db.relationship('Allocation', backref='member', lazy='dynamic',
                                  cascade='all, delete-orphan')
    themes = db.relationship('Theme', secondary=theme_members, back_populates='members')

    def to_dict(self):
        return {
            'member_id': self.member_id,
            'display_name': self.display_name,
            'department': self.department,
            'capacity': self.capacity,
            'is_active': self.is_active,
        }


class Theme(db.Model):
    """Development theme (project)."""
    __tablename__ = 'themes'

    theme_id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(100), default='')
    status = db.Column(db.String(20), nullable=False, default='planning')
    color = db.Column(db.String(7), default='#6366f1')
    priority = db.Column(db.Integer, nullable=False, default=0)
    start_month = db.Column(db.String(7), nullable=True)  # 'YYYY-MM'
    end_month = db.Column(db.String(7), nullable=True)    # 'YYYY-MM'
    milestone_month = db.Column(db.String(7), nullable=True)  # 'YYYY-MM'
    milestone_label = db.Column(db.String(200), nullable=True)
    dev_complete_month = db.Column(db.String(7), nullable=True)  # 'YYYY-MM'

    allocations = db.relationship('Allocation', backref='theme', lazy='dynamic',
                                  cascade='all, delete-orphan')
    members = db.relationship('Member', secondary=theme_members, back_populates='themes')
    milestones = db.relationship(
        'ThemeMilestone',
        backref='theme',
        lazy='select',
        cascade='all, delete-orphan',
        order_by='ThemeMilestone.position, ThemeMilestone.id',
    )

    def to_dict(self):
        milestones = [milestone.to_dict() for milestone in self.milestones]
        return {
            'theme_id': self.theme_id,
            'name': self.name,
            'category': self.category,
            'status': self.status,
            'color': self.color,
            'priority': self.priority,
            'start_month': self.start_month,
            'end_month': self.end_month,
            'dev_complete_month': self.dev_complete_month,
            'milestones': milestones,
            'milestone_month': self.milestone_month,
            'milestone_label': self.milestone_label,
            'member_ids': [m.member_id for m in self.members]
        }


class ThemeMilestone(db.Model):
    """Milestone attached to a theme."""
    __tablename__ = 'theme_milestones'

    id = db.Column(db.Integer, primary_key=True)
    theme_id = db.Column(db.Integer, db.ForeignKey('themes.theme_id'), nullable=False, index=True)
    month = db.Column(db.String(7), nullable=False)  # 'YYYY-MM'
    label = db.Column(db.String(200), nullable=True)
    position = db.Column(db.Integer, nullable=False, default=0)
    is_completed = db.Column(db.Boolean, nullable=False, default=False)

    def to_dict(self):
        return {
            'id': self.id,
            'month': self.month,
            'label': self.label,
            'position': self.position,
            'is_completed': self.is_completed,
        }

class Snapshot(db.Model):
    """Gantt data snapshot for comparison."""
    __tablename__ = 'snapshots'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    data = db.Column(db.Text, nullable=False) # JSON
    created_at = db.Column(db.DateTime, server_default=db.func.now())

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'data': self.data,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class SavedView(db.Model):
    """Saved UI view configuration."""
    __tablename__ = 'saved_views'

    id = db.Column(db.String(64), primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    view = db.Column(db.String(50), nullable=False, default='gantt')
    state = db.Column(db.Text, nullable=False, default='{}')
    created_at = db.Column(db.DateTime, server_default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        server_default=db.func.now(),
        onupdate=db.func.now(),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'view': self.view,
            'state': self.state,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class Allocation(db.Model):
    """Monthly allocation of a member to a theme."""
    __tablename__ = 'allocations'

    id = db.Column(db.Integer, primary_key=True)
    theme_id = db.Column(db.Integer, db.ForeignKey('themes.theme_id'), nullable=False)
    member_id = db.Column(db.Integer, db.ForeignKey('members.member_id'), nullable=False)
    month = db.Column(db.String(7), nullable=False)  # 'YYYY-MM'
    allocation_rate = db.Column(db.Integer, nullable=False, default=0)
    memo = db.Column(db.Text, default='')
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.UniqueConstraint('theme_id', 'member_id', 'month', name='uq_allocation'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'theme_id': self.theme_id,
            'member_id': self.member_id,
            'month': self.month,
            'allocation_rate': self.allocation_rate,
            'memo': self.memo or '',
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
