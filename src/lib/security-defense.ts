/**
 * Cletus defensive-security response policy.
 *
 * Pure decision logic only: it does not execute scans, isolate hosts, revoke
 * credentials, or stop production processes. Enforcement must be wired through
 * independently controlled infrastructure and tested before activation.
 */
export type SecuritySignalKind =
  | "unauthorized_privilege_escalation"
  | "safety_control_tampering"
  | "audit_log_tampering"
  | "unauthorized_network_egress"
  | "credential_exposure"
  | "unauthorized_fund_movement"
  | "agent_runaway"
  | "dependency_vulnerability"
  | "service_health_failure"
  | "resource_exhaustion";

export interface SecuritySignal {
  kind: SecuritySignalKind;
  observedAt: string;
  evidenceRef: string;
  confidence: number;
  authorizedScope: boolean;
}

export type SecurityResponse =
  | "record_and_alert"
  | "block_affected_operation"
  | "pause_agent"
  | "disable_trade_execution"
  | "revoke_agent_scoped_credentials"
  | "isolate_affected_component"
  | "preserve_forensic_evidence"
  | "require_owner_reauthorization";

export interface SecurityDecision {
  severity: "info" | "warning" | "critical";
  triggerEmergencyStop: boolean;
  allowAutonomousRepair: boolean;
  responses: readonly SecurityResponse[];
  reason: string;
}

/**
 * These events are critical regardless of the model's confidence. The
 * independent enforcement layer must verify evidence and apply containment.
 */
const CRITICAL_SIGNALS = new Set<SecuritySignalKind>([
  "unauthorized_privilege_escalation",
  "safety_control_tampering",
  "audit_log_tampering",
  "unauthorized_fund_movement",
]);

export function evaluateSecuritySignal(signal: SecuritySignal): SecurityDecision {
  const confidence = Number.isFinite(signal.confidence)
    ? Math.min(1, Math.max(0, signal.confidence))
    : 0;
  const hasEvidence = signal.evidenceRef.trim().length > 0;
  const critical = CRITICAL_SIGNALS.has(signal.kind);

  if (critical) {
    return {
      severity: "critical",
      triggerEmergencyStop: true,
      allowAutonomousRepair: false,
      responses: [
        "record_and_alert",
        "block_affected_operation",
        "pause_agent",
        "disable_trade_execution",
        "revoke_agent_scoped_credentials",
        "isolate_affected_component",
        "preserve_forensic_evidence",
        "require_owner_reauthorization",
      ],
      reason: hasEvidence
        ? `Critical security event: ${signal.kind}; owner-controlled recovery required.`
        : `Critical security event: ${signal.kind}; evidence missing, fail closed.`,
    };
  }

  if (!signal.authorizedScope || !hasEvidence || confidence < 0.8) {
    return {
      severity: "warning",
      triggerEmergencyStop: false,
      allowAutonomousRepair: false,
      responses: ["record_and_alert", "block_affected_operation", "preserve_forensic_evidence"],
      reason: "Scope, evidence, or confidence is insufficient for autonomous remediation.",
    };
  }

  if (signal.kind === "unauthorized_network_egress" || signal.kind === "credential_exposure") {
    return {
      severity: "critical",
      triggerEmergencyStop: true,
      allowAutonomousRepair: false,
      responses: [
        "record_and_alert",
        "block_affected_operation",
        "pause_agent",
        "disable_trade_execution",
        "revoke_agent_scoped_credentials",
        "isolate_affected_component",
        "preserve_forensic_evidence",
        "require_owner_reauthorization",
      ],
      reason: `Containment required for ${signal.kind}; no self-repair while compromise is suspected.`,
    };
  }

  if (signal.kind === "agent_runaway" || signal.kind === "resource_exhaustion") {
    return {
      severity: "warning",
      triggerEmergencyStop: true,
      allowAutonomousRepair: false,
      responses: ["record_and_alert", "pause_agent", "disable_trade_execution", "preserve_forensic_evidence"],
      reason: `Agent stability threshold exceeded: ${signal.kind}.`,
    };
  }

  if (signal.kind === "dependency_vulnerability") {
    return {
      severity: "warning",
      triggerEmergencyStop: false,
      allowAutonomousRepair: false,
      responses: ["record_and_alert", "block_affected_operation", "preserve_forensic_evidence", "require_owner_reauthorization"],
      reason: "Dependency findings require triage and reviewed remediation; no unattended upgrades.",
    };
  }

  return {
    severity: "warning",
    triggerEmergencyStop: false,
    allowAutonomousRepair: signal.kind === "service_health_failure",
    responses: ["record_and_alert", "block_affected_operation", "preserve_forensic_evidence"],
    reason: "Only bounded service recovery is eligible for autonomous repair.",
  };
}

/** A latched emergency stop cannot be cleared by the agent itself. */
export function canClearEmergencyStop(actor: "agent" | "owner", hasFreshIncidentReview: boolean): boolean {
  return actor === "owner" && hasFreshIncidentReview;
}

/** Self-healing is restricted to service health, never security or permission changes. */
export function canAttemptAutonomousRepair(
  kind: SecuritySignalKind,
  emergencyStopLatched: boolean,
): boolean {
  return !emergencyStopLatched && kind === "service_health_failure";
}
