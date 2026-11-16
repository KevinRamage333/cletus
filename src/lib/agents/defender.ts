/**
 * Defender wraps the existing defensive-security policy with maintenance
 * reporting. It never scans third-party systems, edits production, or handles
 * raw credentials.
 */
import {
  evaluateSecuritySignal,
  type SecurityDecision,
  type SecuritySignal,
} from "../security-defense";

export interface MaintenanceTicket {
  title: string;
  severity: SecurityDecision["severity"];
  summary: string;
  ownerApprovalRequired: boolean;
  permittedNextSteps: string[];
}

export function triageForDefender(signal: SecuritySignal): {
  decision: SecurityDecision;
  ticket: MaintenanceTicket;
} {
  const decision = evaluateSecuritySignal(signal);
  return {
    decision,
    ticket: {
      title: `Defender review: ${signal.kind.replace(/_/g, " ")}`,
      severity: decision.severity,
      summary: decision.reason,
      ownerApprovalRequired: true,
      permittedNextSteps: [
        "Preserve the relevant audit evidence and redact secrets.",
        "Verify the affected asset and authorized scope.",
        "Prepare a minimal remediation plan with rollback steps.",
        "Request owner approval before changing credentials, permissions, dependencies, or deployment state.",
      ],
    },
  };
}
