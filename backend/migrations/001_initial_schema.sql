BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS members (
    member_id INTEGER PRIMARY KEY,
    display_name VARCHAR(100) NOT NULL,
    department VARCHAR(100) DEFAULT '',
    capacity INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS themes (
    theme_id INTEGER PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100) DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'planning',
    color VARCHAR(7) DEFAULT '#6366f1',
    priority INTEGER NOT NULL DEFAULT 0,
    start_month VARCHAR(7),
    end_month VARCHAR(7)
);

CREATE TABLE IF NOT EXISTS theme_members (
    theme_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    PRIMARY KEY (theme_id, member_id),
    FOREIGN KEY(theme_id) REFERENCES themes(theme_id),
    FOREIGN KEY(member_id) REFERENCES members(member_id)
);

CREATE TABLE IF NOT EXISTS allocations (
    id INTEGER PRIMARY KEY,
    theme_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    month VARCHAR(7) NOT NULL,
    allocation_rate INTEGER NOT NULL DEFAULT 0,
    memo TEXT DEFAULT '',
    updated_at DATETIME,
    FOREIGN KEY(theme_id) REFERENCES themes(theme_id),
    FOREIGN KEY(member_id) REFERENCES members(member_id)
);

CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
