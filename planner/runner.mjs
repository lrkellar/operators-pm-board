#!/usr/bin/env node
// Operators PM Board - guided planner runner.
//
// Runs Project Council on THIS computer with headless Claude Code (`claude -p`), signed in with
// your Claude account, so planning uses your Claude subscription - never API credits. The board
// (GitHub Pages or localhost) talks to this process over http://127.0.0.1:43128. Google sign-in
// stays in the browser: the board saves gate files to Drive itself, so this process never sees a
// Google token.
//
//   npm run planner            start it (or double-click "Start planner.cmd")
//   npm run planner -- --check check Claude Code, the sign-in, the plugin and the library, then exit
//
// No dependencies beyond Node 20+.

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, appendFileSync } from 'node:fs'
import { join, resolve, dirname, basename, relative, isAbsolute, delimiter } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

// ── configuration ──────────────────────────────────────────────────────────────────────────────
function loadConfig() {
  const file = process.env.OPM_PLANNER_CONFIG || join(HERE, 'planner.config.json')
  let cfg = {}
  if (existsSync(file)) {
    try { cfg = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { console.error(`Could not read ${file}: ${e.message}`) }
  }
  return {
    port: Number(process.env.OPM_PLANNER_PORT || cfg.port || 43128),
    library: resolve(process.env.COUNCIL_LIBRARY || cfg.library || join(REPO, '..', 'project-council-library')),
    plugin: resolve(process.env.COUNCIL_PLUGIN || cfg.plugin || join(REPO, '..', 'project-council')),
    // Load the plugin with --plugin-dir. Set false if you installed it from a marketplace instead.
    load_plugin_dir: cfg.load_plugin_dir !== false,
    claude: process.env.OPM_CLAUDE_PATH || cfg.claude || null,
    model: cfg.model || null,               // null = your Claude Code default
    python: cfg.python || null,             // extra Bash(<python> *) permission, e.g. "py"
    allowed_origins: [
      'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'https://lrkellar.github.io',
      ...(cfg.allowed_origins || []),
      ...(process.env.OPM_PLANNER_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    ],
  }
}
const CFG = loadConfig()
const PROJECTS = join(CFG.library, 'projects')
const RUNTIME = join(tmpdir(), 'opm-planner')

// Auth methods that bill your Claude plan. Anything else (api_key, api_key_helper, third_party)
// would bill per token, so the runner refuses to start a turn.
const SUBSCRIPTION_AUTH = new Set(['claude.ai', 'oauth_token'])
// Environment that would switch Claude Code to per-token billing. Removed from every child process.
const BILLING_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_SIMPLE']

// ── small helpers ──────────────────────────────────────────────────────────────────────────────
const now = () => new Date().toISOString()
const readJson = (p, fallback = null) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fallback } }
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 1), 'utf8') }
const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project'

function findOnPath(name) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map(e => e.toLowerCase()) : ['']
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  if (process.platform === 'win32') dirs.push(join(process.env.USERPROFILE || '', '.local', 'bin'), join(process.env.APPDATA || '', 'npm'))
  else dirs.push(join(process.env.HOME || '', '.local', 'bin'))
  for (const d of dirs) for (const e of exts) {
    const p = join(d, name + e)
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}

function claudeExe() {
  const p = CFG.claude || findOnPath('claude')
  if (!p || !existsSync(p)) throw new Error('Claude Code is not installed on this computer (the `claude` command was not found). Install it, then run `claude` once in a terminal and sign in with your Claude account.')
  return p
}

function childEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const k of BILLING_ENV) delete env[k]
  return env
}

// Spawn claude. A Windows .cmd/.bat shim must go through cmd.exe; every argument is quoted.
function spawnClaude(args, opts) {
  const exe = claudeExe()
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    const q = a => `"${String(a).replace(/"/g, '""')}"`
    const line = `"${[exe, ...args].map(q).join(' ')}"`
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { ...opts, windowsVerbatimArguments: true })
  }
  return spawn(exe, args, opts)
}

function claudeJson(args, timeout = 30000) {
  return new Promise(resolveP => {
    let child
    try { child = spawnClaude(args, { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { return resolveP({ error: e.message }) }
    let out = '', err = ''
    const t = setTimeout(() => child.kill(), timeout)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', e => { clearTimeout(t); resolveP({ error: e.message }) })
    child.on('close', code => {
      clearTimeout(t)
      try { resolveP({ code, json: JSON.parse(out) }) } catch { resolveP({ code, text: (out + err).trim() }) }
    })
  })
}

// ── the Claude sign-in check (costs no tokens) ─────────────────────────────────────────────────
let authCache = null
async function checkAuth(force = false) {
  if (!force && authCache && Date.now() - authCache.at < 60000) return authCache
  const r = { at: Date.now(), installed: false, loggedIn: false, authMethod: null, subscription: false, version: null, problem: null }
  try { claudeExe(); r.installed = true } catch (e) { r.problem = e.message; return (authCache = r) }
  const v = await claudeJson(['--version'], 20000)
  r.version = (v.text || '').split(/\s/)[0] || null
  const s = await claudeJson(['auth', 'status'], 30000)
  if (s.json) {
    r.loggedIn = Boolean(s.json.loggedIn)
    r.authMethod = s.json.authMethod || null
    r.email = s.json.email || s.json.account?.email || null
    r.subscription = r.loggedIn && SUBSCRIPTION_AUTH.has(r.authMethod)
    if (!r.loggedIn) r.problem = 'Claude Code is not signed in. Open a terminal, run `claude`, and sign in with your Claude account (Pro or Max).'
    else if (!r.subscription) r.problem = `Claude Code is signed in with "${r.authMethod}", which bills per token. Run \`claude auth logout\`, then \`claude auth login\` and choose your Claude account (not Console). The planner will not run until then.`
  } else {
    r.problem = `Could not read \`claude auth status\` (Claude Code ${r.version || 'unknown version'}). Update Claude Code with \`claude update\`. Detail: ${(s.text || s.error || '').slice(0, 300)}`
  }
  return (authCache = r)
}

function pathsStatus() {
  const plugin = existsSync(join(CFG.plugin, '.claude-plugin', 'plugin.json')) ? readJson(join(CFG.plugin, '.claude-plugin', 'plugin.json')) : null
  return {
    library: CFG.library, library_ok: existsSync(join(CFG.library, 'levels')),
    plugin: CFG.plugin, plugin_ok: Boolean(plugin), plugin_version: plugin?.version || null,
    guided_skill_ok: existsSync(join(CFG.plugin, 'skills', 'guided-session', 'SKILL.md')),
  }
}

// ── runtime files handed to claude ─────────────────────────────────────────────────────────────
function runtimeFiles() {
  mkdirSync(RUNTIME, { recursive: true })
  const py = ['python', 'python3', 'py', ...(CFG.python ? [CFG.python] : [])]
  const settings = {
    permissions: {
      defaultMode: 'acceptEdits',
      allow: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'Agent', 'Task', 'TodoWrite', 'WebSearch', 'WebFetch',
        ...[...new Set(py)].map(p => `Bash(${p} *)`), 'Bash(mkdir *)', 'Bash(ls *)', 'Bash(dir *)', 'Bash(cat *)', 'Bash(type *)'],
      deny: ['AskUserQuestion'],
    },
  }
  const files = {
    settings: join(RUNTIME, 'settings.json'),
    mcp: join(RUNTIME, 'no-mcp.json'),
    prompt: join(RUNTIME, 'guided-system-prompt.md'),
  }
  writeJson(files.settings, settings)
  writeJson(files.mcp, { mcpServers: {} })
  writeFileSync(files.prompt, GUIDED_PROMPT, 'utf8')
  return files
}

const GUIDED_PROMPT = `# Guided planning session (Operators PM Board)

You are running headless on Lance's computer under the Operators PM Board's guided planner. Lance
reads and answers you in the board's guided interface, not in a terminal. Every message from him
starts with [author]; messages from the board itself start with [board].

Before anything else in this session, load the project-council plugin's \`guided-session\` skill
with the Skill tool and follow it for the whole session. It tells you how to end each turn with a
\`council-ui\` block, how gates reach the board, and how reviews come back.

Hard rules:
- AskUserQuestion is not available. Ask by ending your final message with the council-ui block.
- One question per turn. After the block, stop.
- The board connector and Google Drive are not available here. Publish gates as files only.
- The project folder is the current directory (env COUNCIL_PROJECT); scripts are in COUNCIL_SCRIPTS;
  the library is COUNCIL_LIBRARY.
`

// ── projects and sessions ──────────────────────────────────────────────────────────────────────
const live = new Map()   // slug -> { child, events, startedAt, seq }

const projDir = slug => join(PROJECTS, slug)
const sessFile = slug => join(projDir(slug), '.guided', 'session.json')
const transcriptFile = slug => join(projDir(slug), '.guided', 'transcript.jsonl')

function safeSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug || '')) throw httpError(400, 'Bad project id.')
  return slug
}
function loadSession(slug) {
  const s = readJson(sessFile(safeSlug(slug)))
  if (!s) throw httpError(404, 'No guided session for that project.')
  return s
}
const saveSession = s => writeJson(sessFile(s.slug), { ...s, updated_at: now() })

function transcript(slug) {
  if (!existsSync(transcriptFile(slug))) return []
  return readFileSync(transcriptFile(slug), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
function addTranscript(slug, entry) {
  mkdirSync(dirname(transcriptFile(slug)), { recursive: true })
  appendFileSync(transcriptFile(slug), JSON.stringify({ at: now(), ...entry }) + '\n', 'utf8')
}

function listSessions() {
  if (!existsSync(PROJECTS)) return []
  return readdirSync(PROJECTS).filter(d => existsSync(sessFile(d))).map(d => {
    const s = readJson(sessFile(d))
    return s && { slug: s.slug, name: s.name, plan_id: s.plan_id, status: live.has(s.slug) ? 'running' : s.status,
      phase: s.last_ui?.phase || null, level: s.last_ui?.level ?? null, updated_at: s.updated_at, created_at: s.created_at }
  }).filter(Boolean).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
}

function createProject({ name, idea }) {
  name = String(name || '').trim()
  idea = String(idea || '').trim()
  if (!name) throw httpError(400, 'Give the project a name.')
  if (idea.length < 20) throw httpError(400, 'Describe the idea in a few sentences so the scoping lead has something to start from.')
  if (!existsSync(join(CFG.library, 'levels'))) throw httpError(500, `The council library was not found at ${CFG.library}. Set "library" in planner/planner.config.json.`)
  let slug = slugify(name), i = 2
  while (existsSync(projDir(slug))) slug = `${slugify(name)}-${i++}`
  const dir = projDir(slug)
  for (const sub of ['plan/levels', 'plan/gates', '.claude/agents', '.guided']) mkdirSync(join(dir, sub), { recursive: true })
  writeFileSync(join(dir, '00-brief.md'), `# ${name}\n\n${idea}\n`, 'utf8')
  const s = { slug, name, plan_id: slug, session_id: randomUUID(), turns: 0, status: 'new', created_at: now(), last_ui: null }
  saveSession(s)
  addTranscript(slug, { role: 'author', text: idea, kind: 'idea' })
  return s
}

// ── one turn of headless Claude ────────────────────────────────────────────────────────────────
const LIMIT_PAT = /usage limit|limit reached|out of (?:usage|quota)|hit your \S* ?limit/i

function parseLimitReset(text) {
  let m = text.match(/\|\s*(\d{10,13})/)
  if (m) { const t = Number(m[1]); return new Date(t > 1e12 ? t : t * 1000).toISOString() }
  m = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m/i)
  if (m) {
    const d = new Date()
    d.setHours((Number(m[1]) % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0), Number(m[2] || 0), 0, 0)
    if (d <= new Date()) d.setDate(d.getDate() + 1)
    return d.toISOString()
  }
  return null
}

// The conductor ends each turn with ```council-ui {json}```. Take the last one.
export function parseUi(text) {
  const t = String(text || '')
  const re = /```council-ui\s*([\s\S]*?)```/g
  let m, last = null
  while ((m = re.exec(t))) last = m
  const before = (last ? t.slice(0, last.index) : t).trim()
  if (last) {
    try {
      const ui = JSON.parse(last[1])
      if (!ui.say && before) ui.say = before
      else if (ui.say && before && before.length > 40 && !ui.say.includes(before.slice(0, 40))) ui.note = before
      ui.ask = ui.ask || { kind: 'text' }
      return ui
    } catch (e) {
      return { say: before || t, ask: { kind: 'text', question: 'Reply to continue.' }, parse_error: `The council-ui block was not valid JSON (${e.message}).` }
    }
  }
  return { say: t.trim(), ask: { kind: 'text', question: '' }, parse_error: 'No council-ui block in this turn.' }
}

function describeTool(name, input = {}, cwd) {
  const rel = p => { if (!p) return ''; const r = relative(cwd, p); return r && !r.startsWith('..') && !isAbsolute(r) ? r : basename(p) }
  switch (name) {
    case 'Agent': case 'Task': return { icon: '🧑‍🔬', text: `${input.subagent_type || 'agent'}${input.description ? ': ' + input.description : ''}` }
    case 'Skill': return { icon: '📘', text: `skill ${input.skill || input.command || ''}` }
    case 'Bash': return { icon: '▶', text: input.description || String(input.command || '').slice(0, 110) }
    case 'Write': return { icon: '✍', text: `wrote ${rel(input.file_path)}` }
    case 'Edit': case 'MultiEdit': return { icon: '✎', text: `edited ${rel(input.file_path)}` }
    case 'Read': return { icon: '📄', text: `read ${rel(input.file_path)}`, quiet: true }
    case 'Glob': case 'Grep': return { icon: '🔍', text: `${name} ${input.pattern || ''}`, quiet: true }
    case 'WebSearch': return { icon: '🔎', text: `searched: ${input.query || ''}` }
    case 'WebFetch': { let h = ''; try { h = new URL(input.url).host } catch { /* ignore */ } return { icon: '🌐', text: `read ${h || 'a web page'}` } }
    case 'TodoWrite': return null
    default: return { icon: '•', text: name }
  }
}

async function runTurn(slug, message) {
  const s = loadSession(slug)
  if (live.has(slug)) throw httpError(409, 'The council is still working on the last message.')
  if (live.size > 0) throw httpError(409, `Another plan (${[...live.keys()][0]}) is running. One at a time keeps you inside your plan's usage limits.`)
  const auth = await checkAuth(true)
  if (!auth.subscription) throw httpError(412, auth.problem || 'Claude Code is not signed in with a Claude subscription.')

  const files = runtimeFiles()
  const dir = projDir(slug)
  const first = !s.turns
  const args = ['-p', '--output-format', 'stream-json', '--verbose',
    ...(first ? ['--session-id', s.session_id] : ['--resume', s.session_id]),
    '--permission-mode', 'acceptEdits', '--settings', files.settings,
    '--append-system-prompt-file', files.prompt,
    '--strict-mcp-config', '--mcp-config', files.mcp,
    '--add-dir', CFG.library, '--add-dir', CFG.plugin]
  if (CFG.load_plugin_dir) args.push('--plugin-dir', CFG.plugin)
  if (CFG.model) args.push('--model', CFG.model)

  const state = { child: null, events: [], seq: 0, startedAt: Date.now(), agents: new Map(), resultText: null, isError: false, stderr: '' }
  const push = ev => { state.events.push({ seq: ++state.seq, at: now(), ...ev }); if (state.events.length > 400) state.events.splice(0, state.events.length - 400) }
  live.set(slug, state)
  s.status = 'running'; s.turns += 1; s.error = null; s.limit_reset = null
  saveSession(s)

  const child = spawnClaude(args, {
    cwd: dir, stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv({ COUNCIL_LIBRARY: CFG.library, COUNCIL_PROJECT: dir, COUNCIL_SCRIPTS: join(CFG.plugin, 'scripts'), COUNCIL_GUIDED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
  })
  state.child = child
  child.stdin.end(message)
  push({ kind: 'status', icon: '⏳', text: first ? 'Starting the council…' : 'The council is working…' })

  let buf = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line) continue
      let msg; try { msg = JSON.parse(line) } catch { continue }
      handleStream(msg)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', d => { state.stderr = (state.stderr + d).slice(-4000) })

  function handleStream(msg) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      const plugins = (msg.plugins || []).map(p => p.name)
      s.model = msg.model || s.model
      push({ kind: 'status', icon: '🟢', text: `Claude ${msg.model ? '(' + msg.model + ') ' : ''}started on your subscription${plugins.length ? ' · plugins: ' + plugins.join(', ') : ''}` })
      for (const e of msg.plugin_errors || []) push({ kind: 'error', icon: '⚠', text: `Plugin ${e.plugin || ''} did not load: ${e.message}` })
      return
    }
    if (msg.type === 'system' && msg.subtype === 'api_retry') {
      push({ kind: 'status', icon: '↻', text: `Claude is retrying (${msg.error || 'busy'}), attempt ${msg.attempt}` })
      return
    }
    if (msg.type === 'assistant' && msg.message?.content) {
      const parent = msg.parent_tool_use_id || null
      const who = parent ? state.agents.get(parent) : null
      for (const b of msg.message.content) {
        if (b.type === 'tool_use') {
          const d = describeTool(b.name, b.input, dir)
          if (b.name === 'Agent' || b.name === 'Task') state.agents.set(b.id, b.input?.subagent_type || 'agent')
          if (d) push({ kind: 'tool', icon: d.icon, text: d.text, quiet: d.quiet || false, agent: who, depth: parent ? 1 : 0 })
        } else if (b.type === 'text' && !parent && b.text?.trim()) {
          const txt = b.text.replace(/```council-ui[\s\S]*?```/g, '').trim()
          if (txt) push({ kind: 'text', icon: '💬', text: txt.length > 400 ? txt.slice(0, 400) + '…' : txt })
        }
      }
      return
    }
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) {
        if (b.type === 'tool_result' && b.is_error) {
          const c = Array.isArray(b.content) ? b.content.map(x => x.text || '').join(' ') : String(b.content || '')
          push({ kind: 'warn', icon: '⚠', text: c.slice(0, 240), quiet: true })
        }
      }
      return
    }
    if (msg.type === 'result') {
      state.resultText = typeof msg.result === 'string' ? msg.result : ''
      state.isError = Boolean(msg.is_error) || (msg.subtype && msg.subtype !== 'success')
      if (/^[0-9a-f-]{36}$/i.test(msg.session_id || '')) s.session_id = msg.session_id
    }
  }

  child.on('error', e => { state.stderr += `\n${e.message}` })
  child.on('close', code => {
    live.delete(slug)
    const all = `${state.resultText || ''}\n${state.stderr}`
    if (LIMIT_PAT.test(all) && (state.isError || code !== 0 || (state.resultText || '').length < 300)) {
      s.status = 'limit'
      s.limit_reset = parseLimitReset(all)
      s.error = (state.resultText || state.stderr).trim().slice(-300)
      addTranscript(slug, { role: 'system', kind: 'limit', text: s.error, reset: s.limit_reset })
    } else if (code !== 0 || state.isError || state.resultText == null) {
      s.status = 'error'
      s.error = ((state.resultText || '') + '\n' + state.stderr).trim().slice(-800) || `Claude Code exited with code ${code}.`
      if (/log ?in|sign ?in|auth/i.test(s.error)) s.error += '\n\nIf this is about signing in: open a terminal, run `claude`, and sign in with your Claude account.'
      addTranscript(slug, { role: 'system', kind: 'error', text: s.error })
    } else {
      const ui = parseUi(state.resultText)
      if (ui.gate?.file) {
        const gp = isAbsolute(ui.gate.file) ? ui.gate.file : join(dir, ui.gate.file)
        ui.gate.exists = existsSync(gp)
        ui.gate.file = relative(dir, gp).split('\\').join('/')
        if (!ui.gate.level && ui.gate.level !== 0) { const m = basename(gp).match(/^L(\d)-r(\d+)/); if (m) { ui.gate.level = Number(m[1]); ui.gate.revision = Number(m[2]) } }
      }
      s.status = ui.ask?.kind === 'done' ? 'done' : ui.gate ? 'waiting_review' : 'waiting'
      s.last_ui = ui
      addTranscript(slug, { role: 'claude', ui, activity: state.events.filter(e => !e.quiet && e.kind === 'tool').length, seconds: Math.round((Date.now() - state.startedAt) / 1000) })
    }
    saveSession(s)
    state.finished = true
    finished.set(slug, state)
  })
  return s
}
const finished = new Map()   // slug -> last finished turn's state, for its activity feed

function stopTurn(slug) {
  const st = live.get(slug)
  if (!st) return false
  try { st.child.kill('SIGINT') } catch { /* ignore */ }
  setTimeout(() => { if (live.get(slug) === st) try { st.child.kill() } catch { /* ignore */ } }, 5000)
  return true
}

function authorMessage(body) {
  const parts = []
  if (body.choice) {
    const c = Array.isArray(body.choice) ? body.choice : [body.choice]
    parts.push(`Lance chose: ${c.map(x => (/^([A-Z]\d?|test)$/.test(x.id || '') && x.id !== x.label ? `${x.id} - ${x.label}` : x.label)).join('; ')}`)
  }
  if (body.text && String(body.text).trim()) parts.push(String(body.text).trim())
  if (!parts.length) throw httpError(400, 'Pick an option or type an answer.')
  return parts.join('\n\n')
}

// ── HTTP ───────────────────────────────────────────────────────────────────────────────────────
function httpError(status, message) { const e = new Error(message); e.status = status; return e }

function setCors(req, res) {
  const origin = req.headers.origin
  if (!origin) return true
  if (!CFG.allowed_origins.includes(origin)) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true')
  res.setHeader('Access-Control-Max-Age', '600')
  res.setHeader('Vary', 'Origin')
  return true
}

function send(res, status, value, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(typeof value === 'string' ? value : JSON.stringify(value))
}

async function body(req, limit = 2_000_000) {
  const chunks = []; let size = 0
  for await (const c of req) { size += c.length; if (size > limit) throw httpError(413, 'Request is too large.'); chunks.push(c) }
  if (!size) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw httpError(400, 'Request body is not JSON.') }
}

function sessionView(slug, since = 0) {
  const s = loadSession(slug)
  const st = live.get(slug) || finished.get(slug)
  return {
    session: { ...s, status: live.has(slug) ? 'running' : s.status },
    transcript: transcript(slug),
    running: live.has(slug),
    elapsed: st && live.has(slug) ? Math.round((Date.now() - st.startedAt) / 1000) : null,
    events: st ? st.events.filter(e => e.seq > since) : [],
    gates: listGates(slug),
  }
}

function listGates(slug) {
  const g = join(projDir(slug), 'plan', 'gates')
  if (!existsSync(g)) return []
  return readdirSync(g).filter(f => /^L\d-r\d+\.json$/.test(f)).map(f => {
    const [, n, k] = f.match(/^L(\d)-r(\d+)\.json$/)
    return { file: `plan/gates/${f}`, level: Number(n), revision: Number(k), bytes: statSync(join(g, f)).size,
      reviewed: existsSync(join(g, `L${n}-r${k}-review.json`)) }
  }).sort((a, b) => a.level - b.level || a.revision - b.revision)
}

async function route(req, res) {
  if (!setCors(req, res)) return send(res, 403, { error: 'This app origin is not allowed to use the planner.' })
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const parts = url.pathname.split('/').filter(Boolean)
  const M = req.method

  if (M === 'GET' && url.pathname === '/status') {
    const auth = await checkAuth(url.searchParams.get('fresh') === '1')
    return send(res, 200, { ok: true, planner: 'opm-planner', version: 1, auth, paths: pathsStatus(), running: [...live.keys()], model: CFG.model })
  }
  if (parts[0] !== 'projects') throw httpError(404, 'Not found')

  if (parts.length === 1 && M === 'GET') return send(res, 200, { projects: listSessions() })
  if (parts.length === 1 && M === 'POST') {
    const b = await body(req)
    const auth = await checkAuth(true)
    if (!auth.subscription) throw httpError(412, auth.problem)
    const s = createProject(b)
    const kickoff = `[author] I want to plan a new project with the council.\n\nProject name: ${s.name}\nProject folder: ${projDir(s.slug)}\nMy idea, in my own words, is saved verbatim in 00-brief.md:\n\n${readFileSync(join(projDir(s.slug), '00-brief.md'), 'utf8')}\nStart the guided session: load the guided-session skill, do the setup, then ask me the first scoping question.`
    await runTurn(s.slug, kickoff)
    return send(res, 201, { slug: s.slug })
  }

  const slug = safeSlug(parts[1])
  const action = parts[2]
  if (!action && M === 'GET') return send(res, 200, sessionView(slug, Number(url.searchParams.get('since') || 0)))

  if (action === 'reply' && M === 'POST') {
    const b = await body(req)
    const text = authorMessage(b)
    addTranscript(slug, { role: 'author', text, choice: b.choice || null })
    try { await runTurn(slug, `[author] ${text}`) } catch (e) { addTranscript(slug, { role: 'system', kind: 'error', text: e.message }); throw e }
    return send(res, 202, { ok: true })
  }

  if (action === 'retry' && M === 'POST') {
    const t = transcript(slug).filter(e => e.role === 'author').pop()
    const msg = t ? `[author] ${t.text}` : '[author] Please continue where you left off.'
    await runTurn(slug, `${msg}\n\n(Your last turn did not finish. Check the project files for what was already done, then continue.)`)
    return send(res, 202, { ok: true })
  }

  if (action === 'stop' && M === 'POST') return send(res, 200, { stopped: stopTurn(slug) })

  if (action === 'gate' && M === 'GET') {
    const file = String(url.searchParams.get('file') || '')
    if (!/^plan\/gates\/L\d-r\d+\.json$/.test(file)) throw httpError(400, 'Bad gate file.')
    const p = join(projDir(slug), ...file.split('/'))
    if (!existsSync(p)) throw httpError(404, 'That gate file does not exist yet.')
    return send(res, 200, readFileSync(p, 'utf8'), 'text/plain; charset=utf-8')
  }

  if (action === 'review' && M === 'POST') {
    const b = await body(req)
    const n = Number(b.level), k = Number(b.revision)
    if (!Number.isInteger(n) || n < 0 || n > 4 || !Number.isInteger(k) || k < 1) throw httpError(400, 'Bad level or revision.')
    if (!b.review || typeof b.review !== 'object') throw httpError(400, 'Missing review.')
    const rel = `plan/gates/L${n}-r${k}-review.json`
    writeJson(join(projDir(slug), ...rel.split('/')), b.review)
    const d = b.review.decision
    if (!d) return send(res, 200, { ok: true, started: false })   // a draft: nothing for the council yet
    const label = d === 'approved' ? 'approved the level' : 'sent the level back with changes'
    const decs = Object.entries(b.review.decisions || {}).filter(([, v]) => v?.choice).map(([id, v]) => `${id}: ${v.choice}`).join(', ')
    const text = `Lance ${label} on the board (L${n}, revision ${k}).${decs ? ` Decisions recorded on the gate page: ${decs}.` : ''}`
    addTranscript(slug, { role: 'author', text, kind: 'review', level: n, revision: k, decision: d })
    await runTurn(slug, `[board] ${text}\nThe review is saved at ${rel}. Apply it with gate_apply.py (--review ${rel}) and continue the guided session.`)
    return send(res, 202, { ok: true, started: true })
  }

  throw httpError(404, 'Not found')
}

// ── start ──────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (process.argv.includes('--check')) {
    const a = await checkAuth(true)
    const p = pathsStatus()
    console.log(JSON.stringify({ auth: a, paths: p }, null, 2))
    const ok = a.subscription && p.library_ok && p.plugin_ok && p.guided_skill_ok
    console.log(ok ? '\nReady: the planner will run on your Claude subscription.' : `\nNot ready: ${a.problem || (!p.library_ok ? 'library not found' : !p.plugin_ok ? 'plugin not found' : 'guided-session skill missing from the plugin')}`)
    process.exit(ok ? 0 : 1)
  }
  const server = createServer((req, res) => {
    route(req, res).catch(e => send(res, e.status || 500, { error: e.message || String(e) }))
  })
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${CFG.port} is in use - is the planner already running?` : e.message); process.exit(1) })
  server.listen(CFG.port, '127.0.0.1', async () => {
    console.log(`Operators PM Board planner on http://127.0.0.1:${CFG.port}`)
    console.log(`  library: ${CFG.library}\n  plugin:  ${CFG.plugin}`)
    const a = await checkAuth(true)
    console.log(a.subscription ? `  Claude Code ${a.version}: signed in with your Claude subscription (${a.authMethod}). No API credits are used.` : `  NOT READY: ${a.problem}`)
    console.log('Leave this window open while you plan. Close it to stop.')
  })
  const shutdown = () => { for (const slug of live.keys()) stopTurn(slug); setTimeout(() => process.exit(0), 300) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
