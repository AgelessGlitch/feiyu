#!/usr/bin/env node
/**
 * 微信聊天记忆同步：把 DSH 微信通道的对话，按天抄到 weixin-memory/YYYY-MM-DD.md
 *
 * 为什么是「抄」而不是像 QQ 桥接那样当场记：
 * 微信走的是 DSH 自带的 im-connect 网关，我们插不进它的消息处理，
 * 但它会把每个会话写成 ~/.dsh/sessions/<工作区>/<sessionId>/session.v4.jsonl.zstd。
 * 这里就增量地读这些会话日志，落到人能直接看的 Markdown。
 *
 *   node weixin-memory/sync.mjs          同步一次
 *   node weixin-memory/sync.mjs --watch  每分钟同步一次（常驻）
 *
 * 想从头重抄：删掉 weixin-memory/.sync.json（会重新写一遍，注意别把已有文件弄重）。
 *
 * 进度记在 weixin-memory/.sync.json（每个会话最后处理到第几条）。
 * 隐私规则在 weixin-memory/privacy.json：默认给手机号/身份证/银行卡/邮箱打码。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(HERE, '..');
const DSH = join(homedir(), '.dsh');
const SESSIONS_JSON = join(DSH, 'dsh-im-connect', 'sessions.json');
const CHANNELS_JSON = join(DSH, 'dsh-im-connect', 'channels.json');
const SESSIONS_ROOT = join(DSH, 'sessions');
const STATE_FILE = join(HERE, '.sync.json');
const PRIVACY_FILE = join(HERE, 'privacy.json');

const pad = (n) => String(n).padStart(2, '0');
const localParts = (ms) => {
  const d = new Date(ms);
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  const [date, time] = s.split(' ');
  return { date, time };
};

// ─── 隐私 ─────────────────────────────────────────────────
const DEFAULT_PRIVACY = {
  // 号主说的话要不要写（true = 一条都不写号主的）
  skipOwner: false,
  // 打码：手机号 / 身份证 / 银行卡 / 邮箱
  mask: true,
  // 消息里出现这些词就整条跳过（比如「密码」「身份证」「地址」之类）
  skipKeywords: [],
  // 她在记忆里怎么称呼对方
  ownerName: '号主',
  selfName: '我',
};

function readPrivacy() {
  try {
    return { ...DEFAULT_PRIVACY, ...JSON.parse(readFileSync(PRIVACY_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_PRIVACY };
  }
}

function maskText(text, p) {
  let t = String(text || '');
  if (!p.mask) return t;
  t = t.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号]');
  t = t.replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[身份证]');
  t = t.replace(/(?<!\d)\d{16,19}(?!\d)/g, '[卡号]');
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[邮箱]');
  return t;
}

// ─── 读会话日志（zstd 多帧）────────────────────────────────
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function frameTexts(buf) {
  const idx = [];
  let i = 0;
  while ((i = buf.indexOf(MAGIC, i)) !== -1) {
    idx.push(i);
    i += 4;
  }
  const out = [];
  for (let k = 0; k < idx.length; k++) {
    const s = idx[k];
    const e = idx[k + 1] ?? buf.length;
    try {
      out.push(zlib.zstdDecompressSync(buf.subarray(s, e)).toString('utf8'));
    } catch {
      /* 半截帧（正在写）就跳过，下次再来 */
    }
  }
  return out.join('');
}

function readRecords(file) {
  const buf = readFileSync(file);
  return frameTexts(buf)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** 扫一遍所有会话目录，读第一帧拿 id → 文件路径 */
function buildIndex() {
  const map = new Map();
  for (const ws of readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    const wsDir = join(SESSIONS_ROOT, ws.name);
    for (const d of readdirSync(wsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const file = join(wsDir, d.name, 'session.v4.jsonl.zstd');
      if (!existsSync(file)) continue;
      try {
        const buf = readFileSync(file);
        const firstEnd = buf.indexOf(MAGIC, 4);
        const head = zlib.zstdDecompressSync(buf.subarray(0, firstEnd > 0 ? firstEnd : buf.length)).toString('utf8');
        const rec = JSON.parse(head.split('\n')[0]);
        if (rec?.id) map.set(rec.id, file);
      } catch {
        /* 坏文件跳过 */
      }
    }
  }
  return map;
}

// ─── 抽取消息 ─────────────────────────────────────────────
const SYNTHETIC = [/^Current runtime context/, /^<system-reminder>/, /^Time sampled while preparing/];

function extract(recs, p) {
  const out = [];
  let lastSeq = 0;
  for (const r of recs) {
    const seq = Number(r.seq || 0);
    if (seq > lastSeq) lastSeq = seq;

    if (r.type === 'user/message') {
      const text = (r.data?.content || []).map((c) => c.text).filter(Boolean).join(' ');
      if (!text || SYNTHETIC.some((re) => re.test(text.trim()))) continue;
      out.push({ seq, time: Number(r.time) || 0, who: 'owner', text });
    } else if (r.type === 'assistant/message') {
      const parts = r.data?.message?.content || [];
      const text = parts.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      if (!text) continue;
      out.push({ seq, time: Number(r.time) || 0, who: 'self', text });
    }
  }
  return { messages: out, lastSeq };
}

// ─── 同步 ─────────────────────────────────────────────────
function weixinSessions() {
  const sessions = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'));
  let channels = { channels: {} };
  try {
    channels = JSON.parse(readFileSync(CHANNELS_JSON, 'utf8'));
  } catch {}
  const plat = (id) => channels.channels?.[id]?.platform || '';
  return Object.values(sessions)
    .filter((s) => plat(s.channel) === 'weixin' || /weixin/i.test(s.channel || ''))
    .map((s) => ({ sessionId: s.sessionId, channel: s.channel, chatId: s.chatId, kind: s.kind }));
}

// 索引缓存：会话文件不会常变，`--watch` 时别每分钟把所有日志读一遍
let indexCache = { at: 0, map: null };
function index(force = false) {
  if (!force && indexCache.map && Date.now() - indexCache.at < 600_000) return indexCache.map;
  indexCache = { at: Date.now(), map: buildIndex() };
  return indexCache.map;
}

function syncOnce() {
  const p = readPrivacy();
  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
  let idx = index();
  let wrote = 0;

  for (const s of weixinSessions()) {
    let file = idx.get(s.sessionId);
    if (!file) {
      idx = index(true); // 可能是刚建的新会话，强制刷一次索引
      file = idx.get(s.sessionId);
    }
    if (!file) {
      console.log(`[skip] 找不到会话日志：${s.sessionId}`);
      continue;
    }
    const recs = readRecords(file);
    const { messages, lastSeq } = extract(recs, p);
    const from = Number(state[s.sessionId]?.lastSeq || 0);
    const fresh = messages.filter((m) => m.seq > from);
    if (!fresh.length) {
      state[s.sessionId] = { lastSeq: Math.max(from, lastSeq) };
      continue;
    }

    for (const m of fresh) {
      if (m.who === 'owner' && p.skipOwner) continue;
      if (!m.text.trim()) continue;
      if (p.skipKeywords.some((k) => k && m.text.includes(k))) continue;
      const { date, time } = localParts(m.time || Date.now());
      mkdirSync(HERE, { recursive: true });
      const dayFile = join(HERE, `${date}.md`);
      if (!existsSync(dayFile)) writeFileSync(dayFile, `# ${date} · 微信\n\n`, 'utf8');
      const who = m.who === 'owner' ? p.ownerName : p.selfName;
      appendFileSync(dayFile, `- ${time} ${who}：${maskText(m.text, p).replace(/\s+/g, ' ').slice(0, 500)}\n`, 'utf8');
      wrote++;
    }
    state[s.sessionId] = { lastSeq: Math.max(lastSeq, from) };
  }

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  console.log(`[sync] 新增 ${wrote} 条，会话 ${Object.keys(state).length} 个`);
}

// ─── CLI ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const once = () => {
  try {
    syncOnce();
  } catch (e) {
    console.error('[sync] 失败：', e.message);
  }
};

if (args.includes('--watch')) {
  console.log('[sync] 每分钟同步一次（Ctrl+C 停）');
  once();
  setInterval(once, 60_000);
} else {
  once();
}
