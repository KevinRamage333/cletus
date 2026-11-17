/**
 * Agent capability registry.
 *
 * This is an application-enforced allowlist, not a prompt convention. Agents
 * receive only the capabilities listed here. No agent receives trade execution,
 * wallet signing, custody, payment, staking, token-minting, or secret access.
 */
export type AgentId = "signal-allocator" | "charlotte" | "defender" | "operations";

export type AgentCapability =
  | "read:market-data"
  | "read:paper-performance"
  | "read:portfolio-exposure"
  | "recommend:allocation"
  | "read:subscription-records"
  | "read:staking-metrics"
  | "read:tokenomics"
  | "recommend:subscription-review"
  | "recommend:tokenomics-review"
  | "read:service-health"
  | "read:security-events"
  | "read:dependency-metadata"
  | "create:maintenance-ticket"
  | "recommend:containment";

export interface AgentDefinition {
  id: AgentId;
  name: string;
  purpose: string;
  capabilities: readonly AgentCapability[];
  operatingMode: "read_only_advisor" | "read_only_monitor";
  mayActWithoutOwner: readonly string[];
  requiresOwnerApproval: readonly string[];
}

export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    id: "signal-allocator",
    name: "Signal & Allocation Analyst",
    purpose: "Evaluate market evidence, propose risk-bounded paper allocations, and explain uncertainty.",
    capabilities: [
      "read:market-data",
      "read:paper-performance",
      "read:portfolio-exposure",
      "recommend:allocation",
    ],
    operatingMode: "read_only_advisor",
    mayActWithoutOwner: ["Refresh analysis", "Record a recommendation and its evidence"],
    requiresOwnerApproval: [
      "Change strategy thresholds or risk limits",
      "Create, approve, sign, or submit any live transaction",
      "Move funds or change wallet permissions",
    ],
  },
  {
    id: "charlotte",
    name: "Charlotte",
    purpose: "Oversee subscriptions, recurring costs, staking design, treasury reporting, and tokenomics sustainability.",
    capabilities: [
      "read:subscription-records",
      "read:staking-metrics",
      "read:tokenomics",
      "recommend:subscription-review",
      "recommend:tokenomics-review",
    ],
    operatingMode: "read_only_advisor",
    mayActWithoutOwner: ["Categorize records", "Flag duplicate or unusual recurring charges", "Prepare sustainability reports"],
    requiresOwnerApproval: [
      "Cancel or change a subscription",
      "Charge a payment method or move treasury funds",
      "Deploy staking contracts or accept deposits",
      "Mint, burn, allocate, or transfer tokens",
      "Publish token return, yield, or profit-share claims",
    ],
  },
  {
    id: "defender",
    name: "Defender",
    purpose: "Monitor security posture, service health, dependencies, backups, and maintenance needs.",
    capabilities: [
      "read:service-health",
      "read:security-events",
      "read:dependency-metadata",
      "create:maintenance-ticket",
      "recommend:containment",
    ],
    operatingMode: "read_only_monitor",
    mayActWithoutOwner: [
      "Raise an alert",
      "Create a maintenance ticket",
      "Recommend a bounded containment action",
    ],
    requiresOwnerApproval: [
      "Change access policies or security configuration",
      "Rotate or revoke credentials",
      "Install or upgrade dependencies",
      "Merge code or deploy",
      "Clear an emergency stop after incident review",
    ],
  },
  {
    id: "operations",
    name: "Operations Steward",
    purpose: "Check the paper worker, scan freshness, and database health, and flag problems for the owner.",
    capabilities: ["read:service-health"],
    operatingMode: "read_only_monitor",
    mayActWithoutOwner: ["Read operational health records", "Report unavailable or stale checks"],
    requiresOwnerApproval: ["Change worker settings", "Restart or deploy a service"],
  },
] as const;

const FORBIDDEN_CAPABILITIES = new Set([
  "trade:execute",
  "wallet:sign",
  "wallet:custody",
  "funds:transfer",
  "payments:charge",
  "staking:deposit",
  "staking:withdraw",
  "token:mint",
  "token:burn",
  "secrets:read",
  "security:disable",
]);

export function getAgentDefinition(id: AgentId): AgentDefinition {
  const definition = AGENT_DEFINITIONS.find((agent) => agent.id === id);
  if (!definition) throw new Error(`Unknown agent: ${id}`);
  return definition;
}

export function agentCan(id: AgentId, capability: string): boolean {
  if (FORBIDDEN_CAPABILITIES.has(capability)) return false;
  return getAgentDefinition(id).capabilities.includes(capability as AgentCapability);
}

export function isForbiddenAgentCapability(capability: string): boolean {
  return FORBIDDEN_CAPABILITIES.has(capability);
}
