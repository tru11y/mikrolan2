# MikroTik Provisioning SaaS — V1 Product Contract

**Status**: Internal Reference  
**Version**: 1.0  
**Last Updated**: 2026-05-05

---

## 1. V1 Mission Statement

### What V1 Solves
V1 automates the initial provisioning and basic lifecycle management of MikroTik routers at scale. It eliminates manual SSH sessions, script copying, and configuration tracking for ISPs and network operators deploying 10–1,000+ devices.

### Who V1 Is For
- ISPs with RouterOS deployments
- Network operators capable of batch operations and queue-based workflows
- Teams that understand MikroTik fundamentals and can troubleshoot API-level issues
- Organizations ready to onboard routers via RouterOS API + WireGuard

### Who V1 Is NOT For
- Single-router deployments (SSH is simpler)
- Customers needing turn-key, hands-off provisioning
- Organizations without MikroTik API/WireGuard competency
- Deployments requiring SLA response guarantees or 24/7 support
- Environments where all routers must be identical (V1 does not enforce uniformity)

---

## 2. Non-Negotiable V1 Guarantees

### Safety Guarantees
1. **No Unauthorized Configuration Changes**: Only authenticated, queued requests trigger router changes. No broadcast, no out-of-band mutations.
2. **No Tenant Data Leakage**: Routers are owned by a single tenant. No cross-tenant configuration visibility or command execution.
3. **No Silent Failures**: If a provisioning step fails, the queue records the failure. The operator sees it; no half-applied state is hidden.
4. **No Cascading Outages**: A failure in one router's provisioning does not block other routers. Queue isolation is enforced.

### Isolation Guarantees
1. **Tenant Isolation**: Every router maps to exactly one tenant. Configuration scopes are enforced at the data layer.
2. **Router State Isolation**: Each router has its own configuration revision history. Rollbacks do not affect siblings.
3. **Queue Isolation**: Tenant queues are isolated. One tenant's burst cannot starve another tenant's provisioning.
4. **Failure Isolation**: A failed provision attempt quarantines that router's queue until the operator explicitly retries or investigates.

### Operational Guarantees
1. **Queue Visibility**: Operators can always see the status, history, and logs of their provisioning jobs.
2. **Manual Override**: Operators can cancel, retry, or forcefully reset queue items without code changes.
3. **Rate Limiting Transparency**: Rate limits are published. Operators know when they will be rate-limited and can batch accordingly.
4. **Audit Trail**: Every provisioning action logs tenant ID, router ID, configuration change, timestamp, and operator (if manual).

---

## 3. Explicit V1 Non-Goals

### Capabilities Intentionally Deferred
- **Zero-Downtime Provisioning**: Some configuration changes may require router reboots or brief WireGuard disconnects. V1 does not guarantee uninterrupted service during provisioning.
- **Multi-Step Rollback Chains**: V1 rolls back to the last clean snapshot. It does not support multi-point-in-time recovery or staged rollbacks.
- **Distributed Multi-Region Provisioning**: V1 provisions routers as independent units. It does not coordinate provisioning across geographic regions or failover scenarios.
- **Dynamic Configuration Generation**: V1 applies operator-provided configs to routers. It does not auto-generate or optimize configurations based on traffic patterns.
- **Real-Time Traffic Steering**: V1 does not monitor router load and auto-adjust provisioning. It is not a traffic engineering system.

### Assumptions V1 Does NOT Make
1. **All routers start identical**: V1 assumes some routers may have pre-existing configurations. It merges, not replaces.
2. **Network is always stable**: V1 retries failed API calls a finite number of times, then halts. Operators must investigate flaky networks.
3. **Operator always responds immediately**: V1 queues fail gracefully. Unacknowledged failures do not auto-resolve; they wait for intervention.
4. **Time is accurate**: V1 relies on operator system clocks for audit timestamps. Clock skew may cause audit confusion.
5. **WireGuard keys are pre-distributed**: V1 does not generate, store, or securely distribute WireGuard keys. Operators manage key lifecycle separately.

### Things Customers Must NOT Expect in V1
- **SLA uptime guarantees**: V1 is operated as best-effort. No 99.9% SLA. Maintenance windows are announced, not compensated.
- **Automatic disaster recovery**: If a tenant's provisioning data is corrupted, an operator restores from backup. There is no auto-heal.
- **Real-time alerting for router health**: V1 provisions; it does not monitor. Router health checks are out of scope.
- **Support for non-RouterOS devices**: V1 only handles MikroTik RouterOS. Other vendors are not supported.
- **CLI, API versioning guarantees**: V1's CLI and API are stable but not frozen. Backward compatibility is a goal, not a guarantee.

---

## 4. Automation Boundaries

### What Is ALWAYS Automated
1. Queue processing: Jobs move from submitted → in-progress → completed/failed without manual triggering.
2. RouterOS API communication: Configuration commands execute via RouterOS API once validated.
3. WireGuard interface setup: WireGuard peer configuration is applied atomically to routers.
4. Tenant isolation enforcement: Data layer prevents cross-tenant leakage automatically.
5. Rate limiting enforcement: Queue pacing respects per-tenant and global rate limits.
6. Audit logging: Every provisioning action is logged. Operators do not manually log.

### What Is NEVER Automated
1. **Operator decisions**: When a provision fails, the operator must decide to retry, investigate, or rollback. V1 does not auto-retry.
2. **Key management**: Generating, rotating, or distributing WireGuard keys is manual and out-of-band.
3. **Router onboarding**: The operator must physically connect the router, obtain its IP, and register it in V1. No zero-touch onboarding.
4. **Incident response**: If a router enters a bad state, the operator must SSH in manually or invoke a recovery procedure.
5. **Capacity planning**: V1 does not auto-provision new routers or resize deployments. The operator must size and request resources.
6. **Network topology decisions**: The operator defines which routers belong to which WireGuard mesh, not V1.

### When Human Intervention Is REQUIRED
1. **Router registration**: Before provisioning, the operator must manually register the router with its IP and credentials.
2. **Failed provision investigation**: If a batch fails, the operator must review logs and decide whether to retry or escalate.
3. **Credential rotation**: If RouterOS credentials expire or change, the operator must update them in V1.
4. **Network partition recovery**: If a router goes offline during provisioning, the operator must verify connectivity and retry.
5. **Rollback approval**: If an operator wants to revert to a prior configuration, they must request it explicitly (not auto-reverted).
6. **Quota increases**: If a tenant hits rate-limit or queue-size quotas, the operator requests a quota bump; V1 does not auto-scale.

---

## 5. Failure Philosophy

### What "Safe Failure" Means
A failure is **safe** if:
1. The router's existing configuration is unchanged.
2. The failure is recorded in the audit trail.
3. The operator is aware (queue status is visible).
4. No subsequent operations on that router proceed until the operator intervenes.
5. Other routers' provisioning is unblocked.

A failure is **unsafe** (and must be prevented):
1. Partial configuration applied (some commands succeeded, some failed).
2. Failure is silent (not logged, not queued, not visible).
3. Cross-tenant effects (one tenant's failure blocks another).
4. Data inconsistency (audit log disagrees with router state).

### What Happens When Things Go Wrong

#### RouterOS API Unavailable
- V1 retries with exponential backoff (up to 3 attempts, then halts).
- Queue item enters "failed" state.
- Operator is notified (via UI/API). Operator investigates network or RouterOS availability.
- Operator manually retries once issue is resolved.

#### Invalid Configuration in Request
- V1 validates syntax against MikroTik schema before sending.
- If syntax is invalid, queue item is rejected at submission (not queued).
- Operator corrects the configuration and resubmits.

#### Router Goes Offline During Provisioning
- V1 detects timeout after ~30 seconds of no response.
- Queue item is marked "pending" and paused.
- Operator verifies router connectivity, confirms router is online, and manually retries.

#### Tenant Quota Exceeded
- New requests are rejected with a "quota exceeded" error.
- Pending requests in queue continue processing.
- Operator requests a quota increase or waits for queue to drain.

#### Data Corruption
- V1 maintains an immutable audit log. Provisioning history cannot be lost.
- If the configuration database is corrupted, V1 halts. Operator restores from backup.
- Recovery is manual; there is no auto-heal.

### What Is Acceptable vs Unacceptable Failure

**Acceptable**:
- A single router's provision fails; others succeed.
- A tenant's queue is paused; other tenants' queues proceed.
- A rate-limited request is rejected; retry succeeds later.
- An operator's invalid config is rejected; a corrected request succeeds.

**Unacceptable**:
- A failure blocks unrelated routers or tenants.
- A failure is not logged or is hidden from the operator.
- A partial configuration is applied to a router (half-provisioned state).
- Cross-tenant data leakage or command execution.
- Audit trail loses or falsifies a provisioning action.

---

## 6. Upgrade Path

### What V1.1 / V2 May Add
- **Batch rollback chains**: Multi-point-in-time recovery for complex deployments.
- **Health check integration**: V1 reads external health checks to pause/resume provisioning.
- **Configuration templating**: Operators define config templates; V1 applies them to classes of routers.
- **Multi-region coordination**: Provisioning jobs span geographic regions with coordinated sequencing.
- **Advanced retry policies**: Operators define custom retry schedules (not built-in exponential backoff).
- **Stronger key management**: Integration with external KMS for WireGuard key rotation.

### What Will NOT Change Even in Later Versions
1. **Tenant isolation is immutable**: No version will allow cross-tenant visibility or operations.
2. **Audit trail is immutable**: History cannot be rewritten or deleted.
3. **No silent failures**: All provisioning outcomes are visible to operators.
4. **Manual router registration**: No zero-touch onboarding without operator intent.
5. **Queue-based design**: Synchronous, blocking provisioning APIs will not be added; all work goes through queues.
6. **MikroTik-only**: V1 and future versions provision MikroTik routers. Other vendors are not in scope.

---

## Summary

V1 is a **reliable, auditable provisioning queue** for MikroTik routers. It automates the repetitive work (API calls, config application, isolation) and leaves the strategic decisions (when to provision, how to respond to failures, topology design) to the operator.

V1 succeeds if operators can confidently provision hundreds of routers without fear of data loss, cross-tenant leakage, or silent failures. V1 fails if it promises more than that.

---

**For questions about this contract, consult the Product team or Engineering lead.**
