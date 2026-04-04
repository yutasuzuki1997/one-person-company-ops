'use strict';

/**
 * 組織階層型エージェント実行エンジン
 * ジェニーからの委託を受け、事業部長→PM→担当の順に
 * 階層的にタスクを実行する。
 */

const fs = require('fs');
const path = require('path');
const { streamAnthropic } = require('./anthropic-stream');
const { getAgentHierarchyLevel, getDivisionHeadForAgent } = require('./company-registry');
const { logActivity, getActivityLog } = require('./activity-logger');

// ── 実行階層の定義 ─────────────────────────────────────────────────────────
const EXECUTION_HIERARCHY = {
  secretary: {
    level: 0,
    canDelegate: ['division_head', 'president_room'],
    reportTo: null,
  },
  division_head: {
    level: 1,
    canDelegate: ['pm', 'specialist'],
    reportTo: 'secretary',
    autoReportConditions: ['blocker', 'resource_conflict', 'scope_change'],
  },
  pm: {
    level: 2,
    canDelegate: ['specialist'],
    reportTo: 'division_head',
    autoReportConditions: ['completed', 'error', 'blocker'],
  },
  specialist: {
    level: 3,
    canDelegate: [],
    reportTo: 'pm',
    autoReportConditions: ['completed', 'error'],
  },
};

// ── テキストパーサー ──────────────────────────────────────────────────────────

function parseDelegateBlocks(text) {
  const re = /###DELEGATE\s+agentId="([^"]+)"\s+task="([^"]+)"(?:\s+progress="(\d+)")?(?:\s+estimatedMinutes="(\d+)")?###/g;
  const results = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push({ agentId: m[1], task: m[2], progress: Number(m[3] || 0), estimatedMinutes: m[4] ? Number(m[4]) : null });
  }
  return results;
}

function parseCompletedBlocks(text) {
  const re = /###COMPLETED\s+agentId="([^"]+)"(?:\s+summary="([^"]*)")?###/g;
  const results = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push({ agentId: m[1], summary: m[2] || '完了' });
  }
  return results;
}

function parseDivisionReportBlock(text) {
  const re = /###DIVISION_REPORT\s+divisionHeadId="([^"]+)"\s+summary="([^"]*)"\s+completedTasks="([^"]*)"\s+issues="([^"]*)"###/;
  const m = re.exec(text);
  if (!m) return null;
  return { divisionHeadId: m[1], summary: m[2], completedTasks: m[3], issues: m[4] };
}

// ── エージェントシステムプロンプト構築 ──────────────────────────────────────

function buildAgentSystemPrompt(agent, skillsDir) {
  const personality = agent.persona?.personality || '';
  const speechStyle = agent.persona?.speechStyle || '';
  const jd = agent.jobDescription || '';

  // スキルファイルの内容を読み込む
  let skillsContent = '';
  if (skillsDir && Array.isArray(agent.skills) && agent.skills.length > 0) {
    for (const skillId of agent.skills) {
      const skillPath = path.join(skillsDir, '..', skillId);
      if (fs.existsSync(skillPath)) {
        try {
          skillsContent += '\n\n## Skill: ' + path.basename(skillId) + '\n' + fs.readFileSync(skillPath, 'utf8');
        } catch {}
      }
    }
  }

  const level = getAgentHierarchyLevel(agent);
  let hierarchyInstructions = '';
  if (level === 1) {
    hierarchyInstructions = `
## あなたの役割（事業部長）
- ジェニーからタスクを受けたら担当範囲内で完結させる
- 配下PM・担当に委託：###DELEGATE agentId="{id}" task="{task}"###
- 全完了後のみジェニーへ報告：###DIVISION_REPORT divisionHeadId="${agent.id}" summary="{要約}" completedTasks="{n}" issues="{問題があれば}"###
- ブロッカー時は即座にDIVISION_REPORT（issuesに内容記入）`;
  } else if (level === 2) {
    hierarchyInstructions = `
## あなたの役割（PM）
- 事業部長からタスクを受けたら担当に分解して委託する
- 担当者への委託：###DELEGATE agentId="{id}" task="{task}"###
- 完了報告：###COMPLETED agentId="${agent.id}" summary="{完了内容}"###`;
  } else if (level >= 3) {
    hierarchyInstructions = `
## あなたの役割（担当）
- タスクを実行し、完了したら報告する
- 完了報告：###COMPLETED agentId="${agent.id}" summary="{完了内容}"###
- 自分でできないことのみPMにエスカレーション`;
  }

  return `あなたは${agent.displayName || agent.name}（${agent.role}）です。
${personality ? `性格: ${personality}` : ''}
${speechStyle ? `話し方: ${speechStyle}` : ''}
${jd ? `\n## 職務内容\n${jd}` : ''}
${hierarchyInstructions}
${skillsContent}

日本語で返答すること。`;
}

// ── AgentExecutor クラス ─────────────────────────────────────────────────────

class AgentExecutor {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey - Anthropic API key
   * @param {string} opts.model - Model name
   * @param {string} opts.companyId
   * @param {Array}  opts.agents - All agents in company
   * @param {Function} opts.broadcast - broadcastToCompany callback
   * @param {string} [opts.skillsDir] - core/skills directory path
   */
  constructor({ apiKey, model, companyId, agents, broadcast, skillsDir }) {
    this.apiKey = apiKey;
    this.model = model;
    this.companyId = companyId;
    this.agents = agents;
    this.broadcast = broadcast || (() => {});
    this.skillsDir = skillsDir || null;
  }

  /**
   * エージェントにタスクを実行させる
   * @param {Object} agent
   * @param {string} task
   * @param {string} taskId
   * @param {number} [depth] - 再帰深度（無限ループ防止）
   * @returns {Promise<{response, delegations, completions, divisionReport}>}
   */
  async execute(agent, task, taskId, depth = 0) {
    if (depth > 6) {
      console.warn(`[AgentExecutor] Max depth exceeded for agent ${agent.id}`);
      return { error: 'Max recursion depth exceeded', response: '' };
    }

    const system = buildAgentSystemPrompt(agent, this.skillsDir);
    console.log(`[AgentExecutor] Executing: ${agent.displayName || agent.name} (level ${getAgentHierarchyLevel(agent)}) depth=${depth}`);

    this.broadcast({ type: 'stream_start', agentId: agent.id, taskId });

    let fullResponse = '';
    try {
      await streamAnthropic({
        apiKey: this.apiKey,
        model: this.model,
        system,
        messages: [{ role: 'user', content: task }],
        onText: (chunk) => {
          fullResponse += chunk;
        },
      });
    } catch (e) {
      console.error(`[AgentExecutor] API error for ${agent.id}:`, e.message);
      this.broadcast({ type: 'stream_end', agentId: agent.id, taskId });
      return { error: e.message, response: '' };
    }

    this.broadcast({ type: 'stream_end', agentId: agent.id, taskId });
    console.log(`[AgentExecutor] Response from ${agent.displayName || agent.name}: ${fullResponse.slice(0, 100)}...`);

    // DELEGATE ブロック処理
    const delegations = parseDelegateBlocks(fullResponse);
    const completions = parseCompletedBlocks(fullResponse);
    const divisionReport = parseDivisionReportBlock(fullResponse);

    // サブエージェントへの委託実行
    for (const delegation of delegations) {
      const subAgent = this.agents.find((a) => a.id === delegation.agentId);
      if (subAgent) {
        console.log(`[AgentExecutor] Sub-delegating to: ${subAgent.displayName || subAgent.name}`);
        await this.execute(subAgent, delegation.task, taskId, depth + 1);
      } else {
        console.warn(`[AgentExecutor] Sub-agent not found: ${delegation.agentId}`);
      }
    }

    // 完了ブロック処理
    for (const completion of completions) {
      if (completion.agentId === agent.id) {
        await this.handleCompletion(agent, taskId, completion.summary, null, null);
      }
    }

    // DIVISION_REPORT処理はserver.jsのSSE処理ブロックで行うため、
    // ここではbroadcastのみ
    if (divisionReport) {
      this.broadcast({
        type: 'division_report',
        divisionHeadId: divisionReport.divisionHeadId,
        summary: divisionReport.summary,
        completedTasks: divisionReport.completedTasks,
        issues: divisionReport.issues,
      });
    }

    logActivity({
      agentId: agent.id,
      agentName: agent.displayName || agent.name,
      taskId,
      action: 'agent_execute',
      summary: `タスク実行完了: ${task.slice(0, 50)}`,
    });

    return { response: fullResponse, delegations, completions, divisionReport };
  }

  /**
   * 複数エージェントへの並列実行
   * @param {Array<{agent, task}>} delegations
   * @param {string} taskId
   * @returns {Promise<Array>}
   */
  async executeParallel(delegations, taskId) {
    const promises = delegations.map(({ agent, task }) =>
      this.execute(agent, task, taskId)
    );
    return Promise.allSettled(promises);
  }

  /**
   * 完了報告の階層的上申
   * エージェントが完了したとき、上位の事業部長またはジェニーに報告する
   */
  async handleCompletion(agent, taskId, summary, savedTo, savedPath) {
    const divisionHead = getDivisionHeadForAgent(agent, this.agents);

    if (divisionHead && divisionHead.id !== agent.id) {
      // 事業部長に完了報告を渡す
      const savedInfo = savedTo && savedPath ? `保存先：${savedTo}/${savedPath}` : '';
      const reportTask = `${agent.displayName || agent.name}が以下のタスクを完了しました：
${summary}
${savedInfo}

この報告を受けて、ジェニーへの報告が必要かどうか判断してください。
必要な場合のみ###DIVISION_REPORT###を送信してください。
不要な場合は「了解、記録しました」のみ返答してください。`;

      console.log(`[AgentExecutor] Escalating completion to division head: ${divisionHead.displayName || divisionHead.name}`);
      await this.execute(divisionHead, reportTask, taskId);
    } else {
      // 事業部長なし（社長室直属）→ 直接ジェニーへ通知
      this.broadcast({
        type: 'agent_completed',
        agentId: agent.id,
        agentName: agent.displayName || agent.name,
        message: `${agent.displayName || agent.name}が完了しました：${summary}`,
        taskId,
      });
    }
  }
}

// ── 繰り返しパターン検出 ─────────────────────────────────────────────────────

/**
 * 同一エージェントが3回以上実行した繰り返しパターンを検出する
 */
function detectRepetitivePatterns(agentId, activityLog) {
  const agentActivities = activityLog.filter((a) => a.agentId === agentId);
  const summaryGroups = {};
  for (const activity of agentActivities) {
    const key = (activity.summary || '').slice(0, 30).trim();
    if (!key) continue;
    summaryGroups[key] = (summaryGroups[key] || 0) + 1;
  }
  return Object.entries(summaryGroups)
    .filter(([, count]) => count >= 3)
    .map(([pattern]) => pattern);
}

module.exports = {
  AgentExecutor,
  EXECUTION_HIERARCHY,
  buildAgentSystemPrompt,
  parseDelegateBlocks,
  parseCompletedBlocks,
  parseDivisionReportBlock,
  detectRepetitivePatterns,
};
