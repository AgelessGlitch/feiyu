/**
 * 回复里的「非文字」部分：表情包、语音
 *
 * 她在回复里可以写标记，桥接会把标记换成真正的 QQ 消息段：
 *
 *   [[sticker:happy_开心]]     发 stickers/ 里的图（后缀可省）
 *   [[voice:今晚早点睡嘛]]     合成语音发出去（默认 edge-tts 小艺，软萌女声）
 *
 * 没写标记的部分照旧当文字发。
 * 语音合成失败会退回文字，不会把整条回复弄丢。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(HERE, '..');
const STICKERS_DIR = join(WORKSPACE, 'stickers');
const INBOX_DIR = join(STICKERS_DIR, 'inbox');
const TMP_DIR = join(WORKSPACE, 'tools', 'voice-tmp');
const PYLIB = join(WORKSPACE, 'tools', 'pylib');

const MARK_RE = /\[\[\s*(sticker|voice)\s*:\s*([^\]]+?)\s*\]\]/gi;
const pad = (n) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 把一条回复拆成 [{type:'text',text}|{type:'sticker',path}|{type:'voice',text}] */
export function parseReply(raw) {
  const text = String(raw || '');
  const parts = [];
  let last = 0;
  let m;
  MARK_RE.lastIndex = 0;
  while ((m = MARK_RE.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before.trim()) parts.push({ type: 'text', text: before.trim() });
    last = m.index + m[0].length;
    const kind = m[1].toLowerCase();
    const value = m[2].trim();
    if (kind === 'sticker') {
      const p = resolveSticker(value);
      if (p) parts.push({ type: 'sticker', path: p });
      else parts.push({ type: 'text', text: `（找不到表情「${value}」）` });
    } else {
      parts.push({ type: 'voice', text: value });
    }
  }
  const rest = text.slice(last);
  if (rest.trim()) parts.push({ type: 'text', text: rest.trim() });
  return parts.length ? parts : [{ type: 'text', text }];
}

/** 去掉标记，只留文字（给记忆用） */
export function plainText(raw) {
  return String(raw || '')
    .replace(MARK_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveSticker(name) {
  const n = String(name).trim();
  if (!n) return null;
  const candidates = extname(n) ? [n] : [n, `${n}.png`, `${n}.jpg`, `${n}.gif`, `${n}.webp`];
  for (const c of candidates) {
    for (const d of [STICKERS_DIR, INBOX_DIR]) {
      const p = join(d, c);
      if (existsSync(p)) return p;
    }
  }
  try {
    const all = [...readdirSync(STICKERS_DIR), ...readdirSync(INBOX_DIR)];
    const hit = all.find((f) => f.toLowerCase().includes(n.toLowerCase()));
    if (hit) {
      for (const d of [STICKERS_DIR, INBOX_DIR]) {
        const p = join(d, hit);
        if (existsSync(p)) return p;
      }
    }
  } catch {}
  return null;
}

/** 表情包清单（给 CLI / 面板 / 她自己看） */
export function listStickers() {
  const out = [];
  for (const [dir, tag] of [
    [STICKERS_DIR, 'builtin'],
    [INBOX_DIR, 'inbox'],
  ]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/\.(png|jpe?g|gif|webp)$/i.test(f)) continue;
      out.push({ name: basename(f, extname(f)), file: join(dir, f), tag });
    }
  }
  return out;
}

/** 别人发来的图存进 stickers/inbox/，返回存下来的文件名 */
export async function saveIncomingImage(url, { maxBytes = 2 * 1024 * 1024 } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  mkdirSync(INBOX_DIR, { recursive: true });
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://q.qq.com' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > maxBytes) return null;
  const type = String(res.headers.get('content-type') || '');
  const ext = type.includes('gif') ? 'gif' : type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const name = `${today()}-${String(Date.now()).slice(-5)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  writeFileSync(join(INBOX_DIR, name), buf);
  return name;
}

/** 语音：edge-tts（Python），失败返回 null */
export async function synthVoice(text, { voice = 'zh-CN-XiaoyiNeural', maxChars = 60, enabled = true } = {}) {
  if (!enabled) return null;
  const say = String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
  if (!say) return null;

  mkdirSync(TMP_DIR, { recursive: true });
  const key = Buffer.from(`${voice}|${say}`).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 24);
  const out = join(TMP_DIR, `voice-${key}.mp3`);
  if (existsSync(out) && readFileSync(out).length > 1024) return out;

  const py = process.env.PYTHON || 'python';
  const env = { ...process.env };
  env.PYTHONPATH = [PYLIB, env.PYTHONPATH].filter(Boolean).join(';');

  // speech.platform.bing.com 偶尔连不上（国内网络），多试几次
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await execFileAsync(py, ['-m', 'edge_tts', '--voice', voice, '--text', say, '--write-media', out], {
        env,
        timeout: 60000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch {
      /* 下面统一看文件 */
    }
    if (existsSync(out) && readFileSync(out).length > 1024) return out;
    try {
      if (existsSync(out)) unlinkSync(out);
    } catch {}
    if (attempt < 3) await new Promise((r) => setTimeout(r, 800));
  }
  console.error('[voice] 合成失败（网络连不上）');
  return null;
}
