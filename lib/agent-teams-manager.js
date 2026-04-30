const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

class AgentTeamsManager {
  constructor(settings, broadcast) {
    this.settings = settings
    this.broadcast = broadcast
    this.projectDir = path.join(__dirname, '..')
    this.jennyProcess = null
    this.activeTeammates = new Map()
    this.outputBuffer = ''
    this._currentCompanyId = null
  }

  async startJenny() {
    if (this.jennyProcess) {
      console.log('[agent-teams] ジェニーはすでに起動中')
      return
    }
    const jennyPrompt = await this.buildJennyPrompt()
    const apiKey = this.settings.anthropicApiKey || ''
    if (!apiKey) {
      console.error('[agent-teams] ANTHROPIC_API_KEY が未設定 - ジェニー起動スキップ')
      return
    }

    this.jennyProcess = spawn('claude', [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--system-prompt', jennyPrompt,
      '--dangerously-skip-permissions',
    ], {
      cwd: this.projectDir,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
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
    })
    this.jennyProcess.on('error', err => {
      console.error('[agent-teams] ジェニープロセスエラー:', err.message)
      this.jennyProcess = null
    })

    this.broadcast({ type: 'jenny_online' })
    console.log('[agent-teams] ジェニー起動完了')
  }

  sendToJenny(message, companyId) {
    if (!this.jennyProcess || !this.jennyProcess.stdin.writable) {
      console.error('[agent-teams] ジェニーが起動していない - フォールバック必要')
      return false
    }
    this._currentCompanyId = companyId
    const jsonLine = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message }
    })
    console.log('[agent-teams] Yuta→ジェニー:', message.slice(0, 80))
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

  processJennyEvent(event) {
    // アシスタントのテキストメッセージ
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          // SPAWN_TEAMMATE ブロック検出
          const re = /###SPAWN_TEAMMATE\s+agentId="([^"]+)"\s+taskId="([^"]+)"\s+task="([^"]+)"###/g
          let m
          while ((m = re.exec(block.text)) !== null) {
            const [, agentId, taskId, task] = m
            console.log('[agent-teams] SPAWN_TEAMMATE検出:', agentId, 'taskId=', taskId)
            this.spawnTeammate(agentId, task, taskId)
          }
          // UIにテキストを送る（SPAWN_TEAMMATEブロック以外の部分）
          const displayText = block.text.replace(/###SPAWN_TEAMMATE[^#]*###/g, '').trim()
          if (displayText) {
            this.broadcast({ type: 'token', content: displayText })
          }
        }
        // tool_use イベント（Agent tool の呼び出し）
        if (block.type === 'tool_use' && block.name) {
          console.log('[agent-teams] jenny tool_use:', block.name)
          if (block.name === 'Agent' || block.name === 'spawn_teammate') {
            this.broadcast({ type: 'agent_spawn', agentName: block.input?.name || block.input?.agentId || '不明' })
          }
        }
      }
    }
    if (event.type === 'result') {
      console.log('[agent-teams] jenny result受信')
      this.broadcast({ type: 'done' })
    }
  }

  async buildJennyPrompt() {
    const jennyFile = path.join(this.projectDir, '.claude/agents/jenny.md')
    if (!fs.existsSync(jennyFile)) {
      return 'あなたはOneCompanyOpsの統括秘書ジェニーです。Yutaからの指示を受けて適切なエージェントに委託してください。'
    }
    let base = fs.readFileSync(jennyFile, 'utf-8')
    // frontmatter除去
    base = base.replace(/^---[\s\S]*?---\n/, '')
    return base
  }

  spawnTeammate(agentId, task, taskId) {
    const agentFile = path.join(this.projectDir, `.claude/agents/${agentId}.md`)
    let systemPrompt = ''
    if (fs.existsSync(agentFile)) {
      systemPrompt = fs.readFileSync(agentFile, 'utf-8').replace(/^---[\s\S]*?---\n/, '')
    } else {
      console.warn('[agent-teams] エージェントファイルなし:', agentId, '- デフォルトプロンプトを使用')
      systemPrompt = `あなたはエージェント${agentId}です。与えられたタスクを実行してください。`
    }

    const apiKey = this.settings.anthropicApiKey || ''
    const githubToken = this.settings.githubPersonalToken || this.settings.githubCompanyToken || ''

    const proc = spawn('claude', [
      '-p', task,
      '--output-format', 'stream-json',
      '--verbose',
      '--system-prompt', systemPrompt,
      '--dangerously-skip-permissions',
    ], {
      cwd: this.projectDir,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        GITHUB_TOKEN: githubToken,
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.activeTeammates.set(taskId, proc)
    this.broadcast({ type: 'agent_spawn', agentId, taskId })
    console.log('[agent-teams] チームメンバー起動:', agentId, 'taskId=', taskId)

    let outputBuf = ''
    proc.stdout.on('data', d => {
      outputBuf += d.toString()
      const lines = outputBuf.split('\n')
      outputBuf = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'assistant' && ev.message?.content) {
            for (const block of ev.message.content) {
              if (block.type === 'text' && block.text?.trim()) {
                console.log(`[agent-teams] ${agentId} output:`, block.text.slice(0, 100))
              }
            }
          }
        } catch {}
      }
    })
    proc.stderr.on('data', d => {
      const msg = d.toString()
      if (!msg.includes('Warning:') && !msg.includes('Configured API') && msg.trim()) {
        console.log(`[agent-teams] ${agentId} stderr:`, msg.slice(0, 150))
      }
    })
    proc.on('close', code => {
      this.activeTeammates.delete(taskId)
      this.broadcast({ type: 'agent_completed', agentId, taskId })
      console.log('[agent-teams] チームメンバー完了:', agentId, 'code=', code)
    })
    proc.on('error', err => {
      console.error(`[agent-teams] ${agentId} プロセスエラー:`, err.message)
      this.activeTeammates.delete(taskId)
    })
  }

  isJennyOnline() {
    return this.jennyProcess !== null && !this.jennyProcess.killed
  }

  shutdown() {
    if (this.jennyProcess) {
      this.jennyProcess.kill()
      this.jennyProcess = null
    }
    for (const [, proc] of this.activeTeammates) {
      try { proc.kill() } catch {}
    }
    this.activeTeammates.clear()
    console.log('[agent-teams] シャットダウン完了')
  }
}

module.exports = { AgentTeamsManager }
