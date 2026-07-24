#!/usr/bin/env node

import { createInterface } from "node:readline";

import { approvalStatus, createApprovalProposal, decideApproval } from "./lib/approval.mjs";
import { errorPayload } from "./lib/errors.mjs";

const SERVER_INFO = { name: "hks-personal-os", version: "1.3.2" };
const pending = new Map();
let nextRequestId = 1;
let clientCapabilities = {};
let clientInfo = {};

function send(message) {
  const encoded = JSON.stringify(message)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  process.stdout.write(`${encoded}\n`);
}

function toolResult(payload, { isError = false } = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

function riskOf(proposal) {
  if (proposal.requiresProtectedApproval) return "high";
  if (proposal.operations.some((item) => ["archive", "trash", "move", "update"].includes(item.action))) return "medium";
  return "low";
}

function proposalCard(proposal) {
  return {
    schema: "pos.approval-card.v1",
    proposalId: proposal.proposalId,
    taskId: proposal.taskId,
    changeId: proposal.changeId,
    title: proposal.summary || "Personal OS file plan",
    status: proposal.status,
    risk: riskOf(proposal),
    operationCount: proposal.operationCount,
    protectedChanges: proposal.requiresProtectedApproval,
    writeScope: proposal.writeScope,
    planDigest: proposal.planDigest,
    operations: proposal.operations.map((item) => ({
      id: item.id,
      action: item.action,
      from: item.from,
      path: item.path,
      reason: item.reason,
      protected: item.protected,
      diff: item.diff,
    })),
    confirmationPhrase: proposal.confirmationPhrase,
  };
}

function singleLine(value, maxLength = 240) {
  const text = String(value ?? "").replace(/[\r\n\t\u2028\u2029]+/gu, " ").replace(/\s{2,}/gu, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function localizedRisk(risk) {
  return ({ low: "低", medium: "中", high: "高" })[risk] ?? risk;
}

function localizedAction(action) {
  return ({ create: "新建", update: "更新", move: "移动", archive: "归档", trash: "移入回收区" })[action] ?? action;
}

function actionSummary(operations) {
  const order = ["create", "update", "move", "archive", "trash"];
  const counts = new Map();
  for (const operation of operations) counts.set(operation.action, (counts.get(operation.action) ?? 0) + 1);
  return order
    .filter((action) => counts.has(action))
    .map((action) => `${localizedAction(action)} ${counts.get(action)} 项`)
    .join("｜");
}

function hasFormElicitation() {
  const elicitation = clientCapabilities?.elicitation;
  return elicitation !== undefined && (elicitation?.form !== undefined || Object.keys(elicitation ?? {}).length === 0);
}

function isCodexClient() {
  return /codex/iu.test(`${clientInfo?.name ?? ""} ${clientInfo?.title ?? ""}`);
}

function elicitationTimeoutMs() {
  if (process.env.POS_TEST_MODE === "1" && process.env.POS_TEST_ELICITATION_TIMEOUT_MS) {
    return Math.max(10, Number(process.env.POS_TEST_ELICITATION_TIMEOUT_MS));
  }
  return 5 * 60 * 1000;
}

function sendClientRequest(method, params, timeoutMs = elicitationTimeoutMs()) {
  const id = `pos-${nextRequestId++}`;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`Client request timed out: ${method}`), { code: "ELICITATION_TIMEOUT" }));
    }, timeoutMs);
    timer.unref?.();
    pending.set(String(id), {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
}

function elicitationMessage(card) {
  const rows = card.operations.flatMap((item, index) => {
    const number = String(index + 1).padStart(2, "0");
    const details = [
      `【变更 ${number}】${localizedAction(item.action)}`,
      `目标：${singleLine(item.path, 2000)}`,
    ];
    if (item.from) details.push(`来源：${singleLine(item.from, 2000)}`);
    if (item.reason) details.push(`原因：${singleLine(item.reason)}`);
    if (item.protected) details.push("受保护内容：是");
    return details;
  });
  const scope = card.writeScope.length > 0
    ? card.writeScope.map((item, index) => `${String(index + 1).padStart(2, "0")}｜${singleLine(item, 2000)}`)
    : ["未声明"];
  return [
    "Hks Personal OS · 变更审批",
    "",
    "【本次计划】",
    `目的：${singleLine(card.title) || "Personal OS 文件变更"}`,
    `动作：${actionSummary(card.operations) || "未声明"}`,
    `风险：${localizedRisk(card.risk)}`,
    `受保护内容：${card.protectedChanges ? "是" : "否"}`,
    `操作总数：${card.operationCount} 项`,
    "",
    "【文件变更】",
    ...rows,
    "",
    "【允许写入范围】",
    ...scope,
    "",
    "【审批边界】",
    `批准后只执行以上 ${card.operationCount} 项操作。`,
    `计划校验：${singleLine(card.planDigest).slice(0, 12)}…`,
    "如果内容、路径或写入范围变化，必须重新预览和审批。",
    "完整提案编号与校验信息已保存在 Personal OS 审批记录中。",
  // Codex's native MCP form collapses ordinary LF characters because the
  // message is rendered as normal-flow text. U+2028 has Unicode line-break
  // class BK, so browsers preserve it as a mandatory visual line break even
  // when CSS white-space is `normal`.
  ].join("\u2028");
}

async function reviewProposal(args) {
  const proposal = await approvalStatus(args.root, args.proposalId);
  const card = proposalCard(proposal);
  if (isCodexClient()) {
    return toolResult({
      schema: "pos.interaction-handoff.v1",
      interactive: false,
      reason: "codex-native-form-does-not-preserve-structured-layout",
      preferredInteraction: "codex-inline-visual",
      card,
      approvalVisual: {
        command: "approval-visual",
        root: args.root,
        proposalId: proposal.proposalId,
        outputRequirement: "Write a new .html fragment inside the current Codex thread visualization directory, then emit its codex-inline-vis directive.",
      },
      next: "Render the proposal with the Personal OS approval-visual command. Do not open Codex native MCP form elicitation for this proposal.",
      confirmationPhrase: proposal.confirmationPhrase,
    });
  }
  if (!hasFormElicitation()) {
    return toolResult({
      schema: "pos.interaction-fallback.v1",
      interactive: false,
      reason: "client-does-not-declare-form-elicitation",
      card,
      next: `Ask the user to type exactly: ${proposal.confirmationPhrase}`,
    });
  }

  const properties = {
    decision: {
      type: "string",
      title: `审批 ${card.operationCount} 项文件变更（${localizedRisk(card.risk)}风险）`,
      description: "请核对上方【文件变更】和【允许写入范围】。批准只适用于当前计划。",
      oneOf: [
        { const: "approve", title: "批准并写入" },
        { const: "revise", title: "要求修改计划" },
        { const: "reject", title: "拒绝本次提案" },
        { const: "cancel", title: "暂不处理" },
      ],
      default: "approve",
    },
    note: {
      type: "string",
      title: "备注（可选）",
      description: "可说明需要调整或拒绝的原因，请勿输入密码、Token 等敏感信息。",
      maxLength: 1000,
    },
  };
  if (proposal.requiresProtectedApproval) {
    properties.approveProtected = {
      type: "boolean",
      title: "同时批准受保护的 Context 变更",
      description: "本提案修改了核心上下文，需要额外确认。",
      default: false,
    };
  }
  let response;
  try {
    response = await sendClientRequest("elicitation/create", {
      mode: "form",
      message: elicitationMessage(card),
      requestedSchema: {
        type: "object",
        properties,
        required: ["decision", ...(proposal.requiresProtectedApproval ? ["approveProtected"] : [])],
      },
    });
  } catch (error) {
    if (error?.code !== "ELICITATION_TIMEOUT") throw error;
    return toolResult({
      schema: "pos.interaction-pending.v1",
      interactive: true,
      timedOut: true,
      status: proposal.status,
      proposalId: proposal.proposalId,
      card,
      next: "Call personal_os_review again to reopen this unchanged proposal, or use its exact text confirmation.",
      confirmationPhrase: proposal.confirmationPhrase,
    });
  }

  if (response?.action === "decline") {
    return toolResult(await decideApproval(args.root, args.proposalId, "reject", { channel: "mcp-elicitation" }));
  }
  if (response?.action !== "accept") {
    return toolResult(await decideApproval(args.root, args.proposalId, "cancel", { channel: "mcp-elicitation" }));
  }
  const decision = response.content?.decision ?? "cancel";
  const result = await decideApproval(args.root, args.proposalId, decision, {
    channel: "mcp-elicitation",
    note: response.content?.note,
    approveProtected: response.content?.approveProtected === true,
  });
  return toolResult({ ...result, card: proposalCard(result.proposal) });
}

const TOOLS = [
  {
    name: "personal_os_preview",
    description: "Validate a Personal OS Changeset and create an immutable, reviewable approval proposal. This does not modify formal assets.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Explicit absolute Personal OS root." },
        changeset: { type: "string", description: "Changeset path inside the Personal OS root." },
      },
      required: ["root", "changeset"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "personal_os_review",
    description: "Review one immutable proposal. Codex clients receive a structured inline-visual handoff because native MCP forms do not preserve reviewable layout; other compatible clients may use native form elicitation.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Explicit absolute Personal OS root." },
        proposalId: { type: "string", description: "Proposal ID returned by personal_os_preview." },
      },
      required: ["root", "proposalId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "personal_os_status",
    description: "Read the status and exact contents of a Personal OS approval proposal.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Explicit absolute Personal OS root." },
        proposalId: { type: "string", description: "Proposal ID." },
      },
      required: ["root", "proposalId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
  },
];

async function callTool(params) {
  const name = params?.name;
  const args = params?.arguments ?? {};
  if (name === "personal_os_preview") {
    const proposal = await createApprovalProposal(args.root, args.changeset);
    return toolResult({
      interactive: !isCodexClient() && hasFormElicitation(),
      preferredInteraction: isCodexClient() ? "codex-inline-visual" : (hasFormElicitation() ? "mcp-form-elicitation" : "explicit-text-confirmation"),
      card: proposalCard(proposal),
      proposal,
    });
  }
  if (name === "personal_os_review") return reviewProposal(args);
  if (name === "personal_os_status") {
    const proposal = await approvalStatus(args.root, args.proposalId);
    return toolResult({ card: proposalCard(proposal), proposal });
  }
  return toolResult({ error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } }, { isError: true });
}

async function handleRequest(message) {
  if (message.method === "initialize") {
    clientCapabilities = message.params?.capabilities ?? {};
    clientInfo = message.params?.clientInfo ?? {};
    return {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: "Preview first. In Codex, render approval-visual instead of native form elicitation. In other clients, use interactive review when available. Never apply a proposal after its digest changes.",
    };
  }
  if (message.method === "ping") return {};
  if (message.method === "tools/list") return { tools: TOOLS };
  if (message.method === "tools/call") return callTool(message.params);
  throw Object.assign(new Error(`Method not found: ${message.method}`), { code: -32601 });
}

function handleMessage(message) {
  if (message.id !== undefined && (message.result !== undefined || message.error !== undefined) && !message.method) {
    const item = pending.get(String(message.id));
    if (!item) return;
    pending.delete(String(message.id));
    if (message.error) item.reject(Object.assign(new Error(message.error.message ?? "Client request failed"), { code: message.error.code, data: message.error.data }));
    else item.resolve(message.result);
    return;
  }
  if (!message.method || message.id === undefined) return;
  Promise.resolve(handleRequest(message)).then(
    (result) => send({ jsonrpc: "2.0", id: message.id, result }),
    (error) => {
      const payload = errorPayload(error);
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: Number.isInteger(error?.code) ? error.code : -32000,
          message: payload.error.message,
          data: payload.error,
        },
      });
    },
  );
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
lines.on("line", (line) => {
  if (!line.trim()) return;
  try {
    handleMessage(JSON.parse(line));
  } catch (error) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error", data: { message: error.message } } });
  }
});

lines.on("close", () => {
  for (const item of pending.values()) item.reject(new Error("MCP client disconnected"));
  pending.clear();
});
