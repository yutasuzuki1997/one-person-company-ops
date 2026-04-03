'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_ENTRIES = 1000;

// ワークスペースディレクトリ（.onecompanyops配下）またはローカルフォールバック
function getLogFilePath() {
  const workspaceDir = path.join(os.homedir(), '.onecompanyops-workspace', '.onecompanyops');
  if (fs.existsSync(path.join(os.homedir(), '.onecompanyops-workspace'))) {
    try {
      fs.mkdirSync(workspaceDir, { recursive: true });
      return path.join(workspaceDir, 'activity-log.json');
    } catch {}
  }
  // フォールバック：ホームディレクトリ直下
  return path.join(os.homedir(), '.onecompanyops-activity-log.json');
}

function readLog() {
  const file = getLogFilePath();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function writeLog(entries) {
  const file = getLogFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entries, null, 2), 'utf8');
  } catch (e) {
    console.error('[activity-logger] write error:', e.message);
  }
}

/**
 * アクティビティを記録する
 * @param {Object} entry
 * @param {string} entry.agentId
 * @param {string} entry.agentName
 * @param {string} [entry.sectionName]
 * @param {string} [entry.taskId]
 * @param {string} [entry.taskName]
 * @param {string} entry.action  - "create"|"update"|"delete"|"pr"|"merge"|"notion_create"|"notion_update"|"sheets_update"|"workspace"
 * @param {string} [entry.destination] - "github"|"notion"|"sheets"|"workspace"
 * @param {string} [entry.destinationName]
 * @param {string} [entry.destinationPath]
 * @param {string} [entry.destinationUrl]
 * @param {string} entry.summary
 * @param {string} [entry.details]
 */
function logActivity(entry) {
  const log = readLog();
  const id = 'act-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const record = {
    id,
    timestamp: new Date().toISOString(),
    agentId: entry.agentId || null,
    agentName: entry.agentName || null,
    sectionName: entry.sectionName || null,
    taskId: entry.taskId || null,
    taskName: entry.taskName || null,
    action: entry.action,
    destination: entry.destination || null,
    destinationName: entry.destinationName || null,
    destinationPath: entry.destinationPath || null,
    destinationUrl: entry.destinationUrl || null,
    summary: entry.summary || '',
    details: entry.details || null,
  };

  log.push(record);

  // 最大1000件を超えた分は古いものから削除
  if (log.length > MAX_ENTRIES) {
    log.splice(0, log.length - MAX_ENTRIES);
  }

  writeLog(log);
  return record;
}

/**
 * アクティビティログを取得する
 * @param {Object} filters
 * @param {string} [filters.agentId]
 * @param {string} [filters.sectionName]
 * @param {string} [filters.taskId]
 * @param {string} [filters.destination]
 * @param {string} [filters.dateFrom]  - ISO string
 * @param {string} [filters.dateTo]    - ISO string
 * @param {number} [filters.limit]     - デフォルト100
 * @returns {Array}
 */
function getActivityLog(filters = {}) {
  const { agentId, sectionName, taskId, destination, dateFrom, dateTo, limit = 100 } = filters;
  let log = readLog();

  // フィルタリング
  if (agentId) log = log.filter((e) => e.agentId === agentId);
  if (sectionName) log = log.filter((e) => e.sectionName === sectionName);
  if (taskId) log = log.filter((e) => e.taskId === taskId);
  if (destination) log = log.filter((e) => e.destination === destination);
  if (dateFrom) {
    const from = new Date(dateFrom).getTime();
    log = log.filter((e) => new Date(e.timestamp).getTime() >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo).getTime();
    log = log.filter((e) => new Date(e.timestamp).getTime() <= to);
  }

  // 新しい順に並べてlimit件返す
  return log.slice(-limit).reverse();
}

module.exports = { logActivity, getActivityLog };
