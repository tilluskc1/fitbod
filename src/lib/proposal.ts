import type { Constraints } from './adapt.ts';

/**
 * The context a preview was built against. Approval is only valid while the
 * context is unchanged: logging a set, finishing work, or changing equipment
 * invalidates the preview instead of overwriting completed data.
 */
export interface ProposalContext {
  sessionId: string | null;
  /** Completed sets in the open session when previewed. */
  done: number;
  /** History entries when previewed. */
  historyLength: number;
  /** Profile equipment/support/exclusions fingerprint when previewed. */
  equipmentKey: string;
}

export interface Proposal {
  id: string;
  constraints: Constraints;
  base: ProposalContext;
}

let counter = 0;

/** Snapshot a preview so approval can refuse work done after it. */
export function createProposal(
  constraints: Constraints,
  base: ProposalContext,
  id?: string,
): Proposal {
  counter += 1;
  return {
    id: id ?? `proposal-${Date.now().toString(36)}-${counter}`,
    constraints: { ...constraints },
    base: { ...base },
  };
}

/** What the approve handler does with a preview: start it, refuse it, or ignore a repeat tap. */
export type ProposalDecision = 'accept' | 'stale' | 'already-applied';

/**
 * The approve handler's whole decision in one testable place: a repeat tap
 * of an applied preview only navigates, a preview built before intervening
 * logging or equipment changes is refused, anything else may start.
 */
export function decideProposalApproval(
  proposal: Proposal,
  current: ProposalContext,
  appliedId: string | null,
): ProposalDecision {
  if (appliedId === proposal.id) return 'already-applied';
  return isProposalStale(proposal, current) ? 'stale' : 'accept';
}

/** True when anything the preview was built on has moved. */
export function isProposalStale(proposal: Proposal, current: ProposalContext): boolean {
  return (
    proposal.base.sessionId !== current.sessionId ||
    proposal.base.done !== current.done ||
    proposal.base.historyLength !== current.historyLength ||
    proposal.base.equipmentKey !== current.equipmentKey
  );
}
