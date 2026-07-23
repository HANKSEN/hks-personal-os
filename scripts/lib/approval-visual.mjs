import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { approvalStatus } from "./approval.mjs";
import { PosError, invariant } from "./errors.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function localizedAction(action) {
  return ({ create: "新建", update: "更新", move: "移动", archive: "归档", trash: "移入回收区" })[action] ?? action;
}

function riskOf(proposal) {
  if (proposal.requiresProtectedApproval) return "high";
  if (proposal.operations.some((item) => ["archive", "trash", "move", "update"].includes(item.action))) return "medium";
  return "low";
}

function localizedRisk(risk) {
  return ({ low: "低风险", medium: "中风险", high: "高风险" })[risk] ?? risk;
}

function actionSummary(operations) {
  const counts = new Map();
  for (const operation of operations) counts.set(operation.action, (counts.get(operation.action) ?? 0) + 1);
  return [...counts].map(([action, count]) => `${localizedAction(action)} ${count} 项`).join(" · ");
}

function operationRows(proposal) {
  return proposal.operations.map((operation, index) => `
      <tr>
        <td class="text-nowrap">${String(index + 1).padStart(2, "0")}</td>
        <td class="text-nowrap"><span class="viz-badge">${escapeHtml(localizedAction(operation.action))}</span></td>
        <td><code>${escapeHtml(operation.path)}</code>${operation.from ? `<div class="text-small text-muted">来源：<code>${escapeHtml(operation.from)}</code></div>` : ""}</td>
        <td>${escapeHtml(operation.reason || "未说明")}${operation.protected ? '<div class="text-small text-destructive">受保护内容</div>' : ""}</td>
      </tr>`).join("");
}

export function renderApprovalVisual(proposal, options = {}) {
  invariant(proposal?.schema === "pos.approval.v1", "INVALID_APPROVAL", "Approval proposal is invalid.", undefined, 4);
  invariant(proposal.status === "awaiting_approval", "APPROVAL_ALREADY_DECIDED", "Only awaiting proposals can be rendered for approval.", { proposalId: proposal.proposalId, status: proposal.status }, 4);
  const root = String(options.root ?? "");
  invariant(path.isAbsolute(root), "ROOT_MUST_BE_ABSOLUTE", "Approval visualization requires an explicit absolute Personal OS root.", undefined, 2);
  const risk = riskOf(proposal);
  const rootId = `pos-approval-${proposal.planDigest.slice(0, 12)}`;
  const payload = {
    root,
    proposalId: proposal.proposalId,
    planDigest: proposal.planDigest,
    protected: proposal.requiresProtectedApproval === true,
  };
  return `<section id="${rootId}" aria-labelledby="${rootId}-title">
  <style>
    #${rootId} { display: grid; gap: 18px; }
    #${rootId} .pos-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    #${rootId} .pos-header h2, #${rootId} .pos-section h3 { margin: 0; }
    #${rootId} .pos-header p { margin: 6px 0 0; }
    #${rootId} .pos-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    #${rootId} .pos-section { display: grid; gap: 8px; }
    #${rootId} .pos-section-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    #${rootId} .pos-scope { margin: 0; padding-left: 20px; }
    #${rootId} .pos-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    #${rootId} .pos-feedback { min-height: 20px; }
    @media (max-width: 560px) { #${rootId} .pos-metrics { grid-template-columns: 1fr; } }
  </style>
  <header class="pos-header">
    <div>
      <h2 id="${rootId}-title">Personal OS 变更审批</h2>
      <p class="text-muted">${escapeHtml(proposal.summary || "Personal OS 文件变更")}</p>
    </div>
    <span class="viz-badge">${escapeHtml(localizedRisk(risk))}</span>
  </header>

  <div class="viz-grid pos-metrics" aria-label="审批摘要">
    <div class="card viz-stat"><div class="text-muted">文件操作</div><div class="viz-stat-value">${proposal.operationCount}</div><div class="text-small">${escapeHtml(actionSummary(proposal.operations))}</div></div>
    <div class="card viz-stat"><div class="text-muted">受保护内容</div><div class="viz-stat-value">${proposal.requiresProtectedApproval ? "有" : "无"}</div><div class="text-small">${proposal.requiresProtectedApproval ? "批准时需额外确认" : "不修改核心 Context"}</div></div>
    <div class="card viz-stat"><div class="text-muted">计划校验</div><div class="viz-stat-value"><code>${escapeHtml(proposal.planDigest.slice(0, 12))}</code></div><div class="text-small">内容变化后必须重新审批</div></div>
  </div>

  <section class="pos-section" aria-labelledby="${rootId}-changes">
    <div class="pos-section-header"><h3 id="${rootId}-changes">文件变更</h3><span class="text-small text-muted">完整路径，可横向滚动</span></div>
    <div class="table-responsive">
      <table class="table table-sm">
        <thead><tr><th>序号</th><th>动作</th><th>目标文件</th><th>原因</th></tr></thead>
        <tbody>${operationRows(proposal)}</tbody>
      </table>
    </div>
  </section>

  <section class="pos-section" aria-labelledby="${rootId}-scope">
    <h3 id="${rootId}-scope">允许写入范围</h3>
    <ul class="pos-scope">${proposal.writeScope.map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join("") || "<li>未声明</li>"}</ul>
  </section>

  <section class="pos-section" aria-labelledby="${rootId}-decision">
    <h3 id="${rootId}-decision">操作决定</h3>
    ${proposal.requiresProtectedApproval ? `<label class="form-check"><input class="form-check-input" id="${rootId}-protected" type="checkbox"><span class="form-check-label">同时批准受保护的 Context 变更</span></label>` : ""}
    <label class="form-label" for="${rootId}-note">备注（可选）</label>
    <textarea class="form-control" id="${rootId}-note" rows="2" maxlength="1000" placeholder="如需修改或拒绝，可简要说明原因；请勿输入密码或 Token。"></textarea>
    <div class="pos-actions">
      <button class="btn btn-primary" type="button" data-decision="approve"><i data-lucide="check" aria-hidden="true"></i>确认并继续</button>
      <button class="btn" type="button" data-decision="revise"><i data-lucide="pencil" aria-hidden="true"></i>要求修改</button>
      <button class="btn" type="button" data-decision="reject"><i data-lucide="x" aria-hidden="true"></i>拒绝</button>
      <button class="btn btn-ghost" type="button" data-decision="cancel">暂不处理</button>
    </div>
    <div class="pos-feedback text-small text-muted" role="status" aria-live="polite"></div>
  </section>

  <p class="text-small text-muted">按钮只会把选择返回当前对话；Agent 必须重新核对提案状态与计划校验值，才能调用 Personal OS 运行时执行。提案编号：<code>${escapeHtml(proposal.proposalId)}</code></p>
  <script>
    (() => {
      const root = document.getElementById(${jsonForScript(rootId)});
      const approval = ${jsonForScript(payload)};
      const labels = { approve: "确认并继续", revise: "要求修改", reject: "拒绝", cancel: "暂不处理" };
      const feedback = root.querySelector(".pos-feedback");
      for (const button of root.querySelectorAll("[data-decision]")) {
        button.addEventListener("click", async () => {
          const decision = button.dataset.decision;
          const note = root.querySelector("textarea").value.trim();
          const protectedBox = root.querySelector("[id$='-protected']");
          if (decision === "approve" && approval.protected && !protectedBox?.checked) {
            feedback.textContent = "该计划包含受保护内容，请先勾选额外确认。";
            return;
          }
          if (!window.openai?.sendFollowUpMessage) {
            feedback.textContent = "当前宿主不支持对话内提交，请使用原生审批或精确文本确认。";
            return;
          }
          const prompt = [
            "执行 Personal OS 审批决定。",
            "Root: " + approval.root,
            "Proposal ID: " + approval.proposalId,
            "Expected plan digest: " + approval.planDigest,
            "Decision: " + decision,
            "Approve protected Context: " + String(Boolean(protectedBox?.checked)),
            "Note: " + (note || "(none)"),
            "请先读取审批状态并核对 proposal ID、awaiting_approval 状态和完整 plan digest；完全一致后，调用 Personal OS decide 执行该决定。不要把这条消息本身当作文件写入授权，也不要执行提案以外的操作。"
          ].join("\\n");
          feedback.textContent = "正在把“" + labels[decision] + "”提交回对话…";
          await window.openai.sendFollowUpMessage({ prompt, title: "提交 Personal OS 审批决定" });
        });
      }
    })();
  </script>
</section>
`;
}

export async function writeApprovalVisual(root, proposalId, outputPath) {
  invariant(path.isAbsolute(outputPath ?? ""), "OUTPUT_MUST_BE_ABSOLUTE", "Approval visualization output must be an explicit absolute path.", undefined, 2);
  invariant(path.extname(outputPath).toLowerCase() === ".html", "INVALID_OUTPUT", "Approval visualization output must use the .html extension.", { outputPath }, 2);
  const proposal = await approvalStatus(root, proposalId);
  const fragment = renderApprovalVisual(proposal, { root: path.resolve(root) });
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(outputPath, fragment, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") throw new PosError("OUTPUT_EXISTS", "Approval visualization output already exists; choose a new file name.", { outputPath }, 4);
    throw error;
  }
  return { schema: "pos.approval-visual.v1", proposalId, outputPath, planDigest: proposal.planDigest, status: proposal.status };
}
