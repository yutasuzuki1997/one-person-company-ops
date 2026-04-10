'use strict';

/**
 * 組織階層型エージェント実行エンジン
 * ジェニーからの委託を受け、事業部長→PM→担当の順に
 * 階層的にタスクを実行する。
 */

const fs = require('fs');
const path = require('path');
const { streamAnthropic, completeWithTools } = require('./anthropic-stream');
const { getAgentHierarchyLevel, getDivisionHeadForAgent } = require('./company-registry');
const { logActivity, getActivityLog } = require('./activity-logger');
const { updateFileContent } = require('./github-connector');

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

// ── Web検索が必要なタスクの判定 ─────────────────────────────────────────────
const RESEARCH_KEYWORDS = ['調査', 'リサーチ', '検索', '競合', '市場', 'トレンド', '最新', '動向', '分析', '比較', '事例', 'ニュース', '情報収集', 'サーベイ', 'PV', 'アクセス数', '価格', '料金', 'プラン'];

function taskNeedsWebSearch(task) {
  return RESEARCH_KEYWORDS.some(kw => task.includes(kw));
}

const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 10,
};

// ── エージェントシステムプロンプト構築 ──────────────────────────────────────

function buildAgentSystemPrompt(agent, skillsDir, allAgents, workspace) {
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

### 最重要：あなたは管理職です
- あなたは絶対に自分で調査・実装・作成・分析をしません
- web_searchツールは使いません。調査が必要なタスクは必ず配下に委託します
- あなたの仕事は「タスク分解」「配下への委託（DELEGATE）」「報告の集約」の3つだけです
- 自分で作業を始めそうになったら、必ず立ち止まってDELEGATEブロックを出力してください

### タスク受領時
1. タスクの全体像を把握する
2. 担当範囲内のPM・エージェントに分解して割り当てる
3. ###DELEGATE agentId="{id}" task="{task}"### で各担当に指示する
4. DELEGATEブロックを出力したら、それ以上の作業は行わない

### 禁止事項（厳守）
- 自分でWeb検索すること → 必ずDELEGATEで配下に委託する
- 自分でレポートを書くこと → 配下の報告を集約するだけ
- 自分で分析・調査すること → 配下に任せる
- DELEGATEなしでタスクを完了すること → 必ず配下を使う

### 進捗管理
- 各担当からの完了報告を受け取る
- ブロッカーがある場合のみジェニーに報告する
- 全担当完了後にジェニーにまとめて報告する

### ジェニーへの報告（完了時・必須）
###DIVISION_REPORT divisionHeadId="${agent.id}" summary="{3行以内のまとめ}" completedTasks="{完了タスク数}" issues="{問題があれば}"###

### 能動的な行動原則
- タスクが完了したら必ず上位（ジェニー）に報告する
- 報告なしで終わることは絶対にしない
- 次のアクションを必ず提案する
${Array.isArray(allAgents) ? (() => {
  const agentRole = agent.role || '';
  const dept = agentRole.split('・')[0] || '';
  const subs = allAgents.filter(a => a.id !== agent.id && (a.role || '').startsWith(dept));
  if (subs.length === 0) return '';
  return '\n### 配下エージェント一覧（DELEGATEで使うID）\n' + subs.map(a => `- ${a.id}: ${a.displayName || a.name}（${a.role}）`).join('\n');
})() : ''}`;
  } else if (level === 2) {
    hierarchyInstructions = `
## あなたの役割（PM）
- 事業部長からタスクを受けたら担当に分解して委託する
- 担当者への委託：###DELEGATE agentId="{id}" task="{task}"###
- 完了報告（必須）：###COMPLETED agentId="${agent.id}" summary="{完了内容}"###
- 完了報告なしで終わることは絶対にしない`;
  } else if (level >= 3) {
    hierarchyInstructions = `
## あなたの役割（担当）
- タスクを実行し、完了したら報告する
- 完了報告（必須）：###COMPLETED agentId="${agent.id}" summary="{完了内容}"###
- 完了報告なしで終わることは絶対にしない
- 自分でできないことのみPMにエスカレーション`;
  }

  // リソース情報を注入
  let resourcesContent = '';
  if (Array.isArray(agent.resources) && agent.resources.length > 0) {
    const groups = {};
    for (const r of agent.resources) {
      if (!groups[r.type]) groups[r.type] = [];
      groups[r.type].push(r);
    }
    resourcesContent = '\n## あなたが利用できるリソース\n';
    if (groups.github) {
      resourcesContent += '\n### GitHubリポジトリ\n';
      for (const r of groups.github) {
        resourcesContent += `- ${r.name}（${r.owner}/${r.repo}）: ${r.permission || 'read'}\n  操作: ###FILE_CREATE### ###FILE_UPDATE### ###PR_REQUEST###\n`;
      }
    }
    if (groups.googleSheets) {
      resourcesContent += '\n### Google Sheets\n';
      for (const r of groups.googleSheets) {
        resourcesContent += `- ${r.name}（ID: ${r.spreadsheetId}）: ${r.permission || 'read'}\n  操作: ###SHEETS_READ spreadsheetId="${r.spreadsheetId}"### ###SHEETS_UPDATE spreadsheetId="${r.spreadsheetId}"###\n`;
      }
    }
    if (groups.notion) {
      resourcesContent += '\n### Notion\n';
      for (const r of groups.notion) {
        resourcesContent += `- ${r.name}（ID: ${r.databaseId}）: ${r.permission || 'read'}\n  操作: ###NOTION_QUERY databaseId="${r.databaseId}"### ###NOTION_UPDATE pageId="{pageId}"###\n`;
      }
    }
    if (groups.ga4) {
      resourcesContent += '\n### GA4\n';
      for (const r of groups.ga4) {
        resourcesContent += `- ${r.name}（プロパティID: ${r.propertyId}）: 読み取りのみ\n  操作: ###GA4_REPORT propertyId="${r.propertyId}"###\n`;
      }
    }
    if (groups.mixpanel) {
      resourcesContent += '\n### Mixpanel\n';
      for (const r of groups.mixpanel) {
        resourcesContent += `- ${r.name}（プロジェクトID: ${r.projectId}）: 読み取りのみ\n  操作: ###MIXPANEL_EVENTS projectId="${r.projectId}"###\n`;
      }
    }
  }

  const agentPrinciples = `
## 絶対原則

- タスクを受けたら必ずやり切る
- 「できないかもしれない」「問題があるかもしれない」は絶対に言わない
- 完了したら必ず###COMPLETED###ブロックで報告する（報告なしで終わるのは禁止）
- 問題が発生しても自分で解決策を考えて実行する
- 判断に迷ったらより保守的な方を選んで進める
- 判断を上位に丸投げしない（選択肢を提示した上で推奨を示すこと）

## 能動的行動原則

### 作業中
- 進捗は###PROGRESS agentId="${agent.id}" progress="{0-100}" currentTask="{内容}"###で報告する

### 作業完了時（最重要）
- 必ず###COMPLETED###ブロックで完了を報告する
- 完了報告には以下を含める：
  1. 何をしたか（具体的に）
  2. 結果・成果物
  3. 次にやるべきこと（推奨アクション）

## 完了報告の形式
###COMPLETED agentId="${agent.id}" summary="{何をしたか・結果・次のアクション}"###

## Web検索の品質基準（調査タスク）

調査・リサーチ・競合分析タスクでは、必ず複数回のWeb検索を実行すること：
- 最低3回以上のWeb検索を実行する（異なるキーワードで検索する）
- 例：競合調査なら「{サービス名} 競合」「{業界} 比較 料金」「{サービス名} 特徴 口コミ」など
- 1回の検索で満足せず、異なる角度から情報を収集する
- 検索結果のURL・数値・料金は必ずレポートに含める

## 完了報告の品質基準（厳守）

COMPLETEDブロックを出す前に以下を確認すること：
1. web_searchを使った場合、検索結果の具体的なデータ（URL・数値・料金等）をsummaryに含めること
2. 「〜します」「〜予定です」「〜を開始します」でCOMPLETEDを出すことは禁止。実際に作業が完了してからCOMPLETEDを出す
3. summaryには実際に取得・作成したデータを含めること
4. 調査タスクの場合、最低5つの具体的な情報（サービス名・料金・特徴など）を含めること
5. 「調査を実施しました」のような抽象的な報告は禁止。具体的な結果を書く

## 成果物の保存ルール（調査・分析・レポート）

調査・分析・レポート作成タスクを実行した場合、結果をチャットに長文で貼るのではなく、
GitHubリポジトリにmarkdownファイルとして保存すること。

### 保存手順
1. 調査結果をmarkdown形式でまとめる
2. 利用可能なGitHubリポジトリがある場合、###FILE_CREATE###ブロックで保存する
3. ファイルパスは reports/{テーマ}-{日付YYYY-MM-DD}.md の形式にする
4. COMPLETEDのsummaryにはファイルパスと調査の要点（3行以内）を含める

### FILE_CREATE構文${workspace && workspace.owner ? `（Workspaceリポジトリ: owner="${workspace.owner}" repo="${workspace.repo}"）` : ''}
###FILE_CREATE owner="${workspace && workspace.owner ? workspace.owner : '{owner}'}" repo="${workspace && workspace.repo ? workspace.repo : '{repo}'}" path="reports/{filename}.md" content="{markdownの内容}" agentId="${agent.id}" taskId="{taskId}" summary="{説明}"###

### 保存が必要なタスクの例
- 競合調査、市場調査
- 分析レポート
- 戦略ドキュメント
- 技術調査
`;

  return `あなたは${agent.displayName || agent.name}（${agent.role}）です。
${personality ? `性格: ${personality}` : ''}
${speechStyle ? `話し方: ${speechStyle}` : ''}
${jd ? `\n## 職務内容\n${jd}` : ''}
${agentPrinciples}
${hierarchyInstructions}
${resourcesContent}
${skillsContent}

## 最重要ルール
以下のタスクのみを実行してください。タスクの範囲を超えた作業は禁止です。

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
  constructor({ apiKey, model, companyId, agents, broadcast, skillsDir, saveTaskMessage, githubToken, workspace }) {
    this.apiKey = apiKey;
    this.model = model;
    this.companyId = companyId;
    this.agents = agents;
    this.broadcast = broadcast || (() => {});
    this.skillsDir = skillsDir || null;
    this.saveTaskMessage = saveTaskMessage || (() => {});
    this.githubToken = githubToken || null;
    this.workspace = workspace || null; // { owner, repo }
  }

  /**
   * エージェントにタスクを実行させる
   * @param {Object} agent
   * @param {string} task
   * @param {string} taskId
   * @param {number} [depth] - 再帰深度（無限ループ防止）
   * @returns {Promise<{response, delegations, completions, divisionReport}>}
   */
  async execute(agent, task, taskId, depth = 0, onProgress = null, weight = 'light') {
    if (depth > 6) {
      console.warn(`[AgentExecutor] Max depth reached for ${agent.displayName || agent.name}, completing with last state`);
      const finalSummary = `${depth}回の処理を実行しました。最終状態：${task.slice(0, 100)}`;
      await this.handleCompletion(agent, taskId, finalSummary, null, null);
      return { success: true, response: finalSummary, delegations: [], completions: [] };
    }

    const system = buildAgentSystemPrompt(agent, this.skillsDir, this.agents, this.workspace);
    console.log(`[AgentExecutor] Executing: ${agent.displayName || agent.name} (level ${getAgentHierarchyLevel(agent)}) depth=${depth}`);

    this.broadcast({ type: 'stream_start', agentId: agent.id, taskId });

    // Web検索が必要なタスクかどうか判定（事業部長は委託するので自分では検索しない）
    const agentLevel = getAgentHierarchyLevel(agent);
    const needsSearch = agentLevel >= 2 && taskNeedsWebSearch(task);
    let fullResponse = '';

    try {
      if (needsSearch) {
        // Web検索付きAPI呼び出し（非ストリーミング）
        console.log(`[AgentExecutor] Web検索付きで実行: ${agent.displayName || agent.name}`);
        const result = await completeWithTools({
          apiKey: this.apiKey,
          model: this.model,
          system,
          messages: [{ role: 'user', content: task }],
          tools: [WEB_SEARCH_TOOL],
          maxTokens: 8192,
        });
        fullResponse = result.text;
        if (result.searchResults.length > 0) {
          console.log(`[AgentExecutor] Web検索実行: ${result.searchResults.length}件の検索結果を取得`);
        }
      } else {
        // 通常のストリーミングAPI呼び出し
        await streamAnthropic({
          apiKey: this.apiKey,
          model: this.model,
          system,
          messages: [{ role: 'user', content: task }],
          onText: (chunk) => {
            fullResponse += chunk;
          },
        });
      }
    } catch (e) {
      console.error(`[AgentExecutor] API error for ${agent.id}:`, e.message);
      this.broadcast({ type: 'stream_end', agentId: agent.id, taskId });
      return { error: e.message, response: '' };
    }

    this.broadcast({ type: 'stream_end', agentId: agent.id, taskId });
    console.log(`[AgentExecutor] Response from ${agent.displayName || agent.name}: ${fullResponse.slice(0, 100)}...`);

    // エージェントのレスポンスをリアルタイムでチャットに流す
    const cleanText = fullResponse.replace(/###[^#]*###/g, '').trim();
    if (cleanText && onProgress) {
      onProgress({
        agentId: agent.id,
        agentName: agent.displayName || agent.name,
        agentAvatar: agent.avatar || '🤖',
        message: cleanText,
        role: 'agent',
        type: 'agent_message',
      });
    }

    // 空レスポンスチェック
    if (!fullResponse || fullResponse.trim().length < 10) {
      console.log(`[AgentExecutor] 空レスポンス: ${agent.displayName || agent.name}`);
      return { response: fullResponse, delegations: [], completions: [] };
    }

    // DELEGATE ブロック処理
    const delegations = parseDelegateBlocks(fullResponse);
    const completions = parseCompletedBlocks(fullResponse);
    const divisionReport = parseDivisionReportBlock(fullResponse);

    // タスクと無関係な作業を検出（初回実行・DELEGATE/COMPLETEDなしの場合のみ）
    if (depth === 0 && delegations.length === 0 && completions.length === 0 && !divisionReport) {
      const taskKeywords = task.split(/\s+/).slice(0, 5);
      const isRelevant = taskKeywords.some(kw =>
        kw.length > 2 && fullResponse.includes(kw)
      );
      if (!isRelevant && !this._retried) {
        console.log(`[AgentExecutor] 無関係な作業を検出: ${agent.displayName || agent.name}`);
        this._retried = true;
        const retryTask = `タスクを再確認してください：${task}\n\n上記のタスクのみを実行してください。`;
        return this.execute(agent, retryTask, taskId, depth, onProgress, weight);
      }
    }

    console.log(`[AgentExecutor] ブロック検知: ${agent.displayName || agent.name} - DELEGATE=${delegations.length}, COMPLETED=${completions.length}, DIVISION_REPORT=${!!divisionReport}`);

    // サブエージェントへの委託実行
    for (const delegation of delegations) {
      const subAgent = this.agents.find((a) => a.id === delegation.agentId);
      if (subAgent) {
        console.log(`[AgentExecutor] Sub-delegating to: ${subAgent.displayName || subAgent.name}`);
        await this.execute(subAgent, delegation.task, taskId, depth + 1, onProgress, weight);
      } else {
        console.warn(`[AgentExecutor] Sub-agent not found: ${delegation.agentId}`);
      }
    }

    // 完了ブロック処理
    for (const completion of completions) {
      console.log(`[AgentExecutor] COMPLETED検知: ${agent.displayName || agent.name} summary=${(completion.summary || '').slice(0, 50)}`);
      if (completion.agentId === agent.id) {
        await this.handleCompletion(agent, taskId, completion.summary, null, null);
      }
    }

    // FILE_CREATE ブロック処理（エージェントがGitHubにファイルを作成）
    const fileCreateRe = /###FILE_CREATE\s+owner="([^"]+)"\s+repo="([^"]+)"\s+path="([^"]+)"\s+content="([^"]*?)"\s+agentId="([^"]*)"\s+taskId="([^"]*)"\s+summary="([^"]*)"###/g;
    let fcMatch;
    while ((fcMatch = fileCreateRe.exec(fullResponse)) !== null) {
      const [, fcOwner, fcRepo, fcPath, fcContent, fcAgentId, fcTaskId, fcSummary] = fcMatch;
      // Workspace fallback: エージェントがowner/repoを間違えた場合、workspace設定を使う
      let finalOwner = fcOwner;
      let finalRepo = fcRepo;
      if (this.workspace && this.workspace.owner) {
        // Workspaceリポジトリへの操作の場合はworkspace設定を優先
        if (fcRepo.toLowerCase() === 'workspace' || fcRepo === this.workspace.repo) {
          finalOwner = this.workspace.owner;
          finalRepo = this.workspace.repo;
        }
      }
      console.log(`[AgentExecutor] FILE_CREATE検知: ${agent.displayName || agent.name} → ${finalOwner}/${finalRepo}/${fcPath}`);
      if (!this.githubToken) {
        console.warn(`[AgentExecutor] GitHubトークン未設定のためFILE_CREATEをスキップ: ${fcPath}`);
        this.broadcast({ type: 'file_create_skipped', path: fcPath, reason: 'GitHubトークン未設定' });
      } else {
        try {
          const fcResult = await updateFileContent(finalOwner, finalRepo, fcPath, fcContent, fcSummary || 'Create by OneCompanyOps', this.githubToken, 'write');
          if (fcResult.success) {
            const fileUrl = `https://github.com/${finalOwner}/${finalRepo}/blob/main/${fcPath}`;
            console.log(`[AgentExecutor] GitHubに保存成功: ${finalOwner}/${finalRepo}/${fcPath}`);
            logActivity({
              agentId: fcAgentId || agent.id,
              agentName: agent.displayName || agent.name,
              taskId: fcTaskId || taskId,
              action: 'create',
              destination: 'github',
              destinationName: `${finalOwner}/${finalRepo}`,
              destinationPath: fcPath,
              destinationUrl: fileUrl,
              summary: fcSummary || `ファイル作成: ${fcPath}`,
            });
            this.broadcast({ type: 'file_created', owner: finalOwner, repo: finalRepo, path: fcPath, url: fileUrl });
          } else {
            console.error(`[AgentExecutor] GitHubに保存失敗: ${fcResult.error}`);
            this.broadcast({ type: 'file_create_error', path: fcPath, error: fcResult.error });
          }
        } catch (e) {
          console.error(`[AgentExecutor] FILE_CREATE error:`, e.message);
          this.broadcast({ type: 'file_create_error', path: fcPath, error: e.message });
        }
      }
    }

    // COMPLETEDもDELEGATEもない場合のログ
    if (completions.length === 0 && delegations.length === 0 && !divisionReport) {
      console.log(`[AgentExecutor] ブロックなしで終了: ${agent.displayName || agent.name} (depth=${depth})`);
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

    const agentName = agent.displayName || agent.name;
    // 完了報告は3行以内にコンパクト化
    const compactSummary = summary
      ? summary.split('\n').filter(l => l.trim()).slice(0, 3).join('\n')
      : '作業完了';
    const completionMsg = `✅ ${agentName}が完了\n${compactSummary}`;

    // タスクにメッセージを保存（常に実行）
    this.saveTaskMessage(taskId, {
      role: 'agent',
      content: completionMsg,
      agentId: agent.id,
      agentName,
      agentAvatar: agent.avatar || '🤖',
      timestamp: new Date().toISOString(),
    });

    if (divisionHead && divisionHead.id !== agent.id) {
      // 事業部長に直接完了報告（APIコスト節約のためDIVISION_REPORTを直接生成）
      const divHeadName = divisionHead.displayName || divisionHead.name;
      console.log(`[AgentExecutor] 完了報告: ${agentName} → ${divHeadName} → ジェニー`);
      this.broadcast({
        type: 'division_report',
        divisionHeadId: divisionHead.id,
        summary: compactSummary,
        completedTasks: '1',
        issues: '',
      });
      this.broadcast({ type: 'agent_completed', agentId: agent.id, agentName, message: completionMsg, taskId, success: true });
    } else {
      // 社長室直属 or 事業部長なし → 直接ジェニーへ通知
      console.log(`[AgentExecutor] 直接完了報告: ${agentName} → ジェニー`);
      this.broadcast({ type: 'agent_completed', agentId: agent.id, agentName, message: completionMsg, taskId, success: true });
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
