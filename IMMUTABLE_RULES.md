# 10 Immutable Product Rules
## MikroTik Router Provisioning Platform

---

### RULE 1: NO CONFIGURATION CHANGE WITHOUT EXPLICIT OPERATOR APPROVAL
**THIS MUST ALWAYS BE TRUE, EVEN IF a customer requests rapid deployment or a system detects a "critical" misconfiguration.**

**Why this rule exists:**
A single configuration error pushed to hundreds of routers can disconnect an entire ISP's customer base. Automation creates false confidence. Manual approval forces a moment of validation.

**What failure it prevents:**
Mass lockouts, cascading service outages, broadcast storms, or routing loops that take hours to recover from.

---

### RULE 2: TENANT NETWORK DATA MUST NEVER CROSS TENANT BOUNDARIES
**THIS MUST ALWAYS BE TRUE, EVEN IF sharing data would optimize performance, reduce latency, or simplify architecture.**

**Why this rule exists:**
In shared infrastructure, isolation is the only guarantee customers have. A single isolation breach is a security incident that destroys trust and creates compliance liability.

**What failure it prevents:**
Data leakage between customers, routing rule collisions, customer traffic leaking into another customer's network, unauthorized access to configuration.

---

### RULE 3: EVERY ROUTER MUST RETAIN AN ESCAPE HATCH FOR MANUAL RECOVERY
**THIS MUST ALWAYS BE TRUE, EVEN IF the escape hatch is rarely documented, undiscovered by normal operations, or requires physical or console access.**

**Why this rule exists:**
Automation fails. When it does, operators need a path forward that doesn't require flying to a remote site to plug in a serial cable as a last resort.

**What failure it prevents:**
Permanent lockout of routers, inability to recover from cascading automation failures, devices that become bricked and unrecoverable.

---

### RULE 4: AUTOMATED RETRY LOGIC MUST HAVE EXPLICIT LIMITS WITH EXPLICIT BACKOFF
**THIS MUST ALWAYS BE TRUE, EVEN IF increasing retry counts or removing backoff would superficially improve success rates.**

**Why this rule exists:**
Unbounded retries create cascading failures. A failed deployment that retries infinitely with zero backoff will exhaust system resources, create DDoS-like behavior, and compound the original failure.

**What failure it prevents:**
Resource exhaustion, thundering herd problems, cascading failures that spread from one router to the entire network, inability to recover from transient failures.

---

### RULE 5: NO SINGLE AUTOMATION ACTION MAY AFFECT MORE THAN ONE ROUTER WITHOUT EXPLICIT ORCHESTRATION GATES
**THIS MUST ALWAYS BE TRUE, EVEN IF batch operations would be more "efficient" or a customer demands fast deployment to 100 routers.**

**Why this rule exists:**
Blast radius containment. If one router's deployment fails, isolation prevents the failure from propagating to 99 others.

**What failure it prevents:**
Mass failures, correlated outages, inability to isolate which router caused a problem, ripple failures where one bad deployment breaks all downstream dependencies.

---

### RULE 6: EVERY PROVISIONING ACTION MUST BE PERMANENTLY LOGGED WITH FULL AUDITABILITY
**THIS MUST ALWAYS BE TRUE, EVEN IF logging adds latency, increases storage costs, or complicates real-time troubleshooting.**

**Why this rule exists:**
When a customer's router misbehaves, the first question is "what changed?" Auditability is the only way to answer it. It's also a compliance and forensic requirement.

**What failure it prevents:**
Inability to investigate outages, compliance violations, inability to prove who changed what and when, untraceability of cascading failures.

---

### RULE 7: THE SYSTEM MUST NEVER PLACE A ROUTER IN AN UNREACHABLE STATE
**THIS MUST ALWAYS BE TRUE, EVEN IF a configuration change theoretically improves routing, even if it's a failover operation, even if the operator believes they know what they're doing.**

**Why this rule exists:**
An unreachable router is a bricked router. It becomes a customer support incident, a site visit, a replacement device. Prevention is cheaper than recovery.

**What failure it prevents:**
Permanent router lockout, inaccessible devices, customer downtime, expensive emergency maintenance visits.

---

### RULE 8: AN OPERATOR MUST ALWAYS BE ABLE TO PAUSE, HALT, OR ROLLBACK ANY AUTOMATION OPERATION
**THIS MUST ALWAYS BE TRUE, EVEN IF a rollback operation appears to violate a customer's requested SLA or takes time.**

**Why this rule exists:**
Automation serves operators, not the reverse. When something goes wrong, operators must have immediate control to stop the bleeding.

**What failure it prevents:**
Runaway automation that can't be stopped, cascading failures that continue while operators are helpless, inability to respond to live incidents.

---

### RULE 9: ALL FAILURE MODES MUST DEFAULT TO "DO NOTHING" NOT "CONTINUE BLINDLY"
**THIS MUST ALWAYS BE TRUE, EVEN IF "safe defaults" delay recovery or require manual intervention.**

**Why this rule exists:**
A failed deployment that does nothing is a problem. A failed deployment that continues with partial configuration is a disaster. Explicit failure beats implicit progress.

**What failure it prevents:**
Partial configurations left on routers, inconsistent state across the network, cascading failures where components assume the system is healthy when it isn't.

---

### RULE 10: ROUTER STATE MUST BE CONTINUOUSLY VERIFIED AGAINST INTENDED STATE, NOT ASSUMED
**THIS MUST ALWAYS BE TRUE, EVEN IF verification adds polling overhead, increases API calls, or delays deployment confirmation.**

**Why this rule exists:**
Network conditions change. Routers reboot. Configs are lost. Commands fail silently. Assumption-based deployments (deploy once, assume it stuck) are a primary source of latent failures that surface days later.

**What failure it prevents:**
Silent drift between intended and actual state, configurations that disappear and aren't reapplied, discovery of config loss only when customers complain, cascading failures caused by undetected state inconsistencies.

---

## Summary

These 10 rules form the immutable foundation of the platform. They are not negotiable.

- **Safety over speed:** Verification > automation
- **Isolation over convenience:** Tenant boundaries > shared optimization
- **Operator control over autonomy:** Manual override > blind automation
- **Observability over hidden failures:** Auditability > real-time speed
- **Explicit limits over infinite retries:** Bounded failure > unbounded cascade
