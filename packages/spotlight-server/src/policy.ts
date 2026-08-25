import {
  deriveToolTier,
  type FrontendToolDescriptorV1,
  type SpotlightTurnPolicy,
} from "@inupedia/spotlight-protocol";

export type SpotlightPolicyDecision =
  | { action: "allow" }
  | { action: "require_approval"; reason: string }
  | { action: "deny"; reason: string };

/** Server-authoritative Tool policy. The browser may approve, but cannot downgrade risk. */
export class SpotlightPolicyEngine {
  evaluate(
    tool: FrontendToolDescriptorV1,
    policy: SpotlightTurnPolicy | undefined,
  ): SpotlightPolicyDecision {
    const approved = new Set(policy?.approvedToolNames ?? []);
    const denied = new Set(policy?.deniedToolNames ?? []);
    if (denied.has(tool.name)) {
      return { action: "deny", reason: "Tool is denied by the Turn policy" };
    }
    if (approved.has(tool.name)) return { action: "allow" };

    const risky =
      deriveToolTier(tool) === "mutate" ||
      tool.sideEffect === "external" ||
      tool.riskLevel === "high" ||
      tool.requiresConfirmation === true;
    const mode = policy?.approvalMode ?? "on_risk";
    if (mode === "always") {
      return { action: "require_approval", reason: "Turn policy requires approval for every Tool" };
    }
    if (risky && mode === "never") {
      return {
        action: "deny",
        reason: "Risky Tool cannot run because this Turn disables approvals",
      };
    }
    if (risky) {
      return {
        action: "require_approval",
        reason: "Tool can change external state or declares high risk",
      };
    }
    return { action: "allow" };
  }
}
