# Cletus Defensive Security and Emergency Shutdown

## Mission

Cletus may defend only systems, accounts, repositories, cloud projects, databases, and networks that the owner has explicitly authorized. Defensive testing must be scoped, logged, rate-limited, and non-destructive by default.

## Defensive capabilities

- Asset inventory for Cletus-owned GitHub, Vercel, Neon, application, dependencies, and configured RPC/API integrations.
- Dependency and secret-exposure checks; exposed credentials are treated as compromised and rotated, never printed.
- Authentication, authorization, session, API, database-permission, and configuration checks.
- Safe dynamic testing against staging or an explicitly approved test target; no uncontrolled internet scanning, exploitation, persistence, lateral movement, or destructive payloads.
- Runtime monitoring for unusual process behavior, unauthorized outbound connections, repeated failures, resource exhaustion, permission changes, and unexpected trade or wallet activity.
- Incident response with containment, evidence preservation, owner notification, and reviewed recovery.
- Self-healing only for bounded service-health failures using known-good releases and reversible actions.

## Independent emergency stop

The emergency stop must be enforced outside the AI process (for example, by a separately permissioned control plane and cloud-side execution gate). The model must not possess permission to disable, modify, bypass, or clear it.

When tripped, the control plane should:
1. Reject new trade execution and withdrawals.
2. Pause agent workers and scheduled autonomous jobs.
3. Revoke or disable agent-scoped credentials and tokens where supported.
4. Isolate the affected component or deployment without destroying evidence.
5. Preserve append-only logs, deployment identifiers, and incident evidence.
6. Notify the owner through a channel the agent cannot suppress.
7. Require owner reauthorization after incident review before resuming.

The owner should retain a separate emergency control that does not depend on the model, its memory, its application UI, or its database being healthy. Recovery must use a known-good release and independently verified credentials.

## Observable trip conditions

The stop is based on observable behavior, not speculative claims about consciousness:
- Attempted privilege escalation or access outside approved scope.
- Attempts to change or disable risk limits, audit trails, kill-switch logic, or owner permissions.
- Unauthorized wallet activity, transaction signing, withdrawals, or fund movement.
- Suspected credential exposure or unauthorized network egress.
- Audit-log tampering.
- Runaway loops, repeated unbounded actions, or resource exhaustion.

## Self-healing boundary

Autonomous repair may be considered only for a known, low-risk service-health failure, within an explicit allowlist, with a bounded retry budget, health checks, rollback, and audit logging. Security incidents, credential exposure, dependency vulnerabilities, permission changes, and financial actions are never self-repaired without owner review.

## Implementation status

- `src/lib/security-defense.ts` contains pure, testable incident classification and permission policy.
- Unit tests cover emergency-stop decisions and repair boundaries.
- This policy module does not yet enforce actions in production. It must be connected to the external execution gate, credential management, monitoring, alerting, and owner-only reset workflow before it can be described as an operational defense system.
