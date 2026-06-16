// Paid LandPortal comp-tool runtime guard.
//
// Paid comp endpoints (lp_comp_report_create / lp_comp_report_get) spend a
// LandPortal comp credit. They may ONLY run inside a live LandOS property
// workflow. Default-deny: a missing, unknown, test, build, mock, smoke, seed,
// or debug mode all block. The live LandOS property workflow sets
// LANDOS_COMP_MODE=live_property_workflow when launching Duke for a real run.
//
// This module is pure and side-effect-free (no server start, no network, no
// secrets) so the MCP server and the test suite can both import it.

export const PAID_COMP_TOOLS = ['lp_comp_report_create', 'lp_comp_report_get'];

export const LIVE_PROPERTY_WORKFLOW_MODE = 'live_property_workflow';

/** Read the comp workflow mode from the environment. Default-deny: anything
 *  other than the explicit live mode is treated as not-live. */
export function compWorkflowMode() {
  const raw = (process.env.LANDOS_COMP_MODE || '').trim();
  return raw || 'unknown';
}

export function isPaidComp(name) {
  return PAID_COMP_TOOLS.includes(name);
}

export function isLivePropertyWorkflow(mode) {
  return mode === LIVE_PROPERTY_WORKFLOW_MODE;
}

/**
 * Decide whether a tool call is allowed. For non-paid tools, always allowed.
 * For paid comp tools, allowed ONLY in live_property_workflow mode; otherwise a
 * clear, non-secret error object is returned (never throws, so it becomes a
 * normal MCP tool result).
 */
export function paidCompDecision(name, mode) {
  if (!isPaidComp(name)) return { allowed: true };
  if (isLivePropertyWorkflow(mode)) return { allowed: true };
  return {
    allowed: false,
    error: {
      error: true,
      blocked: true,
      status: 'paid_comp_blocked',
      message:
        `LandPortal comp credits can only be used inside a live LandOS property workflow. ` +
        `"${name}" was blocked because the runtime mode is "${mode}", not "${LIVE_PROPERTY_WORKFLOW_MODE}". ` +
        `No comp credit was spent.`,
    },
  };
}
