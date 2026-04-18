"""Trim SQLAlchemy packaging to the SQLite runtime used by this app."""

hiddenimports = [
    "sqlalchemy.dialects.sqlite",
    "sqlalchemy.dialects.sqlite.base",
    "sqlalchemy.dialects.sqlite.dml",
    "sqlalchemy.dialects.sqlite.json",
    "sqlalchemy.dialects.sqlite.pysqlite",
]

excludedimports = [
    "sqlalchemy.dialects.mssql",
    "sqlalchemy.dialects.mysql",
    "sqlalchemy.dialects.oracle",
    "sqlalchemy.dialects.postgresql",
    "sqlalchemy.dialects.sqlite.aiosqlite",
    "sqlalchemy.dialects.sqlite.pysqlcipher",
]
