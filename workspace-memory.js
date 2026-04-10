'use strict';

/**
 * Workspace記憶管理モジュール
 * GitHubのWorkspaceリポジトリをエージェントの長期記憶として使う
 */

const { getFileContent, updateFileContent } = require('./github-connector');

// ── メモリキャッシュ ─────────────────────────────────────────────────────
let memoryCache = { content: null, cachedAt: 0 };
const CACHE_TTL = 300000; // 5分

function clearMemoryCache() {
  memoryCache = { content: null, cachedAt: 0 };
}

// ── Workspaceからファイルを読む ──────────────────────────────────────────
async function loadFileFromWorkspace(filePath, token, owner = 'yutasuzuki1997', repo = 'Workspace') {
  if (!token) return null;
  try {
    const result = await getFileContent(owner, repo, filePath, token, 'read');
    if (result.success && result.data && result.data.content) {
      return Buffer.from(result.data.content, 'base64').toString('utf-8');
    }
    return null;
  } catch (e) {
    console.log(`[memory] ${filePath} 読み込みスキップ:`, e.message);
    return null;
  }
}

// ── Workspaceにファイルを保存する ────────────────────────────────────────
async function saveFileToWorkspace(filePath, content, message, token, owner = 'yutasuzuki1997', repo = 'Workspace') {
  if (!token) {
    console.warn('[memory] GitHubトークン未設定のためWorkspace保存スキップ');
    return { success: false, error: 'GitHubトークン未設定' };
  }
  try {
    const result = await updateFileContent(owner, repo, filePath, content, message, token, 'write');
    if (result.success) {
      console.log(`[memory] Workspaceに保存成功: ${filePath}`);
      clearMemoryCache(); // キャッシュ無効化
    } else {
      console.error(`[memory] Workspace保存失敗: ${result.error}`);
    }
    return result;
  } catch (e) {
    console.error(`[memory] Workspace保存エラー:`, e.message);
    return { success: false, error: e.message };
  }
}

// ── 記憶コンテキストの取得（キャッシュ付き） ──────────────────────────────
async function getMemoryContext(token, owner = 'yutasuzuki1997', repo = 'Workspace') {
  if (!token) return '';

  // キャッシュ有効ならキャッシュを返す
  if (memoryCache.content !== null && Date.now() - memoryCache.cachedAt < CACHE_TTL) {
    return memoryCache.content;
  }

  let context = '\n\n## 記憶・プロジェクト情報\n';
  const memoryFiles = ['memory/projects.md', 'memory/yuta-preferences.md'];

  for (const filePath of memoryFiles) {
    const content = await loadFileFromWorkspace(filePath, token, owner, repo);
    if (content) {
      // コンテキストサイズ制限（各ファイル最大2000文字）
      const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n...(以下省略)' : content;
      context += `\n### ${filePath}\n${truncated}\n`;
    }
  }

  // 直近の作業記録を読む（最新5件）
  try {
    const result = await getFileContent(owner, repo, 'memory', token, 'read');
    // memoryディレクトリ一覧は取得できないがエラーは無視
  } catch {}

  memoryCache = { content: context, cachedAt: Date.now() };
  return context;
}

// ── プロジェクト名判定 ──────────────────────────────────────────────────
function detectProject(taskName) {
  const name = (taskName || '').toLowerCase();
  if (/wavers/.test(name)) return 'wavers';
  if (/あげファンズ|agefans/.test(name)) return 'agefans';
  if (/noborder/.test(name)) return 'noborder';
  if (/rvc|rvalue|realvalue/.test(name)) return 'rvc';
  if (/snsハック/.test(name)) return 'sns-hack';
  if (/backstage/.test(name)) return 'backstage';
  if (/overdue/.test(name)) return 'overdue';
  if (/bizsim/.test(name)) return 'bizsim';
  if (/jiggy|jazz|orchestra/.test(name)) return 'jiggybeats';
  if (/band.?os/.test(name)) return 'band-os';
  if (/x.to.issue|x-to-issue/.test(name)) return 'x-to-issue';
  if (/x.analytics|x-analytics|x.persona/.test(name)) return 'x-analytics';
  if (/kos/.test(name)) return 'kos';
  if (/onecompany|oco/.test(name)) return 'onecompanyops';
  return 'general';
}

// ── タスク完了時のWorkspace自動保存 ──────────────────────────────────────
async function saveCompletionToWorkspace(task, summary, agentName, token) {
  if (!token) return;

  const date = new Date().toISOString().split('T')[0];
  const projectName = detectProject(task.name || '');
  const safeName = (task.name || 'task').replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, '-').slice(0, 30);
  const filePath = `memory/${projectName}/${date}-${safeName}.md`;

  const content = `# ${task.name || 'タスク'}
完了日時：${new Date().toISOString()}
担当：${agentName}
プロジェクト：${projectName}

## 作業内容
${summary || '（詳細なし）'}
`;

  return saveFileToWorkspace(filePath, content, `記録: ${task.name || 'タスク完了'}`, token);
}

// ── 停滞プロジェクト検知 ──────────────────────────────────────────────────
async function detectStaleProjects(token) {
  if (!token) return [];

  const content = await loadFileFromWorkspace('memory/projects.md', token);
  if (!content) return [];

  const staleProjects = [];
  const now = Date.now();
  const threshold = 48 * 3600 * 1000; // 48時間

  const projectBlocks = content.split('## ').slice(1);
  for (const block of projectBlocks) {
    const lastUpdatedMatch = block.match(/最終更新：(\d{4}-\d{2}-\d{2})/);
    if (lastUpdatedMatch) {
      const lastUpdated = new Date(lastUpdatedMatch[1]).getTime();
      if (now - lastUpdated > threshold) {
        const projectName = block.split('\n')[0].trim();
        if (projectName) staleProjects.push(projectName);
      }
    }
  }

  return staleProjects;
}

// ── memory/projects.md 初期ファイル生成 ──────────────────────────────────
function generateProjectsMarkdown() {
  const today = new Date().toISOString().split('T')[0];
  return `# Yuta鈴木のプロジェクト一覧

最終更新：${today}

## Overdue.
- 概要：iOSタスク管理アプリ。エスカレーション型プッシュ通知
- 現状：App Store申請準備中。スクショ素材が未完成がブロッカー
- 担当エージェント：リク（個人事業部長）
- 関連リポジトリ：yutasuzuki1997/overdue（private）
- 次のアクション：スクショ素材の作成
- 最終更新：${today}

## BizSim
- 概要：ビジネスシミュレーションゲーム。React Native + Expo + Supabase
- 現状：Supabaseスキーマ定義が止まっている
- 担当エージェント：リク（個人事業部長）
- 関連リポジトリ：yutasuzuki1997/bizsim（private）
- 次のアクション：Supabaseスキーマの設計・実装
- 最終更新：${today}

## WAVERS
- 概要：ファンクラブサービス（wein社 BACKSTAGE事業部）
- 現状：競合調査実施済み。差別化戦略の策定が必要
- 担当エージェント：カイ（BACKSTAGE事業部長）→ ルカ（WAVERS担当PM）
- 関連リポジトリ：WAVERS-backstage/wavers-workspace（private）
- 次のアクション：差別化戦略の策定
- 最終更新：${today}

## あげファンズ
- 概要：ファンサービス（wein社 BACKSTAGE事業部）
- 現状：企画段階
- 担当エージェント：カイ（BACKSTAGE事業部長）
- 関連リポジトリ：未設定
- 次のアクション：サービス設計
- 最終更新：${today}

## JIGGY BEATS JAZZ ORCHESTRA
- 概要：20名以上のビッグバンド。公式サイトをNext.js+Firebase+Vercelに移行中
- 現状：サイト移行作業中
- 担当エージェント：レイ（音楽事業部長）
- 関連リポジトリ：yutasuzuki1997/band-os（public候補）
- 次のアクション：Next.jsサイトの構築
- 最終更新：${today}

## band-os
- 概要：バンド運営管理ツール（JIGGYBEATSとは別サービス）
- 現状：開発中
- 担当エージェント：レイ（音楽事業部長）
- 関連リポジトリ：yutasuzuki1997/band-os
- 次のアクション：機能要件の整理
- 最終更新：${today}

## X-to-Issue
- 概要：XのポストをGitHub Issueに変換するツール
- 現状：Overdueリポジトリ内。独立リポジトリに移す予定
- 担当エージェント：トム（エンジニア）
- 関連リポジトリ：yutasuzuki1997/overdue内
- 次のアクション：独立リポジトリへの分離
- 最終更新：${today}

## KOS
- 概要：業務委託先プロジェクト
- 現状：稼働中
- 担当エージェント：クレア（業務委託事業部長）
- 関連リポジトリ：未設定
- 次のアクション：定期報告
- 最終更新：${today}

## OneCompanyOps
- 概要：このAIエージェント組織ツール自体
- 現状：GitHub保存・記憶管理・プロジェクト管理を実装中
- 担当エージェント：トム（エンジニア）
- 関連リポジトリ：yutasuzuki1997/one-person-company-ops-yuta
- 次のアクション：エージェント品質向上
- 最終更新：${today}
`;
}

function generatePreferencesMarkdown() {
  return `# Yuta鈴木の好み・判断基準

## 報告スタイル
- 長文より箇条書き+URL形式
- 要点3行以内 → 詳細はGitHubのファイルを参照
- 改行は最小限
- Markdown記号は使わない（**太字**は不要）

## 意思決定スタイル
- スピード重視（完璧より速さ）
- 並行して複数プロジェクトを進める
- データと直感を組み合わせる

## コミュニケーションスタイル
- 敬語は最小限でOK
- 一問一答を好む
- 結論から言う（BLUF形式）
`;
}

// ── memory初期ファイルをWorkspaceに作成 ──────────────────────────────────
async function ensureMemoryFiles(token) {
  if (!token) {
    console.log('[memory] GitHubトークン未設定のためmemory初期化スキップ');
    return;
  }

  const files = [
    { path: 'memory/projects.md', generator: generateProjectsMarkdown },
    { path: 'memory/yuta-preferences.md', generator: generatePreferencesMarkdown },
  ];

  for (const file of files) {
    const existing = await loadFileFromWorkspace(file.path, token);
    if (!existing) {
      console.log(`[memory] ${file.path} が存在しないため作成します`);
      await saveFileToWorkspace(file.path, file.generator(), `初期作成: ${file.path}`, token);
    } else {
      console.log(`[memory] ${file.path} 既に存在`);
    }
  }
}

module.exports = {
  loadFileFromWorkspace,
  saveFileToWorkspace,
  getMemoryContext,
  detectProject,
  saveCompletionToWorkspace,
  detectStaleProjects,
  ensureMemoryFiles,
  clearMemoryCache,
  generateProjectsMarkdown,
  generatePreferencesMarkdown,
};
