#!/usr/bin/env node
/**
 * qq-bridge — 把 NapCat（OneBot 11）接到 DSH 的「蓝色大肥鱼」无头智能体上。
 *
 *   QQ 用户 ──消息──> NapCat ──OneBot WS──> bridge ──ACP stdio──> dsh --profile qqfish
 *                                              └──回复──────────> NapCat ──> QQ
 *
 * 不依赖任何 npm 包：Node 22+ 自带 WebSocket，ACP 就是换行分隔的 JSON-RPC。
 *
 * 用法：
 *   node bridge.mjs            启动（读同目录 config.json）
 *   node bridge.mjs --once "文本" 本地试跑一轮，不连 QQ
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { QQMemory } from './memory.mjs';
import { parseReply, plainText, saveIncomingImage, synthVoice } from './reply.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(HERE, 'logs');
const STATE_FILE = path.join(HERE, 'state.json');

// ---------------------------------------------------------------- config

const DEFAULTS = {
  onebot: { url: 'ws://127.0.0.1:3001', token: '' },
  agent: {
    profile: 'qqfish',
    cwd: 'D:\\dsh工作区\\ds-v3',
    model: '["deepseek-account","deepseek-flash"]',
    promptTimeoutMs: 240000,
  },
  // 私聊：owner 永远放行；其他人按 privatePolicy 处理
  privatePolicy: 'owner', // owner | allowlist | anyone
  privateAllowlist: [],
  // 群聊
  group: {
    mode: 'at', // at: 只在 @ 她时回；prefix: @ 或消息以 prefix 开头；all: 全回
    prefix: '肥鱼',
    allowlist: [], // 空 = 所有拉她进去的群都按 mode 处理
    cooldownSec: 20, // 同一个群两条回复之间至少隔多久
    maxPerHour: 30,
  },
  owner: [], // 号主的 QQ 号，私聊永远回
  adoptFirstOwner: true, // owner 为空时，把第一个私聊的人认作号主并写回 config.json
  friendAutoAccept: true, // 自动同意好友申请（方便你先加她）
  reply: {
    maxChars: 900, // 单条 QQ 消息上限（超过就拆）
    quote: false, // 群里是否引用回复
    atSender: false, // 群里回复时是否 @ 对方
  },
  // 表情包：她可以在回复里写 [[sticker:happy_开心]]；别人发的图默认存进 stickers/inbox
  stickers: {
    autoSave: true,
    maxPerMessage: 3,
  },
  // 语音：她写 [[voice:要说的话]]，用 edge-tts 合成
  voice: {
    enabled: true,
    voice: 'zh-CN-XiaoyiNeural',
    maxChars: 60,
  },
  // 聊天记忆：按天存成 qq-memory/YYYY-MM-DD.md（相对 agent.cwd），
  // 每条消息都把最近 days 天带进 prompt；对方提到具体哪天，再单独读那天。
  memory: {
    enabled: true,
    dir: 'qq-memory',
    days: 7,
    perDayChars: 2200, // 一天最多带多少字（超了留最近的）
    totalChars: 9000, // 整段记忆上限（约 4~5k token）
    maxMsgChars: 600, // 单条记录超过就截断
  },
  limits: { perChatQueue: 4, globalConcurrent: 2 },
};

function loadConfig() {
  const file = path.join(HERE, 'config.json');
  let user = {};
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = {
    ...DEFAULTS,
    ...user,
    onebot: { ...DEFAULTS.onebot, ...(user.onebot || {}) },
    agent: { ...DEFAULTS.agent, ...(user.agent || {}) },
    group: { ...DEFAULTS.group, ...(user.group || {}) },
    reply: { ...DEFAULTS.reply, ...(user.reply || {}) },
    stickers: { ...DEFAULTS.stickers, ...(user.stickers || {}) },
    voice: { ...DEFAULTS.voice, ...(user.voice || {}) },
    memory: { ...DEFAULTS.memory, ...(user.memory || {}) },
    limits: { ...DEFAULTS.limits, ...(user.limits || {}) },
  };
  cfg.owner = (cfg.owner || []).map(String);
  cfg.privateAllowlist = (cfg.privateAllowlist || []).map(String);
  cfg.group.allowlist = (cfg.group.allowlist || []).map(String);
  return cfg;
}

function saveConfig(cfg) {
  const file = path.join(HERE, 'config.json');
  try {
    const out = { ...cfg };
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    log('[config] 已写回 config.json');
  } catch (e) {
    log('[config] 写回失败', e.message);
  }
}

// ---------------------------------------------------------------- memory

let mem = null; // 启动时按 config.memory 初始化

/** 把「最近几天 + 对方提到的那天」拼在这条消息前面 */
function buildPrompt({ chat, scope, line, text }) {
  if (!mem) return line;
  const block = mem.block({ chat, scope, text });
  if (!block) return line;
  log(`[memory] ${chat} 注入 ${block.length} 字`);
  return `${block}\n\n【现在的消息】\n${line}`;
}

// ---------------------------------------------------------------- logging

fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `bridge-${new Date().toISOString().slice(0, 10)}.log`);

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, line + '\n');
  } catch {}
}

// dsh 是 npm 的 .cmd/.ps1 shim，spawn 不能直接跑；这里定位真正的 bin.js。
function resolveDshBin() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    path.join(process.env.ProgramFiles || '', 'nodejs', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

// ---------------------------------------------------------------- ACP client

class AcpClient {
  constructor({ profile, cwd, model, promptTimeoutMs, dshBin }) {
    this.profile = profile;
    this.cwd = cwd;
    this.model = model;
    this.promptTimeoutMs = promptTimeoutMs;
    this.dshBin = dshBin || resolveDshBin();
    this.nextId = 1;
    this.pending = new Map();
    this.collectors = new Map();
    this.buffer = '';
    this.child = null;
    this.ready = null;
    this.stopping = false;
  }

  start() {
    if (this.ready) return this.ready;
    log(`[acp] 启动 dsh --profile ${this.profile}`);
    if (!this.dshBin) {
      this.ready = Promise.reject(new Error('找不到 dsh 的 bin.js，请在 config.json 里设置 agent.dshBin'));
      this.ready.catch(() => {});
      return this.ready;
    }
    this.child = spawn(process.execPath, [this.dshBin, '--profile', this.profile], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (d) => this.#feed(d));
    this.child.stderr.on('data', (d) => {
      const t = String(d).trim();
      if (t && !t.includes('DeprecationWarning')) log('[acp:stderr]', t.slice(0, 400));
    });
    this.child.on('exit', (code, signal) => {
      log(`[acp] 退出 code=${code} signal=${signal}`);
      this.ready = null;
      this.child = null;
      for (const { reject } of this.pending.values()) reject(new Error('acp exited'));
      this.pending.clear();
      for (const c of this.collectors.values()) c.fail?.(new Error('acp exited'));
      this.collectors.clear();
      if (!this.stopping) setTimeout(() => this.start().catch(() => {}), 3000);
    });

    this.ready = this.#request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: 'qq-bridge', version: '1.0.0' },
    }).then((res) => {
      log('[acp] 已连接', res?.agentInfo?.name || '');
      return res;
    });
    return this.ready;
  }

  #feed(chunk) {
    this.buffer += chunk;
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        log('[acp:noise]', line.slice(0, 200));
        continue;
      }
      this.#handle(msg);
    }
  }

  #handle(msg) {
    if (msg.id != null && msg.method) {
      // 服务端发来的请求：权限询问自动允许
      let result = {};
      if (msg.method === 'session/request_permission') {
        const opts = msg.params?.options || [];
        const allow =
          opts.find((o) => /allow/i.test(o.optionId || '') || /allow|允许/i.test(o.name || '')) ||
          opts[0];
        result = allow
          ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
          : { outcome: { outcome: 'cancelled' } };
        log('[acp] 权限请求 -> 自动', JSON.stringify(result));
      } else {
        log('[acp] 未处理的服务端请求', msg.method);
      }
      this.#write({ jsonrpc: '2.0', id: msg.id, result });
      return;
    }

    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }

    if (msg.method === 'session/update') {
      const { sessionId, update } = msg.params || {};
      const col = this.collectors.get(sessionId);
      if (!col || !update) return;
      if (update.sessionUpdate === 'agent_message_chunk') {
        const t = update.content?.text;
        if (t) col.text += t;
      } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
        col.tools.add(update.title || update.toolCallId || 'tool');
      }
    }
  }

  #write(obj) {
    if (!this.child) throw new Error('acp not running');
    this.child.stdin.write(JSON.stringify(obj) + '\n');
  }

  #request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.#write({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  async session(key, savedId) {
    await this.start();
    if (savedId) {
      try {
        const r = await this.#request('session/resume', { sessionId: savedId, cwd: this.cwd, mcpServers: [] });
        log(`[acp] 恢复会话 ${key} -> ${savedId}`);
        return r.sessionId || savedId;
      } catch (e) {
        log(`[acp] 恢复失败（${key}）: ${e.message}，新建会话`);
      }
    }
    const r = await this.#request('session/new', { cwd: this.cwd, mcpServers: [] });
    const id = r.sessionId;
    log(`[acp] 新会话 ${key} -> ${id}`);
    if (this.model) {
      try {
        await this.#request('session/set_config_option', {
          sessionId: id,
          configId: 'model',
          value: this.model,
        });
      } catch (e) {
        log('[acp] 设置模型失败', e.message);
      }
    }
    return id;
  }

  async prompt(sessionId, text) {
    await this.start();
    const col = { text: '', tools: new Set() };
    this.collectors.set(sessionId, col);

    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => {
        rej(new Error('prompt timeout'));
        this.#request('session/cancel', { sessionId }).catch(() => {});
      }, this.promptTimeoutMs);
    });

    try {
      const res = await Promise.race([
        this.#request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }),
        timeout,
      ]);
      return { text: col.text.trim(), tools: [...col.tools], stopReason: res?.stopReason };
    } finally {
      clearTimeout(timer);
      this.collectors.delete(sessionId);
    }
  }

  stop() {
    this.stopping = true;
    try {
      this.child?.kill();
    } catch {}
  }
}

// ---------------------------------------------------------------- OneBot client

class OneBot {
  constructor({ url, token, onMessage }) {
    this.url = url;
    this.token = token;
    this.onMessage = onMessage;
    this.ws = null;
    this.selfId = null;
    this.nextEcho = 1;
    this.pending = new Map();
    this.backoff = 1000;
  }

  connect() {
    const sep = this.url.includes('?') ? '&' : '?';
    const url = this.token ? `${this.url}${sep}access_token=${encodeURIComponent(this.token)}` : this.url;
    log('[onebot] 连接', this.url);
    const ws = new WebSocket(url, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.backoff = 1000;
      log('[onebot] 已连接');
      this.call('get_login_info', {})
        .then((d) => {
          this.selfId = String(d.user_id);
          log(`[onebot] 登录为 ${d.nickname}(${d.user_id})`);
        })
        .catch((e) => log('[onebot] get_login_info 失败', e.message));
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.echo != null && this.pending.has(msg.echo)) {
        const { resolve, reject } = this.pending.get(msg.echo);
        this.pending.delete(msg.echo);
        if (msg.status === 'ok' || msg.retcode === 0) resolve(msg.data);
        else reject(new Error(msg.wording || msg.message || `retcode ${msg.retcode}`));
        return;
      }
      if (msg.post_type === 'message' || msg.post_type === 'request') {
        try {
          this.onMessage(msg, this);
        } catch (e) {
          log('[onebot] 处理消息出错', e.stack || e.message);
        }
      } else if (msg.post_type === 'meta_event' && msg.meta_event_type === 'lifecycle') {
        log('[onebot] lifecycle', msg.sub_type);
      }
    });

    ws.addEventListener('close', () => {
      log('[onebot] 断开，重连中…');
      this.ws = null;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 1.7, 30000);
    });

    ws.addEventListener('error', () => {
      // close 会跟着来
    });
  }

  call(action, params = {}) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('onebot not connected'));
    const echo = `c${this.nextEcho++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(echo, { resolve, reject });
      this.ws.send(JSON.stringify({ action, params, echo }));
      setTimeout(() => {
        if (this.pending.has(echo)) {
          this.pending.delete(echo);
          reject(new Error(`${action} timeout`));
        }
      }, 20000);
    });
  }
}

// ---------------------------------------------------------------- message plumbing

function segmentsOf(event) {
  const m = event.message;
  if (Array.isArray(m)) return m;
  return [{ type: 'text', data: { text: String(m ?? '') } }];
}

function toText(event, selfId) {
  const parts = [];
  const images = [];
  let mentioned = false;
  let replyId = '';
  for (const seg of segmentsOf(event)) {
    const type = seg.type;
    const data = seg.data || {};
    if (type === 'text') parts.push(data.text || '');
    else if (type === 'at') {
      if (String(data.qq) === String(selfId)) mentioned = true;
      if (data.qq !== 'all') parts.push(`@${data.name || data.qq} `);
    } else if (type === 'image') {
      parts.push('[图片]');
      if (data.url) images.push(String(data.url));
    } else if (type === 'face') parts.push('');
    else if (type === 'file') parts.push(`[文件 ${data.name || ''}]`);
    else if (type === 'reply') replyId = String(data.id || '');
    else if (type === 'forward') parts.push('[合并转发]');
    else if (type === 'record') parts.push('[语音]');
    else if (type === 'video') parts.push('[视频]');
  }
  return { text: parts.join('').trim(), mentioned, replyId, images };
}

function senderName(event) {
  return event.sender?.card || event.sender?.nickname || String(event.user_id);
}

function splitMessage(text, max) {
  text = text.replace(/\r/g, '').trim();
  if (!text) return [];
  if (text.length <= max) return [text];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** 把别人发来的图存进 stickers/inbox，返回文件名列表 */
async function saveImages(urls) {
  const saved = [];
  if (!cfg.stickers?.autoSave) return saved;
  const max = cfg.stickers?.maxPerMessage || 3;
  for (const u of (urls || []).slice(0, max)) {
    try {
      const name = await saveIncomingImage(u);
      if (name) saved.push(name);
    } catch (e) {
      log('[sticker] 存图片失败：', e.message);
    }
  }
  return saved;
}

/**
 * 把她的回复发出去：文字 / 表情包 / 语音。
 * 标记见 reply.mjs：[[sticker:名字]]、[[voice:要说的话]]
 */
async function deliver(raw, send, { atSender = false, atQQ } = {}) {
  const safe = async (segs) => {
    try {
      await send(segs);
    } catch (e) {
      log('[send] 发送失败：', e.message);
    }
  };
  for (const part of parseReply(raw)) {
    if (part.type === 'text') {
      for (const chunk of splitMessage(part.text, cfg.reply.maxChars)) {
        const segs = [];
        if (atSender) segs.push({ type: 'at', data: { qq: atQQ } });
        segs.push({ type: 'text', data: { text: (atSender ? ' ' : '') + chunk } });
        await safe(segs);
      }
    } else if (part.type === 'sticker') {
      await safe([{ type: 'image', data: { file: pathToFileURL(part.path).href } }]);
      log('[reply] 表情包', path.basename(part.path));
    } else if (part.type === 'voice') {
      const mp3 = await synthVoice(part.text, {
        voice: cfg.voice?.voice,
        maxChars: cfg.voice?.maxChars,
        enabled: cfg.voice?.enabled !== false,
      });
      if (mp3) {
        await safe([{ type: 'record', data: { file: pathToFileURL(mp3).href } }]);
        log('[reply] 语音', part.text.slice(0, 20));
      } else {
        await safe([{ type: 'text', data: { text: part.text } }]);
      }
    }
  }
}

// ---------------------------------------------------------------- sessions / queues

class ChatRuntime {
  constructor(cfg, acp, onebot) {
    this.cfg = cfg;
    this.acp = acp;
    this.onebot = onebot;
    this.sessions = this.#loadState();
    this.queues = new Map();
    this.active = 0;
    this.recent = new Map(); // key -> {lastAt, count, windowStart}
  }

  #loadState() {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
      return {};
    }
  }

  #saveState() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.sessions, null, 2));
    } catch (e) {
      log('[state] 保存失败', e.message);
    }
  }

  cooldownOk(key, opts = {}) {
    if (!key.startsWith('g:')) return true;
    const cooldownSec = opts.cooldownSec ?? this.cfg.group.cooldownSec;
    const maxPerHour = opts.maxPerHour ?? this.cfg.group.maxPerHour;
    const now = Date.now();
    const r = this.recent.get(key) || { lastAt: 0, windowStart: now, count: 0 };
    if (now - r.windowStart > 3600_000) {
      r.windowStart = now;
      r.count = 0;
    }
    if (now - r.lastAt < cooldownSec * 1000) return false;
    if (maxPerHour > 0 && r.count >= maxPerHour) return false;
    r.lastAt = now;
    r.count += 1;
    this.recent.set(key, r);
    return true;
  }

  async ask(key, promptText) {
    const q = this.queues.get(key) || [];
    if (q.length >= this.cfg.limits.perChatQueue) {
      log(`[queue] ${key} 队列满，丢弃`);
      return null;
    }
    return new Promise((resolve) => {
      q.push({ promptText, resolve });
      this.queues.set(key, q);
      this.#pump(key);
    });
  }

  async #pump(key) {
    const q = this.queues.get(key);
    if (!q || q.length === 0) return;
    if (q.running) return;
    if (this.active >= this.cfg.limits.globalConcurrent) {
      setTimeout(() => this.#pump(key), 500);
      return;
    }
    q.running = true;
    const job = q.shift();
    this.active += 1;
    try {
      const saved = this.sessions[key];
      const sessionId = await this.acp.session(key, saved);
      this.sessions[key] = sessionId;
      this.#saveState();
      const res = await this.acp.prompt(sessionId, job.promptText);
      job.resolve(res);
    } catch (e) {
      log(`[ask] ${key} 失败: ${e.message}`);
      // 会话可能坏了：丢掉映射，下次重建
      delete this.sessions[key];
      this.#saveState();
      job.resolve(null);
    } finally {
      this.active -= 1;
      q.running = false;
      this.#pump(key);
    }
  }
}

// ---------------------------------------------------------------- policy + dispatch

async function handleEvent(event, onebot, rt, cfg) {
  if (event.post_type === 'request') {
    if (event.request_type === 'friend' && cfg.friendAutoAccept) {
      try {
        await onebot.call('set_friend_add_request', { flag: event.flag, approve: true });
        log(`[friend] 已同意好友申请：${event.user_id}（${event.comment || ''}）`);
      } catch (e) {
        log('[friend] 同意失败', e.message);
      }
    }
    return;
  }
  if (event.post_type !== 'message') return;
  if (event.user_id && String(event.user_id) === String(onebot.selfId)) return; // 自己的消息

  const selfId = onebot.selfId;
  const { text, mentioned, replyId, images } = toText(event, selfId);
  if (!text) return;

  const isGroup = event.message_type === 'group';
  const userId = String(event.user_id);
  const name = senderName(event);
  log(`[msg] ${isGroup ? 'group:' + event.group_id : 'private'} ${name}(${userId}): ${text.slice(0, 60)}`);

  if (isGroup) {
    const g = cfg.group;
    if (g.allowlist.length && !g.allowlist.includes(String(event.group_id))) return;
    // 有人「回复」她的消息，也算在跟她说话（不用非得 @）
    let replyToMe = false;
    if (replyId) {
      try {
        const m = await onebot.call('get_msg', { message_id: replyId });
        replyToMe = String(m?.sender?.user_id || '') === String(selfId);
      } catch (e) {
        log('[reply] 查不到被回复的消息：', e.message);
      }
    }
    // at：只回 @；prefix：@ 或「肥鱼」开头；name：@/回复/提到名字；all：每条都回
    let byName = false;
    if (g.mode === 'name') {
      try {
        byName = new RegExp(g.namePattern || '肥鱼|大肥鱼', 'i').test(text);
      } catch {
        byName = text.includes('肥鱼');
      }
    }
    const should =
      mentioned ||
      replyToMe ||
      g.mode === 'all' ||
      (g.mode === 'prefix' && text.startsWith(g.prefix)) ||
      byName;
    if (!should) return;
    // 号主在群里：5 秒冷却、不限每小时条数；其他人还是 20 秒 / 30 条
    const isOwner = cfg.owner.includes(String(userId));
    const coolKey = isOwner ? `g:${event.group_id}:owner` : `g:${event.group_id}`;
    const coolSec = isOwner ? (cfg.group.ownerCooldownSec ?? 5) : cfg.group.cooldownSec;
    const capHour = isOwner ? (cfg.group.ownerMaxPerHour ?? 0) : cfg.group.maxPerHour;
    if (!rt.cooldownOk(coolKey, { cooldownSec: coolSec, maxPerHour: capHour })) {
      log(`[skip] 群冷却中（${isOwner ? '号主' : '其他人'} ${coolSec}s / ${capHour || '∞'}每小时）`, event.group_id);
      return;
    }
    const chat = `群 ${event.group_id}`;
    const savedImgs = await saveImages(images);
    const imgNote = savedImgs.length ? `（图已存到 stickers/inbox：${savedImgs.join('、')}）` : '';
    const line = `【QQ群 ${event.group_name || event.group_id}】${name}(${userId}) 说：${replyToMe ? '（这条是回复你上面那句话的）' : ''}${text}${imgNote}`;
    // 先按「之前的记录」拼好提示，再把这条记进去，免得同一条消息出现两次
    const prompt = buildPrompt({ chat, scope: 'chat', line, text });
    mem?.record({ chat, speaker: name, text: text + imgNote });
    const res = await rt.ask(`g:${event.group_id}`, prompt);
    if (!res || !res.text) return;
    mem?.record({ chat, speaker: '我', text: plainText(res.text) });
    await deliver(
      res.text,
      async (message) => {
        await onebot.call('send_group_msg', { group_id: event.group_id, message });
      },
      { atSender: cfg.reply.atSender, atQQ: userId },
    );
    log(`[reply] group ${event.group_id} -> ${name}: ${res.text.slice(0, 60)}…`);
    return;
  }

  // 私聊
  let isOwner = cfg.owner.includes(userId);
  if (!isOwner && cfg.owner.length === 0 && cfg.adoptFirstOwner) {
    cfg.owner.push(userId);
    isOwner = true;
    log(`[owner] 认下号主：${name}(${userId})，已写回 config.json`);
    saveConfig(cfg);
  }
  if (!isOwner) {
    if (cfg.privatePolicy === 'owner') return;
    if (cfg.privatePolicy === 'allowlist' && !cfg.privateAllowlist.includes(userId)) return;
  }

  const chat = `私聊 ${userId}`;
  // 号主私聊能翻到所有会话的记录；别人的私聊只看自己这个会话
  const scope = isOwner ? 'all' : 'chat';
  const savedImgs = await saveImages(images);
  const imgNote = savedImgs.length ? `（图已存到 stickers/inbox：${savedImgs.join('、')}）` : '';
  const line = `【QQ私聊】${name}(${userId}) 说：${text}${imgNote}`;
  const prompt = buildPrompt({ chat, scope, line, text }); // 先拼提示，再记这条
  mem?.record({ chat, speaker: name, text: text + imgNote });
  const res = await rt.ask(`p:${userId}`, prompt);
  if (!res || !res.text) return;
  mem?.record({ chat, speaker: '我', text: plainText(res.text) });
  await deliver(res.text, async (message) => {
    await onebot.call('send_private_msg', { user_id: event.user_id, message });
  });
  log(`[reply] private ${userId} -> ${res.text.slice(0, 60)}…`);
}

// ---------------------------------------------------------------- main

const cfg = loadConfig();
const args = process.argv.slice(2);

// 聊天记忆：按天存 Markdown，相对 agent.cwd（也就是工作区，她能自己读）
const memoryDir = path.isAbsolute(cfg.memory.dir) ? cfg.memory.dir : path.resolve(cfg.agent.cwd, cfg.memory.dir);
if (cfg.memory.enabled) {
  mem = new QQMemory({ ...cfg.memory, dir: memoryDir });
  log(`[memory] ${memoryDir}（最近 ${cfg.memory.days} 天）`);
}

const acp = new AcpClient(cfg.agent);
const onebot = new OneBot({
  url: cfg.onebot.url,
  token: cfg.onebot.token,
  onMessage: () => {},
});
const rt = new ChatRuntime(cfg, acp, onebot);
onebot.onMessage = (ev, ob) => handleEvent(ev, ob, rt, cfg).catch((e) => log('[dispatch]', e.stack || e.message));

if (args[0] === '--once') {
  const text = args.slice(1).join(' ') || '你是谁？用一句话回答。';
  const res = await rt.ask('local:test', text);
  console.log('\n=== 回复 ===\n' + (res?.text || '(空)'));
  console.log('=== 工具 ===', res?.tools?.join(', ') || '(无)');
  acp.stop();
  process.exit(0);
}

log('qq-bridge 启动');
acp.start().catch((e) => log('[acp] 启动失败', e.message));
onebot.connect();

process.on('SIGINT', () => {
  log('正在退出');
  acp.stop();
  process.exit(0);
});
