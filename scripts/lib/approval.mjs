import { randomBytes } from "node:crypto";
import path from "node:path";

import { applyChangeset } from "./changeset.mjs";
import { PosError, invariant } from "./errors.mjs";
import { appendJsonl, ensureDir, exists, isoNow, readJson, writeJsonAtomic } from "./io.mjs";
import { openRoot } from "./root.mjs";
import { assertNoSymlinkComponents, resolveInside, safeComponent } from "./safe-path.mjs";

export const APPROVAL_SCHEMA = "pos.approval.v1";
export const APPROVAL_DECISIONS = new Set(["approve", "revise", "reject", "cancel"]);
const TERMINAL_STATUS = new Set(["applied", "declined", "revision_requested", "cancelled", "expired", "stale"]);

function decisionStatus(decision) {
  return {
    approve: "applied",
    revise: "revision_requested",
    reject: "declined",
    cancel: "cancelled",
  }[decision];
}

function boundedText(value, maxLength = 2000) {
  if (value === undefined || value === null) return null;
  return String(value).trim().slice(0, maxLength) || null;
}

function publicOperation(operation) {
  return {
    id: operation.id,
    action: operation.action,
    from: operation.from,
    path: operation.path,
    reason: boundedText(operation.reason, 1000),
    protected: operation.protected,
    beforeHash: operation.beforeHash,
    afterHash: operation.afterHash,
    contentMode: operation.contentMode,
    sourceSize: operation.sourceSize,
    diff: operation.diff,
    diffTruncated: operation.diffTruncated === true,
  };
}

function publicProposal(record) {
  return {
    schema: record.schema,
    proposalId: record.proposalId,
    projectId: record.projectId,
    taskId: record.taskId,
    changeId: record.changeId ?? record.taskId,
    hostId: record.hostId,
    summary: record.summary,
    changesetPath: record.changesetPath,
    planDigest: record.planDigest,
    operationCount: record.operationCount,
    operations: record.operations,
    writeScope: record.writeScope,
    policyMode: record.policyMode,
    applicable: record.applicable,
    requiresApproval: record.requiresApproval,
    requiresProtectedApproval: record.requiresProtectedApproval,
    status: record.status,
    createdAt: record.createdAt,
    decidedAt: record.decidedAt,
    decision: record.decision,
    channel: record.channel,
    note: record.note,
    undoId: record.undoId,
    confirmationPhrase: `APPROVE ${record.proposalId}`,
  };
}

async function approvalPath(root, proposalId) {
  const safe = safeComponent(proposalId, "Proposal ID");
  const relative = `.pos/approvals/${safe}.json`;
  await assertNoSymlinkComponents(root, relative, { includeLeaf: false });
  return { relative, absolute: resolveInside(root, relative) };
}

async function appendDecisionAudit(root, record, result) {
  await assertNoSymlinkComponents(root, ".pos/audit.jsonl");
  await appendJsonl(path.join(root, ".pos", "audit.jsonl"), {
    schema: "pos.audit.v1",
    event: "approval-decision",
    proposalId: record.proposalId,
    taskId: record.taskId,
    changeId: record.changeId ?? record.taskId,
    at: record.decidedAt ?? isoNow(),
    decision: record.decision,
    channel: record.channel,
    planDigest: record.planDigest,
    result,
  });
}

export async function createApprovalProposal(rootInput, changesetInput, options = {}) {
  const { root, marker } = await openRoot(rootInput);
  const previewResult = await applyChangeset(root, changesetInput, { yes: false });
  const preview = previewResult.preview;
  invariant(preview.operations.length > 0, "EMPTY_CHANGESET", "Changeset has no operations to approve.", undefined, 2);
  const proposalId = safeComponent(
    `P-${preview.taskId}-${preview.planDigest.slice(0, 12)}-${randomBytes(4).toString("hex")}`,
    "Proposal ID",
  );
  const createdAt = isoNow();
  const record = {
    schema: APPROVAL_SCHEMA,
    proposalId,
    projectId: marker.projectId,
    taskId: preview.taskId,
    changeId: preview.changeId,
    hostId: preview.hostId,
    changesetPath: preview.changesetPath,
    planDigest: preview.planDigest,
    summary: boundedText(preview.summary, 2000) ?? "",
    operationCount: preview.operations.length,
    operations: preview.operations.map(publicOperation),
    writeScope: preview.writeScope,
    policyMode: preview.policyMode,
    applicable: preview.applicable,
    requiresApproval: preview.requiresApproval,
    requiresProtectedApproval: preview.requiresProtectedApproval,
    status: "awaiting_approval",
    createdAt,
    expiresAt: options.expiresAt ?? null,
    decidedAt: null,
    decision: null,
    channel: null,
    note: null,
    undoId: null,
  };
  const destination = await approvalPath(root, proposalId);
  await assertNoSymlinkComponents(root, ".pos/approvals", { includeLeaf: false });
  await ensureDir(path.join(root, ".pos", "approvals"));
  await assertNoSymlinkComponents(root, ".pos/approvals");
  invariant(!(await exists(destination.absolute)), "APPROVAL_COLLISION", "Approval proposal already exists.", { proposalId }, 4);
  await writeJsonAtomic(destination.absolute, record);
  await assertNoSymlinkComponents(root, ".pos/audit.jsonl");
  await appendJsonl(path.join(root, ".pos", "audit.jsonl"), {
    schema: "pos.audit.v1",
    event: "approval-proposed",
    proposalId,
    taskId: preview.taskId,
    changeId: preview.changeId,
    at: createdAt,
    planDigest: preview.planDigest,
    operationCount: preview.operations.length,
    result: "awaiting_approval",
  });
  return publicProposal(record);
}

export async function readApprovalProposal(rootInput, proposalId) {
  const { root, marker } = await openRoot(rootInput);
  const source = await approvalPath(root, proposalId);
  invariant(await exists(source.absolute), "APPROVAL_NOT_FOUND", "Approval proposal was not found.", { proposalId }, 3);
  const record = await readJson(source.absolute);
  invariant(record?.schema === APPROVAL_SCHEMA && record.projectId === marker.projectId && record.proposalId === proposalId, "INVALID_APPROVAL", "Approval proposal is invalid for this Personal OS root.", { proposalId }, 4);
  invariant(Array.isArray(record.operations) && typeof record.planDigest === "string" && typeof record.changesetPath === "string", "INVALID_APPROVAL", "Approval proposal is incomplete.", { proposalId }, 4);
  return { root, source, record };
}

export async function approvalStatus(rootInput, proposalId) {
  const { record } = await readApprovalProposal(rootInput, proposalId);
  return publicProposal(record);
}

export async function decideApproval(rootInput, proposalId, decisionInput, options = {}) {
  const decision = String(decisionInput ?? "").toLowerCase();
  invariant(APPROVAL_DECISIONS.has(decision), "INVALID_APPROVAL_DECISION", "Decision must be approve, revise, reject, or cancel.", { decision }, 2);
  const { root, source, record } = await readApprovalProposal(rootInput, proposalId);
  invariant(record.status === "awaiting_approval" && !TERMINAL_STATUS.has(record.status), "APPROVAL_ALREADY_DECIDED", "Approval proposal has already reached a terminal state.", { proposalId, status: record.status }, 4);
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    record.status = "expired";
    record.decidedAt = isoNow();
    record.decision = "cancel";
    record.channel = boundedText(options.channel, 120) ?? "runtime";
    await writeJsonAtomic(source.absolute, record);
    await appendDecisionAudit(root, record, "expired");
    throw new PosError("APPROVAL_EXPIRED", "Approval proposal has expired. Create a fresh proposal.", { proposalId }, 7);
  }

  record.decision = decision;
  record.channel = boundedText(options.channel, 120) ?? "text";
  record.note = boundedText(options.note);
  record.decidedAt = isoNow();

  if (decision !== "approve") {
    record.status = decisionStatus(decision);
    await writeJsonAtomic(source.absolute, record);
    await appendDecisionAudit(root, record, record.status);
    return { applied: false, proposal: publicProposal(record) };
  }

  invariant(record.applicable, "PLAN_NOT_APPLICABLE", "The approved plan is not applicable under the current policy.", { proposalId }, 7);
  invariant(!record.requiresProtectedApproval || options.approveProtected === true, "PROTECTED_APPROVAL_REQUIRED", "Protected Context changes require a separate explicit approval.", { proposalId }, 7);
  try {
    const result = await applyChangeset(root, record.changesetPath, {
      yes: true,
      approveProtected: options.approveProtected === true,
      expectedPlanDigest: record.planDigest,
    });
    record.status = "applied";
    record.undoId = result.undoId;
    await writeJsonAtomic(source.absolute, record);
    await appendDecisionAudit(root, record, "applied");
    return { applied: true, proposal: publicProposal(record), result };
  } catch (error) {
    if (["APPROVED_PLAN_CHANGED", "STALE_CONTENT", "SOURCE_MISSING", "TARGET_EXISTS", "CHANGE_ALREADY_APPLIED"].includes(error?.code)) {
      record.status = "stale";
      record.note = boundedText(error.message);
      await writeJsonAtomic(source.absolute, record);
      await appendDecisionAudit(root, record, "stale");
    }
    throw error;
  }
}

export { publicProposal };
