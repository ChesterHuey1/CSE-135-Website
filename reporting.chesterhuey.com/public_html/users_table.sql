-- ── Users Table ──────────────────────────────────────────────
-- Run this first:
--   mysql -u root -p analytics < users_table.sql
-- Then seed users:
--   node seed-users.js

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  display_name  VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('super_admin','analyst','viewer') NOT NULL DEFAULT 'viewer',
  sections      VARCHAR(255) DEFAULT NULL,
  -- sections: comma-separated list of allowed sections for analysts
  -- valid values: overview, performance, errors
  -- super_admin and viewer: leave NULL (super_admin gets all, viewer gets saved reports only)
  -- example analyst: 'overview,performance' or 'performance,errors'
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login    DATETIME DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;