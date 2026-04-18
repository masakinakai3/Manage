"""Trim SQLAlchemy packaging to the SQLite runtime used by this app."""

from PyInstaller.utils.hooks import collect_submodules


hiddenimports = collect_submodules("sqlalchemy.dialects.sqlite")

excludedimports = [
    "sqlalchemy.dialects.mssql",
    "sqlalchemy.dialects.mysql",
    "sqlalchemy.dialects.oracle",
    "sqlalchemy.dialects.postgresql",
]
