import { describe, expect, it } from "vitest";
import {
  canAttemptAutonomousRepair,
  canClearEmergencyStop,
  evaluateSecuritySignal,
  type SecuritySignal,
} from "./security-defense";

const signal = (kind: SecuritySignal["kind"], overrides: Partial<SecuritySignal> = {}): SecuritySignal => ({
  kind,
  observedAt: "2026-11-16T00:00:00.000Z",
  evidenceRef: "incident://test-001",
  confidence: 0.99,
  authorizedScope: true,
  ...overrides,
});

describe("Cletus defensive security policy", () => {
  it("latches an emergency stop for safety-control tampering", () => {
    const decision = evaluateSecuritySignal(signal("safety_control_tampering"));
    expect(decision.severity).toBe("critical");
    expect(decision.triggerEmergencyStop).toBe(true);
    expect(decision.allowAutonomousRepair).toBe(false);
    expect(decision.responses).toContain("disable_trade_execution");
    expect(decision.responses).toContain("require_owner_reauthorization");
  });

  it("fails closed for unauthorized fund movement even with missing evidence", () => {
    const decision = evaluateSecuritySignal(signal("unauthorized_fund_movement", { evidenceRef: "" }));
    expect(decision.triggerEmergencyStop).toBe(true);
    expect(decision.allowAutonomousRepair).toBe(false);
  });

  it("does not autonomously repair events outside authorized scope", () => {
    const decision = evaluateSecuritySignal(signal("service_health_failure", { authorizedScope: false }));
    expect(decision.allowAutonomousRepair).toBe(false);
    expect(decision.responses).toContain("block_affected_operation");
  });

  it("allows only bounded service-health repair when no stop is latched", () => {
    expect(canAttemptAutonomousRepair("service_health_failure", false)).toBe(true);
    expect(canAttemptAutonomousRepair("credential_exposure", false)).toBe(false);
    expect(canAttemptAutonomousRepair("service_health_failure", true)).toBe(false);
  });

  it("never lets the agent clear the emergency stop", () => {
    expect(canClearEmergencyStop("agent", true)).toBe(false);
    expect(canClearEmergencyStop("owner", false)).toBe(false);
    expect(canClearEmergencyStop("owner", true)).toBe(true);
  });
});
