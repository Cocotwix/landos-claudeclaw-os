// Type declarations for the paid-comp runtime guard (comp-guard.js), so the
// TypeScript test suite can import it without implicit-any errors.

export const PAID_COMP_TOOLS: string[];
export const LIVE_PROPERTY_WORKFLOW_MODE: 'live_property_workflow';

export function compWorkflowMode(): string;
export function isPaidComp(name: string): boolean;
export function isLivePropertyWorkflow(mode: string): boolean;

export interface PaidCompError {
  error: true;
  blocked: true;
  status: string;
  message: string;
}

export function paidCompDecision(
  name: string,
  mode: string,
): { allowed: boolean; error?: PaidCompError };
