/** Read-only Guardian adapter for the existing Defender security policy.
 * Never executes remediation, changes risk limits, or clears emergency stops.
 */
import { triageForDefender } from "./defender";
import type { SecuritySignal, SecuritySignalKind } from "../security-defense";

export type GuardianEvent = {
  kind: SecuritySignalKind;
  observedAt: string;
  evidenceRef: string;
  confidence: number;
  authorizedScope: boolean;
};

export function reviewGuardianEvent(event: GuardianEvent) {
  const signal: SecuritySignal = {
    kind: event.kind,
    observedAt: event.observedAt,
    evidenceRef: event.evidenceRef,
    confidence: event.confidence,
    authorizedScope: event.authorizedScope,
  };
  const { decision, ticket } = triageForDefender(signal);
  return {
    agent: "defender" as const,
    severity: decision.severity,
    emergencyStopRecommended: decision.triggerEmergencyStop,
    autonomousRepairAllowed: decision.allowAutonomousRepair,
    ticket,
    responses: decision.responses,
  };
}
