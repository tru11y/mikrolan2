-- SaaS Onboarding Schema
-- SQLite DDL for multi-tenant router onboarding with rate limiting

-- ===== TENANTS TABLE =====
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    max_concurrent_onboardings INT DEFAULT 5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===== EXTENDED ROUTERS TABLE =====
-- (Existing table; add tenant_id column)
ALTER TABLE routers ADD COLUMN tenant_id TEXT REFERENCES tenants(id);

-- ===== ONBOARDING QUEUE TABLE =====
-- PENDING → RUNNING → DONE (or ERROR with retry)
CREATE TABLE IF NOT EXISTS onboarding_queue (
    -- Identity
    id TEXT PRIMARY KEY,                    -- UUID
    tenant_id TEXT NOT NULL,
    router_ip TEXT NOT NULL,
    admin_username TEXT NOT NULL,
    admin_password_encrypted TEXT NOT NULL,

    -- Status & Scheduling
    status TEXT DEFAULT 'PENDING',          -- PENDING, RUNNING, DONE, ERROR
    priority INT DEFAULT 0,                 -- Higher = sooner (optional)

    -- Retry Handling
    attempt_count INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    last_error TEXT,

    -- Timing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,                   -- When transitioned to RUNNING
    completed_at TIMESTAMP,                 -- When transitioned to DONE/ERROR

    -- Worker Tracking
    claimed_by_worker_id TEXT,              -- Scheduler instance ID
    claimed_at TIMESTAMP,                   -- When claimed (transitioned to RUNNING)

    -- Constraints
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- ===== INDEXES =====
-- These are critical for scheduler performance

-- Fast status queries
CREATE INDEX IF NOT EXISTS idx_queue_status
ON onboarding_queue(status);

-- Fast tenant-specific queries
CREATE INDEX IF NOT EXISTS idx_queue_tenant_status
ON onboarding_queue(tenant_id, status);

-- Fast worker recovery (find items claimed by a specific worker)
CREATE INDEX IF NOT EXISTS idx_queue_claimed
ON onboarding_queue(claimed_by_worker_id, status);

-- Fast priority + FIFO selection
CREATE INDEX IF NOT EXISTS idx_queue_priority
ON onboarding_queue(priority DESC, created_at ASC);

-- ===== SAMPLE DATA =====
-- (For testing)

INSERT INTO tenants (id, name, max_concurrent_onboardings) VALUES
  ('isp-verizon', 'Verizon', 15),
  ('isp-orange', 'Orange France', 10),
  ('isp-dt', 'Deutsche Telekom', 8),
  ('isp-vodafone', 'Vodafone', 12);

-- ===== USEFUL QUERIES =====

-- Q1: How many routers are we processing right now?
-- SELECT status, COUNT(*) as count FROM onboarding_queue GROUP BY status;

-- Q2: Which tenant is at their limit?
-- SELECT tenant_id,
--        COUNT(CASE WHEN status='RUNNING' THEN 1 END) as running,
--        (SELECT max_concurrent_onboardings FROM tenants WHERE id=onboarding_queue.tenant_id LIMIT 1) as limit_val,
--        COUNT(CASE WHEN status='PENDING' THEN 1 END) as pending
-- FROM onboarding_queue
-- GROUP BY tenant_id;

-- Q3: Routers stuck in RUNNING (running >10 min)?
-- SELECT router_ip, tenant_id, started_at,
--        CAST((julianday('now') - julianday(started_at)) * 24 * 60 AS INTEGER) as minutes_running
-- FROM onboarding_queue
-- WHERE status='RUNNING' AND started_at < datetime('now', '-10 minutes');

-- Q4: Error rate by tenant?
-- SELECT tenant_id,
--        COUNT(CASE WHEN status='ERROR' THEN 1 END) as errors,
--        COUNT(*) as total,
--        ROUND(100.0 * COUNT(CASE WHEN status='ERROR' THEN 1 END) / COUNT(*), 2) as error_pct
-- FROM onboarding_queue
-- WHERE completed_at IS NOT NULL
-- GROUP BY tenant_id
-- ORDER BY error_pct DESC;

-- Q5: How long is the queue growing?
-- SELECT tenant_id,
--        COUNT(CASE WHEN status='PENDING' THEN 1 END) as queue_depth,
--        COUNT(CASE WHEN status='PENDING' AND created_at > datetime('now', '-1 hour') THEN 1 END) as added_last_hour
-- FROM onboarding_queue
-- GROUP BY tenant_id;

-- Q6: Throughput (routers completed per minute)?
-- SELECT
--   DATE(completed_at) as date,
--   COUNT(*) as completed,
--   ROUND(COUNT(*) / (CAST((julianday('now') - julianday(DATE(completed_at))) * 24 * 60 AS FLOAT) + 1), 2) as per_minute
-- FROM onboarding_queue
-- WHERE status='DONE' AND completed_at > datetime('now', '-24 hours')
-- GROUP BY DATE(completed_at);

-- Q7: Worker activity (which scheduler instance is doing what)?
-- SELECT claimed_by_worker_id,
--        COUNT(CASE WHEN status='RUNNING' THEN 1 END) as running,
--        COUNT(*) as total_claimed
-- FROM onboarding_queue
-- WHERE status='RUNNING'
-- GROUP BY claimed_by_worker_id;
