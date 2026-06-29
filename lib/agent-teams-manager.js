const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

// agentId → 表示名（UI broadcast用の軽量マップ。未知IDはそのまま使う）
const DISPLAY_NAMES = {
  jenny: 'ジェニー',
  'agent-pm-overdue': 'トム',
  'agent-sp-research': 'ジェシー',
  'agent-sp-analyst': 'レン',
  'agent-sp-eng': 'ベンジ',
}

/**
 * Claude Code ネイティブのサブエージェント機能(Agentツール)で秘書ジェニーを動かす。
 * サーバーは1つの `claude` 秘書セッションを spawn し、stream-json を「観測」して
 * UI broadcast / tasks.json更新 / コスト記録 / 承認キューに反映する。
 * 委託・集約・監視はネイティブ(Agentツール)に任せる。自前spawn(SPAWN_TEAMMATE)は廃止。
 */
class AgentTeamsManager {
  /**
   * @param {object} settings  app-settings
   * @param {function} broadcast  WSブロードキャスト関数
   * @param {object} hooks  { companyId, onAgentCompletion, onUsage, onApproval }
   */
  constructor(settings, broadcast, hooks = {}) {
    this.settings = settings
    this.broadcast = broadcast
    this.hooks = hooks
    this.companyId = hooks.companyId || null
    this.projectDir = path.join(__dirname, '..')
    this.jennyProcess = null
    this.outputBuffer = ''
    this.sessionId = null
    this._currentCompanyId = hooks.companyId || null
    this.toolUseToAgent = new Map() // tool_use_id → agentId
    this._shuttingDown = false
    this._restartAttempts = 0
    this._maxRestarts = 5
  }

  async startJenny() {
    if (this.jennyProcess) {
      console.log('[agent-teams] ジェニーはすでに起動中')
      return
    }
    const apiKey = this.settings.anthropicApiKey || ''
    if (!apiKey) {
      console.error('[agent-teams] ANTHROPIC_API_KEY が未設定 - ジェニー起動スキップ')
      return
    }
    const jennyPrompt = await this.buildJennyPrompt()
    const githubToken = this.settings.githubPersonalToken || this.settings.githubCompanyToken || ''

    // -p + --input-format stream-json + プロンプト引数なし = 永続ストリーミング入力モード
    // (sendToJennyで複数のユーザーメッセージをstdin経由で投入できる)
    // エージェントは cwd の .claude/agents/ から自動検出される(--agents不要)。
    // デフォルトのエージェント検出を保つため --append-system-prompt を使う。
    this.jennyProcess = spawn('claude', [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--append-system-prompt', jennyPrompt,
      '--dangerously-skip-permissions',
    ], {
      cwd: this.projectDir,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        GITHUB_TOKEN: githubToken,
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.jennyProcess.stdout.on('data', d => this.handleJennyOutput(d.toString()))
    this.jennyProcess.stderr.on('data', d => {
      const msg = d.toString()
      if (!msg.includes('Warning:') && !msg.includes('Configured API') && msg.trim()) {
        console.log('[agent-teams] jenny stderr:', msg.slice(0, 150))
      }
    })
    this.jennyProcess.on('close', code => {
      console.log('[agent-teams] ジェニー終了 code=', code)
      this.jennyProcess = null
      this.broadcast({ type: 'jenny_offline' })
      this._scheduleRestart()
    })
    this.jennyProcess.on('error', err => {
      console.error('[agent-teams] ジェニープロセスエラー:', err.message)
      this.jennyProcess = null
    })

    this._restartAttempts = 0
    this.broadcast({ type: 'jenny_online' })
    console.log('[agent-teams] ジェニー起動完了 (ネイティブAgent委託モード)')
  }

  _scheduleRestart() {
    if (this._shuttingDown) return
    if (this._restartAttempts >= this._maxRestarts) {
      console.error('[agent-teams] ジェニー再起動の上限に達した - フォールバック(AgentExecutor)に委ねる')
      return
    }
    this._restartAttempts++
    const delay = Math.min(30000, 1000 * Math.pow(2, this._restartAttempts)) // 指数バックオフ(最大30s)
    console.log(`[agent-teams] ${delay}ms後にジェニー再起動を試行 (${this._restartAttempts}/${this._maxRestarts})`)
    setTimeout(() => { this.startJenny().catch(e => console.error('[agent-teams] 再起動失敗:', e.message)) }, delay)
  }

  sendToJenny(message, companyId) {
    if (!this.jennyProcess || !this.jennyProcess.stdin.writable) {
      console.error('[agent-teams] ジェニーが起動していない - フォールバック必要')
      return false
    }
    if (companyId) this._currentCompanyId = companyId
    const jsonLine = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message }
    })
    console.log('[agent-teams] →ジェニー:', message.slice(0, 80))
    this.jennyProcess.stdin.write(jsonLine + '\n')
    return true
  }

  handleJennyOutput(raw) {
    this.outputBuffer += raw
    const lines = this.outputBuffer.split('\n')
    this.outputBuffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        this.processJennyEvent(event)
      } catch {
        // JSON以外は無視
      }
    }
  }

  displayName(agentId) {
    return DISPLAY_NAMES[agentId] || agentId
  }

  processJennyEvent(event) {
    const companyId = this._currentCompanyId || this.companyId

    // セッション確立
    if (event.type === 'system' && event.subtype === 'init') {
      this.sessionId = event.session_id || this.sessionId
      return
    }

    // 委託開始: Agentツールが起動 → サブエージェント開始
    if (event.type === 'system' && event.subtype === 'task_started') {
      const agentId = event.subagent_type || 'unknown'
      const toolUseId = event.tool_use_id
      if (toolUseId) this.toolUseToAgent.set(toolUseId, agentId)
      console.log('[agent-teams] 委託開始:', agentId, 'taskId=', event.task_id)
      this.broadcast({
        type: 'agent_spawn',
        agentId,
        agentName: this.displayName(agentId),
        taskId: event.task_id,
        toolUseId,
        description: event.description || '',
      })
      return
    }

    // 委託完了: task_notification(completed) → 成果集約
    if (event.type === 'system' && event.subtype === 'task_notification') {
      if (event.status === 'completed' || event.status === 'failed') {
        const agentId = this.toolUseToAgent.get(event.tool_use_id) || event.subagent_type || 'unknown'
        const success = event.status === 'completed'
        const summary = event.summary || (success ? '完了しました' : '失敗しました')
        console.log('[agent-teams] 委託完了:', agentId, event.status)
        if (typeof this.hooks.onAgentCompletion === 'function') {
          Promise.resolve(
            this.hooks.onAgentCompletion(companyId, agentId, this.displayName(agentId), summary, event.task_id, success, { fromNative: true })
          ).catch(e => console.error('[agent-teams] onAgentCompletion error:', e.message))
        } else {
          this.broadcast({
            type: 'agent_completed', agentId, agentName: this.displayName(agentId),
            taskId: event.task_id, message: `${success ? '✅' : '⚠️'} ${this.displayName(agentId)}: ${summary}`
          })
        }
        // サブエージェントのトークンを記録(コストはターン全体のresultで取る)
        if (event.usage && typeof this.hooks.onUsage === 'function') {
          this.hooks.onUsage({ agentId, sessionId: this.sessionId, usage: event.usage, costUsd: null, companyId })
        }
      }
      return
    }

    // アシスタント発話
    if (event.type === 'assistant' && event.message?.content) {
      const parent = event.parent_tool_use_id
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text?.trim()) {
          if (parent) {
            // サブエージェントの中間出力
            const agentId = this.toolUseToAgent.get(parent) || 'agent'
            this.broadcast({ type: 'agent_progress', agentId, agentName: this.displayName(agentId), message: block.text.slice(0, 500) })
          } else {
            // ジェニー本体の発話
            this._handleJennyText(block.text, companyId)
          }
        }
      }
      return
    }

    // ターン全体の終了 → コスト記録
    if (event.type === 'result') {
      if (event.total_cost_usd != null && typeof this.hooks.onUsage === 'function') {
        this.hooks.onUsage({ agentId: 'jenny', sessionId: this.sessionId, usage: event.usage || null, costUsd: event.total_cost_usd, companyId })
      }
      this.broadcast({ type: 'done' })
      return
    }
  }

  _handleJennyText(text, companyId) {
    // 承認ブロック検出 → 承認キューへ(server.js側がpendingActionsに積む)
    // 属性順序に依存しないよう、ブロックを拾ってから各属性を個別抽出する
    const re = /###APPROVAL\s+([^#]*?)###/g
    let m
    let hadApproval = false
    while ((m = re.exec(text)) !== null) {
      const attrs = m[1]
      const summary = (attrs.match(/summary="([^"]*)"/) || [])[1] || ''
      if (!summary) continue // summary必須(誤検出防止)
      const kind = (attrs.match(/kind="([^"]*)"/) || [])[1] || 'approval'
      const options = (attrs.match(/options="([^"]*)"/) || [])[1] || '承認|却下'
      hadApproval = true
      console.log('[agent-teams] 承認要求検出:', kind, summary)
      if (typeof this.hooks.onApproval === 'function') {
        this.hooks.onApproval({ kind, summary, options: options.split('|'), companyId, agentId: 'jenny' })
      }
    }
    const display = text.replace(/###APPROVAL[^#]*###/g, '').trim()
    if (display) {
      this.broadcast({ type: 'token', content: display })
      // 永続化: ジェニーの発話(自走完了報告含む)を conversation.json に残す
      if (typeof this.hooks.onJennyMessage === 'function') {
        try { this.hooks.onJennyMessage({ companyId, text: display }) }
        catch (e) { console.error('[agent-teams] onJennyMessage error:', e.message) }
      }
    }
    else if (hadApproval) {/* 承認要求のみ。tokenは出さない */}
  }

  isJennyOnline() {
    return this.jennyProcess !== null && !this.jennyProcess.killed
  }

  shutdown() {
    this._shuttingDown = true
    if (this.jennyProcess) {
      try { this.jennyProcess.kill() } catch {}
      this.jennyProcess = null
    }
    console.log('[agent-teams] シャットダウン完了')
  }

  async buildJennyPrompt() {
    const jennyFile = path.join(this.projectDir, '.claude/agents/jenny.md')
    if (!fs.existsSync(jennyFile)) {
      return 'あなたはOneCompanyOpsの統括秘書ジェニーです。重い作業はAgentツールで専門エージェントに委託し、結論を3行で報告してください。'
    }
    let base = fs.readFileSync(jennyFile, 'utf-8')
    base = base.replace(/^---[\s\S]*?---\n/, '') // frontmatter除去
    return base
  }
}

module.exports = { AgentTeamsManager }
