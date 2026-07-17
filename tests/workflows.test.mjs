import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { applyChangeset } from "../scripts/lib/changeset.mjs";
import { buildIndex } from "../scripts/lib/indexer.mjs";
import { exists } from "../scripts/lib/io.mjs";
import { createProposal, withSandbox, writeFixture } from "./helpers.mjs";

test("long-form workflow preserves a source and creates separate synthesized Knowledge", async () => {
  await withSandbox(async ({ root }) => {
    const proposal = await createProposal(root, {
      goal: "处理一篇虚构长文",
      writeScope: ["30_Resources/**", "20_Areas/示例领域/Knowledge/**"],
      operations: [
        {
          id: "source",
          action: "create",
          path: "30_Resources/虚构Agent长文.md",
          sourceContent: "---\nid: source-fictional-agent\ntype: source\n---\n# 虚构 Agent 长文\n\n外部作者的虚构观点。\n",
          reason: "preserve source provenance",
        },
        {
          id: "knowledge",
          action: "create",
          path: "20_Areas/示例领域/Knowledge/Agent概念理解.md",
          sourceContent: "---\nid: knowledge-agent-concept\ntype: knowledge\narea: 示例领域\nrelated: [source-fictional-agent]\n---\n# Agent 概念理解\n\n这是基于虚构来源形成的个人理解候选。\n",
          reason: "store synthesis separately",
        },
      ],
    });
    await applyChangeset(root, proposal.changesetPath, { yes: true });
    const indexed = await buildIndex(root);
    assert.equal(indexed.records.find((item) => item.id === "source-fictional-agent")?.type, "source");
    assert.equal(indexed.records.find((item) => item.id === "knowledge-agent-concept")?.type, "knowledge");
  });
});

test("long-form capture can preserve a source without silently creating Knowledge", async () => {
  await withSandbox(async ({ root }) => {
    const proposal = await createProposal(root, {
      goal: "只保存一篇虚构长文",
      writeScope: ["30_Resources/**"],
      operations: [
        {
          id: "source-only",
          action: "create",
          path: "30_Resources/仅保存的虚构长文.md",
          sourceContent: "---\nid: source-only-longform\ntype: source\n---\n# 仅保存的虚构长文\n",
          reason: "capture without synthesis",
        },
      ],
    });
    await applyChangeset(root, proposal.changesetPath, { yes: true });
    const indexed = await buildIndex(root);
    assert.equal(indexed.records.find((record) => record.id === "source-only-longform")?.type, "source");
    assert.equal(indexed.records.some((record) => record.related?.includes("source-only-longform") && record.type === "knowledge"), false);
  });
});

test("public-creation workflow promotes a canonical Artifact and links Data, Experience, and a candidate Principle", async () => {
  await withSandbox(async ({ root }) => {
    await writeFixture(root, "10_Projects/虚构文章/CONTEXT.md", "# 虚构文章\n\nDone when: synthetic publication is recorded.\n");
    await writeFixture(root, "10_Projects/虚构文章/Working/draft.md", "# 工作草稿\n");
    const proposal = await createProposal(root, {
      goal: "完成虚构文章闭环",
      project: "虚构文章",
      area: "示例领域",
      writeScope: ["20_Areas/示例领域/Artifacts/**", "20_Areas/示例领域/Data/**", "20_Areas/示例领域/Experience/**", "20_Areas/示例领域/Principles/**"],
      operations: [
        { id: "artifact", action: "create", path: "20_Areas/示例领域/Artifacts/Articles/虚构文章.md", sourceContent: "---\nid: artifact-fictional-article\ntype: artifact\nstatus: published\narea: 示例领域\n---\n# 虚构文章\n\n唯一正式发布版本。\n", reason: "promote final output" },
        { id: "data", action: "create", path: "20_Areas/示例领域/Data/虚构文章指标.csv", content: "artifact_id,views,click_rate\nartifact-fictional-article,1000,0.12\n", reason: "store synthetic metrics" },
        { id: "experience", action: "create", path: "20_Areas/示例领域/Experience/虚构文章复盘.md", sourceContent: "---\nid: experience-fictional-article\ntype: experience\nsubtype: review\nrelated: [artifact-fictional-article]\n---\n# 虚构文章复盘\n\n一次合成实验结果。\n", reason: "record review" },
        { id: "principle", action: "create", path: "20_Areas/示例领域/Principles/标题原则候选.md", sourceContent: "---\nid: principle-title-candidate\ntype: principle\nstatus: candidate\nrelated: [experience-fictional-article]\n---\n# 标题原则候选\n\n仍需更多实验验证。\n", reason: "store candidate, not stable rule" },
      ],
    });
    await applyChangeset(root, proposal.changesetPath, { yes: true });
    assert.equal(await exists(path.join(root, "20_Areas/示例领域/Artifacts/Articles/虚构文章.md")), true);
    const index = await buildIndex(root);
    assert.equal(index.records.filter((record) => record.id === "artifact-fictional-article").length, 1);
    assert.equal(index.records.find((record) => record.id === "principle-title-candidate")?.status, "candidate");
  });
});

test("SOP-to-Skill workflow links a synthetic Skill Artifact to its Principle", async () => {
  await withSandbox(async ({ root }) => {
    await writeFixture(root, "20_Areas/示例领域/Experience/内容实验.md", "---\nid: experience-content-experiment\ntype: experience\nstatus: completed\n---\n# 内容实验\n");
    await writeFixture(root, "20_Areas/示例领域/Principles/内容生产SOP.md", "---\nid: principle-content-sop\ntype: principle\nstatus: active\nrelated: [experience-content-experiment]\n---\n# 内容生产 SOP\n");
    const proposal = await createProposal(root, {
      goal: "把虚构 SOP 转成 Skill",
      area: "软件项目",
      writeScope: ["20_Areas/软件项目/Artifacts/**"],
      operations: [
        {
          id: "skill",
          action: "create",
          path: "20_Areas/软件项目/Artifacts/Skills/fictional-content-skill/SKILL.md",
          sourceContent: "---\nid: artifact-fictional-skill\ntype: artifact\nsubtype: skill\nrelated: [principle-content-sop, experience-content-experiment]\n---\n# Fictional Content Skill\n\nSynthetic installable candidate only.\n",
          reason: "package the approved method",
        },
      ],
    });
    await applyChangeset(root, proposal.changesetPath, { yes: true });
    const content = await readFile(path.join(root, "20_Areas/软件项目/Artifacts/Skills/fictional-content-skill/SKILL.md"), "utf8");
    assert.match(content, /principle-content-sop/u);
    assert.match(content, /experience-content-experiment/u);
  });
});

test("investment workflow separates source, Knowledge, Decision Experience, review, and candidate Principle", async () => {
  await withSandbox(async ({ root }) => {
    const proposal = await createProposal(root, {
      goal: "完成虚构研究决策研究复盘",
      area: "研究决策",
      writeScope: ["30_Resources/**", "20_Areas/研究决策/Knowledge/**", "20_Areas/研究决策/Experience/**", "20_Areas/研究决策/Principles/**", "20_Areas/研究决策/Data/**"],
      operations: [
        { id: "report", action: "create", path: "30_Resources/虚构产业报告.md", sourceContent: "---\nid: source-fictional-industry\ntype: source\n---\n# 虚构产业报告\n\n全部为合成事实。\n", reason: "preserve source" },
        { id: "data", action: "create", path: "20_Areas/研究决策/Data/虚构指标.csv", content: "source_id,metric,value,as_of\nsource-fictional-industry,demand_index,42,2026-07-01\n", reason: "store timestamped synthetic facts" },
        { id: "model", action: "create", path: "20_Areas/研究决策/Knowledge/虚构产业链模型.md", sourceContent: "---\nid: knowledge-fictional-chain\ntype: knowledge\nrelated: [source-fictional-industry]\n---\n# 虚构产业链模型\n\n## Source facts\n\n合成需求指标为 42。\n\n## AI inference\n\n这可能意味着需求上升，但不确定。\n\n## User judgment\n\n用户尚未确认该判断。\n", reason: "separate facts, inference, and judgment" },
        { id: "decision", action: "create", path: "20_Areas/研究决策/Experience/虚构决策.md", sourceContent: "---\nid: experience-fictional-decision\ntype: experience\nsubtype: decision\n---\n# 虚构决策\n\n选择：仅观察，不执行交易。依据、风险和验证时间均为合成记录。\n", reason: "record user-owned choice" },
        { id: "review", action: "create", path: "20_Areas/研究决策/Experience/虚构结果复盘.md", sourceContent: "---\nid: experience-fictional-review\ntype: experience\nsubtype: review\nrelated: [experience-fictional-decision]\n---\n# 虚构结果复盘\n", reason: "record outcome" },
        { id: "rule", action: "create", path: "20_Areas/研究决策/Principles/仓位规则候选.md", sourceContent: "---\nid: principle-position-candidate\ntype: principle\nstatus: candidate\nrelated: [experience-fictional-decision, experience-fictional-review]\n---\n# 仓位规则候选\n\n需要更多合成案例验证。\n", reason: "retain uncertainty" },
      ],
    });
    await applyChangeset(root, proposal.changesetPath, { yes: true });
    const index = await buildIndex(root);
    assert.equal(index.records.find((record) => record.id === "experience-fictional-decision")?.type, "experience");
    assert.equal(index.records.find((record) => record.id === "principle-position-candidate")?.status, "candidate");
    assert.equal(index.records.some((record) => record.type === "data" && record.path.endsWith("虚构指标.csv")), true);
    assert.match(await readFile(path.join(root, "20_Areas/研究决策/Knowledge/虚构产业链模型.md"), "utf8"), /Source facts[\s\S]*AI inference[\s\S]*User judgment/u);
    assert.equal(index.records.some((record) => /真实交易|真实数据/u.test(record.excerpt)), false);
  });
});
