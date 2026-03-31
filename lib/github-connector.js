'use strict';

// @octokit/rest v21+ は ESM only のため動的 import() で読み込む
let _Octokit = null;
async function getOctokit() {
  if (!_Octokit) {
    const mod = await import('@octokit/rest');
    _Octokit = mod.Octokit;
  }
  return _Octokit;
}

async function makeOctokit(token) {
  const Octokit = await getOctokit();
  return new Octokit({ auth: token });
}

// 権限レベル定義
const PERMISSION_LEVEL = { read: 1, write: 2, pr: 3 };

/**
 * 認証ユーザーがアクセスできるリポジトリ一覧を返す
 */
async function listRepositories(token) {
  try {
    const octokit = await makeOctokit(token);
    const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort: 'updated',
    });
    return {
      success: true,
      data: repos.map((r) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        description: r.description,
        html_url: r.html_url,
        default_branch: r.default_branch,
        updated_at: r.updated_at,
      })),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * ファイル内容を取得する（read 以上の権限が必要）
 * @param {string} permission  "read" | "write" | "pr"
 */
async function getFileContent(owner, repo, filePath, token, permission = 'read') {
  if ((PERMISSION_LEVEL[permission] ?? 0) < PERMISSION_LEVEL.read) {
    return { success: false, error: 'このリポジトリへのアクセス権限がありません' };
  }
  try {
    const octokit = await makeOctokit(token);
    const { data } = await octokit.repos.getContent({ owner, repo, path: filePath });
    if (Array.isArray(data)) {
      return { success: false, error: `${filePath} はファイルではなくディレクトリです` };
    }
    return {
      success: true,
      data: {
        name: data.name,
        path: data.path,
        sha: data.sha,
        size: data.size,
        encoding: data.encoding,
        content: data.content,
        html_url: data.html_url,
      },
    };
  } catch (e) {
    if (e.status === 404) return { success: true, data: null };
    return { success: false, error: e.message };
  }
}

/**
 * ファイルを作成または更新する（write 以上の権限が必要）
 * @param {string} permission  "read" | "write" | "pr"
 */
async function updateFileContent(owner, repo, filePath, content, message, token, permission = 'read') {
  if ((PERMISSION_LEVEL[permission] ?? 0) < PERMISSION_LEVEL.write) {
    return { success: false, error: 'このリポジトリは読み取り専用です' };
  }
  try {
    const octokit = await makeOctokit(token);
    const commitMessage = message || 'Update by OneCompanyOps';

    const isBase64 = /^[A-Za-z0-9+/\n]+=*\n?$/.test(content);
    const encodedContent = isBase64 ? content : Buffer.from(content).toString('base64');

    let fileSha;
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path: filePath });
      if (!Array.isArray(data)) fileSha = data.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    const params = { owner, repo, path: filePath, message: commitMessage, content: encodedContent };
    if (fileSha) params.sha = fileSha;

    const { data } = await octokit.repos.createOrUpdateFileContents(params);
    return {
      success: true,
      data: {
        commit_sha: data.commit.sha,
        commit_message: data.commit.message,
        content_sha: data.content?.sha,
        path: data.content?.path,
      },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * プルリクエストを作成する（pr 権限が必要）
 * @param {string} permission  "read" | "write" | "pr"
 */
async function createPullRequest(owner, repo, title, body, head, base, token, permission = 'read') {
  if (permission !== 'pr') {
    return { success: false, error: 'このリポジトリはPR作成権限がありません' };
  }
  try {
    const octokit = await makeOctokit(token);
    const { data } = await octokit.pulls.create({
      owner,
      repo,
      title,
      body: body || '',
      head,
      base,
    });
    return {
      success: true,
      data: {
        number: data.number,
        title: data.title,
        html_url: data.html_url,
        state: data.state,
        head: data.head.ref,
        base: data.base.ref,
      },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * リポジトリのファイルツリーを再帰的に取得する
 */
async function listFileTree(owner, repo, token, branch) {
  try {
    const octokit = await makeOctokit(token);

    let ref = branch;
    if (!ref) {
      const { data: repoData } = await octokit.repos.get({ owner, repo });
      ref = repoData.default_branch;
    }

    const { data } = await octokit.git.getTree({ owner, repo, tree_sha: ref, recursive: '1' });
    return {
      success: true,
      data: data.tree.map((item) => ({
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha,
        mode: item.mode,
      })),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * PRをマージする（pr 権限が必要）
 */
async function mergePullRequest(owner, repo, pullNumber, token, permission = 'read') {
  if (permission !== 'pr') {
    return { success: false, error: 'このリポジトリはPRマージ権限がありません' };
  }
  try {
    const octokit = await makeOctokit(token);
    const { data } = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: Number(pullNumber),
      merge_method: 'squash',
    });
    return {
      success: true,
      data: {
        merged: data.merged,
        message: data.message,
        sha: data.sha,
      },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * オープン中のPR一覧を返す
 */
async function listPullRequests(owner, repo, token) {
  try {
    const octokit = await makeOctokit(token);
    const { data } = await octokit.pulls.list({ owner, repo, state: 'open', per_page: 50 });
    return {
      success: true,
      data: data.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        html_url: pr.html_url,
        head: pr.head.ref,
        base: pr.base.ref,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        user: pr.user?.login,
      })),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 特定のPRの詳細を返す
 */
async function getPullRequest(owner, repo, pullNumber, token) {
  try {
    const octokit = await makeOctokit(token);
    const { data } = await octokit.pulls.get({ owner, repo, pull_number: Number(pullNumber) });
    return {
      success: true,
      data: {
        number: data.number,
        title: data.title,
        body: data.body,
        state: data.state,
        html_url: data.html_url,
        head: data.head.ref,
        base: data.base.ref,
        created_at: data.created_at,
        updated_at: data.updated_at,
        user: data.user?.login,
        mergeable: data.mergeable,
      },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { listRepositories, getFileContent, updateFileContent, listFileTree, createPullRequest, mergePullRequest, listPullRequests, getPullRequest };
