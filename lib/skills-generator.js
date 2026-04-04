'use strict';

/**
 * Skills自動生成パイプライン
 * エージェントの繰り返しパターンを検出してSkillsファイルを生成する。
 */

const { callModel, selectModel } = require('./model-router');
const { getActivityLog } = require('./activity-logger');
const fs = require('fs');
const path = require('path');

/**
 * パターン・繰り返し作業からSkillsファイルを生成する
 * @param {string} pattern - 繰り返しパターンの説明
 * @param {string} agentName - エージェント名
 * @param {string} targetPath - 保存先パス
 * @param {Object} apiKeys - { anthropicApiKey }
 * @returns {Promise<{success, path, content}>}
 */
async function generateSkillFromPattern(pattern, agentName, targetPath, apiKeys) {
  const systemPrompt = `あなたはSkillsファイルの作成専門家です。
以下のパターン・繰り返し作業からSkillsファイルを生成してください。
形式はMarkdownで、具体的な手順・判断基準・フォーマットを含めてください。
実用的で再利用可能なスキルドキュメントを作成してください。`;

  const model = selectModel(pattern, { estimatedTokens: pattern.length / 4 });

  let response;
  try {
    response = await callModel(model, systemPrompt, [{
      role: 'user',
      content: `以下の繰り返し作業をSkillsファイルとして文書化してください：\n${pattern}\n\n作成者：${agentName}\n\nMarkdown形式で出力してください。`,
    }], apiKeys);
  } catch (e) {
    return { success: false, error: e.message };
  }

  // 保存先ディレクトリを作成
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, response, 'utf-8');

  return { success: true, path: targetPath, content: response };
}

/**
 * 今日作成された新規Skillsファイルを取得する
 * @param {string} skillsDir - core/skillsディレクトリのパス
 * @returns {string[]}
 */
function getNewSkillsToday(skillsDir) {
  const today = new Date().toDateString();
  const results = [];

  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const file of entries) {
      const fullPath = path.join(dir, file);
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      if (stat.isDirectory()) {
        scan(fullPath);
      } else if (file.endsWith('.md') && stat.birthtime.toDateString() === today) {
        results.push(fullPath.replace(skillsDir, '').replace(/^\//, ''));
      }
    }
  }

  scan(skillsDir);
  return results;
}

/**
 * デイリーSkillsレポートを生成する
 * @param {string} skillsDir - core/skillsディレクトリのパス
 * @param {Object} [apiKeys] - { anthropicApiKey } (省略時はレポートのみ生成、LLM不使用)
 * @returns {Promise<{success, report, newSkills}|null>}
 */
async function collectDailySkillsReport(skillsDir, apiKeys) {
  const today = new Date().toISOString().split('T')[0];
  const reportsDir = path.join(skillsDir, 'reports');
  const reportPath = path.join(reportsDir, `${today}-skills-report.md`);

  const newSkills = getNewSkillsToday(skillsDir);
  if (newSkills.length === 0) return null;

  const report = `# Skills更新レポート ${today}\n\n## 新規作成Skills\n${newSkills.map((s) => `- ${s}`).join('\n')}\n\n合計 ${newSkills.length} 件のSkillsが追加されました。`;

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(reportPath, report, 'utf-8');

  return { success: true, report, newSkills, reportPath };
}

/**
 * 繰り返しパターンを検出する
 * @param {string} agentId
 * @param {Array} [activityLog] - 省略時はgetActivityLog()で取得
 * @returns {string[]} 繰り返しパターン一覧
 */
function detectRepetitivePatterns(agentId, activityLog) {
  const log = activityLog || getActivityLog({ agentId, limit: 200 });
  const agentActivities = log.filter((a) => a.agentId === agentId);
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
  generateSkillFromPattern,
  collectDailySkillsReport,
  getNewSkillsToday,
  detectRepetitivePatterns,
};
