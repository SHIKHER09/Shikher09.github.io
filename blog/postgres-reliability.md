![PostgreSQL Reliability Banner](/images/blog/postgres-reliability-hero.png)

# Optimizing PostgreSQL for Reliability: Backups, Replication, and Observability

> A practical SRE checklist for teams running Postgres in production. Copy–paste friendly. Minimal theory, maximum uptime.

---

## TL;DR

* **Backups**: Do **both** physical (basebackup + WAL) for fast restore **and** logical (pg_dump) for surgical recovery.
* **Replication**: At least 1 async follower for reads + 1 sync follower for durability; automate failover.
* **Observability**: Export Prometheus metrics, enable `pg_stat_statements`, set actionable alerts.
* **Drills**: Prove RPO/RTO quarterly. If you haven’t restored it, you don’t have it.

---

## 1) Reliability Goals

* **RPO (data loss)**: ≤ 60s (typical) using WAL archiving/streaming.
* **RTO (downtime)**: ≤ 5–15 min with automated failover + restore runbook.
* **SLO**: e.g., 99.9% monthly availability for write traffic.

Define these with product/leadership and design everything below to meet them.

---

## 2) Backups

### 2.1 Physical backup + WAL (Point‑in‑Time Recovery)

**Enable archiving** (PostgreSQL ≥ 13 example):

```conf
# postgresql.conf
archive_mode = on
archive_command = 'wal-g wal-push %p'   # or use pgBackRest/rsync to durable storage
wal_level = replica
max_wal_senders = 10
```

Take a base backup:

```bash
# Option A: pg_basebackup (ships cluster files)
pg_basebackup -h <primary-host> -D /backups/base/$(date +%F) -U replicator -Fp -Xs -P

# Option B: wal-g/pgBackRest (recommended for compression, retention, integrity)
wal-g backup-push $PGDATA
```

Restore to a **timestamp/LSN**:

```bash
# Prepare empty data dir and fetch latest base
wal-g backup-fetch $PGDATA LATEST

# recovery.conf settings (v13+ via postgresql.auto.conf)
cat >> $PGDATA/postgresql.auto.conf <<'EOF'
restore_command = 'wal-g wal-fetch %f %p'
recovery_target_time = '2025-09-15 10:42:00+05:30'  # or recovery_target_lsn
recovery_target_action = 'promote'
EOF

pg_ctl start -D $PGDATA
```

Retention policy (example):

```bash
wal-g delete retain FIND_FULL 7 --confirm   # keep last 7 full backups
wal-g delete before FIND_FULL 14 --confirm  # delete older than 14 fulls
```

### 2.2 Logical backups (schema/data snapshots)

```bash
# Entire DB (portable, slower)
pg_dump -h <host> -U <user> -Fc -f /backups/dumps/app_$(date +%F).dump app_db

# Single schema/table
pg_dump -h <host> -U <user> -Fc -n public -t orders -f /backups/dumps/orders_$(date +%F).dump app_db

# Restore
pg_restore -h <host> -U <user> -d app_db --clean /backups/dumps/app_2025-09-15.dump
```

**Use cases**: surgical recovery, migrating between major versions, seeding lower envs.

**Golden rule**: Test restore monthly. Store to durable, versioned, geo‑redundant storage.

---

## 3) Replication & Failover

### 3.1 Streaming replicas

Create a replication user:

```sql
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '***';
```

On a new follower:

```bash
pg_basebackup -h <primary> -D $PGDATA -U replicator -Fp -Xs -P
```

`postgresql.conf` on primary:

```conf
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
synchronous_standby_names = 'ANY 1 (replica1, replica2)'  # for 1 synchronous follower
```

`pg_hba.conf` (allow replica):

```
host    replication    replicator    10.0.0.0/24    md5
```

Check status:

```sql
SELECT client_addr, state, sync_state, sent_lsn, replay_lsn
FROM pg_stat_replication;
```

### 3.2 Automated failover

* **Patroni** (etcd/Consul/DCS) or **repmgr** are common.
* Health‑checks + fencing + `pg_ctl promote` handled by the tool.
* Put a **write VIP**/CNAME in front of the current primary.

**Drill** (quarterly):

1. Stop primary.
2. Verify promotion time and data currency on new primary.
3. Re‑create replication from new primary.

---

## 4) Observability (metrics, logs, traces)

### 4.1 Prometheus + Grafana

* Deploy `postgres_exporter` with a **least‑privilege** role.

```sql
CREATE USER postgres_exporter WITH PASSWORD '***';
GRANT CONNECT ON DATABASE app_db TO postgres_exporter;
GRANT USAGE ON SCHEMA public TO postgres_exporter;
-- Grant read on needed views/tables or use exporter setup SQL
```

Key metrics / alerts (suggested):

* **Availability**: up == 1, `pg_up == 1`
* **Lag**: `pg_replication_lag_bytes > 128MB for 5m`
* **Connections**: `sum(pg_stat_activity_count) / max_connections > 0.8`
* **Autovacuum**: long‑running vacuums, freeze age > 80% of threshold
* **WAL**: disk free < 20%, `wal_files` growth spike
* **Slow SQL**: `pg_stat_statements.mean_time > 500ms` for topN
* **Checkpoints**: too frequent/infrequent

### 4.2 Extensions/Logs

* Enable `pg_stat_statements`, `pg_stat_io` (v16+) for IO hotspots.
* Log slow statements, lock waits, autovacuum actions:

```conf
shared_preload_libraries = 'pg_stat_statements'
log_min_duration_statement = 500ms
log_lock_waits = on
log_autovacuum_min_duration = 0
```

---

## 5) Maintenance & Config Baseline

* **Autovacuum**: tune for write‑heavy tables.

```sql
ALTER TABLE big_table SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_limit = 2000
);
```

* **Bloat control**: `VACUUM (FULL)` sparingly; prefer `pg_repack` online.
* **Indexes**: monitor unused/duplicate, consider partial indexes.
* **Config (example small prod)**:

```conf
shared_buffers = 25% of RAM (cap ~8GB)
work_mem = 8-64MB per *active* connection
maintenance_work_mem = 512MB-2GB
effective_cache_size = 50-75% of RAM
max_connections = 200 (prefer pgbouncer)
checkpoint_timeout = 10-15min
wal_compression = on
```

* **Connection pooler**: `pgbouncer` in transaction mode for chatty apps.

---

## 6) Security & Access

* TLS for client/server.
* Rotate credentials; use IAM/Secrets Manager/KMS.
* Principle of least privilege; separate app, admin, and exporter roles.
* Row‑Level Security where needed; audit with `pgaudit`.

---

## 7) Runbooks (printable)

### 7.1 PITR

1. Stop instance; move old `$PGDATA` aside.
2. `wal-g backup-fetch $PGDATA LATEST`
3. Write recovery targets; start; validate LSN/time.
4. Point applications after checks (read‑only window if needed).

### 7.2 Promote a follower

1. `patroni ctl` or `pg_ctl promote`.
2. Update VIP/DNS; flush caches.
3. Rebuild old primary as a follower.

### 7.3 “Oh‑no we dropped a table”

1. Find exact timestamp.
2. PITR restore to **just before** event.
3. Use `pg_dump` to export the lost table; import into prod.

---

## 8) Testing & Chaos

* Monthly restore test (random timestamp).
* Quarterly failover game‑day.
* Inject replica lag; verify SLOs and alerting.

---

## 9) Checklist

* [ ] WAL archiving on + tested restore
* [ ] At least 1 sync + 1 async follower
* [ ] Automated failover (Patroni/repmgr)
* [ ] Prometheus + Grafana + actionable alerts
* [ ] `pg_stat_statements` enabled and reviewed weekly
* [ ] Pooling (`pgbouncer`) in place
* [ ] Quarterly game‑day; monthly backup restore test

---

### Credits

This post is part of my SRE/DB reliability notes. Questions or improvements? Ping me on Twitter **@ShikherKumar1** or open an issue on GitHub.
