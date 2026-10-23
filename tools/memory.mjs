#!/usr/bin/env node
/**
 * 记忆工具箱：翻、归档、看体积
 *
 *   node tools/memory.mjs digest [天数]    把最近几天 QQ/微信/B站 记忆拼成一段（她和我都能用）
 *   node tools/memory.mjs stats            三个记忆目录各多少天、多少字
 *   node tools/memory.mjs archive [天数]   把 N 天前的按天文件并进 archive/YYYY-MM.md（默认 90 天）
 *   node tools/memory.mjs archive --dry    只看会动哪些，不真动
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, renameSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(HERE, '..');

const DIRS = {
  QQ: join(WORKSPACE, 'qq-memory'),
  '微信': join(WORKSPACE, 'weixin-memory'),
  'B 站': join(WORKSPACE, 'bili-memory'),
};

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return s;
};

function days(n, from = new Date()) {
  const base = new Date(`${localDate(from)}T12:00:00+08:00`).getTime();
  return Array.from({ length: n }, (_, i) => localDate(new Date(base - i * 86400_000)));
}

function readIf(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// ─── digest ───────────────────────────────────────────────
function digest(n = 3) {
  const out = [];
  for (const date of days(n)) {
    for (const [name, dir] of Object.entries(DIRS)) {
      const text = readIf(join(dir, `${date}.md`));
      if (!text) continue;
      out.push(`## ${name} · ${date}`);
      if (name === 'B 站') {
        // 只挑标题和喜欢分，别把整段字幕倒出来
        const vids = text.split(/^### /m).slice(1);
        for (const v of vids) {
          const title = v.split('\n')[0].replace(/^\d+\.\s*/, '');
          const like = /- 喜欢：(\d)\/5/.exec(v);
          if (title) out.push(`- ${title}${like ? `（${like[1]}/5）` : ''}`);
        }
      } else {
        out.push(text.replace(/^#.*\n+/, '').trim());
      }
      out.push('');
    }
  }
  return out.join('\n').trim();
}

// ─── stats ────────────────────────────────────────────────
function stats() {
  for (const [name, dir] of Object.entries(DIRS)) {
    if (!existsSync(dir)) {
      console.log(`${name}：没有目录`);
      continue;
    }
    const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    const bytes = files.reduce((s, f) => s + statSync(join(dir, f)).size, 0);
    const arch = existsSync(join(dir, 'archive')) ? readdirSync(join(dir, 'archive')).length : 0;
    console.log(
      `${name}：${files.length} 天，${(bytes / 1024).toFixed(1)} KB` +
        `${files.length ? `（最早 ${files.sort()[0]}，最新 ${files.sort().at(-1)}）` : ''}` +
        `${arch ? `，归档 ${arch} 个` : ''}`,
    );
  }
}

// ─── archive ──────────────────────────────────────────────
function archive(cutoffDays = 90, dry = false) {
  const cut = days(cutoffDays).at(-1);
  let moved = 0;
  for (const [name, dir] of Object.entries(DIRS)) {
    if (!existsSync(dir)) continue;
    const old = readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f.slice(0, 10) < cut)
      .sort();
    if (!old.length) continue;
    if (dry) {
      console.log(`${name}：会归档 ${old.length} 天（${old[0]} … ${old.at(-1)}）`);
      continue;
    }
    const archDir = join(dir, 'archive');
    mkdirSync(archDir, { recursive: true });
    for (const f of old) {
      const month = f.slice(0, 7);
      const target = join(archDir, `${month}.md`);
      const body = readFileSync(join(dir, f), 'utf8');
      if (!existsSync(target)) writeFileSync(target, `# ${month} 记忆归档\n\n`, 'utf8');
      appendFileSync(target, `\n<!-- ${f} -->\n${body.trim()}\n`, 'utf8');
      rmSync(join(dir, f));
      moved++;
    }
    console.log(`${name}：归档了 ${old.length} 天`);
  }
  console.log(dry ? '（dry：什么都没动）' : `共归档 ${moved} 个文件`);
}

// ─── CLI ──────────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2);
const num = (i, d) => (args[i] && !Number.isNaN(Number(args[i])) ? Number(args[i]) : d);

if (cmd === 'digest') {
  const text = digest(num(0, 3));
  console.log(text || '最近几天没有记忆');
} else if (cmd === 'stats') {
  stats();
} else if (cmd === 'archive') {
  archive(num(0, 90), args.includes('--dry'));
} else {
  console.log('用法：node tools/memory.mjs digest [天数] | stats | archive [天数] [--dry]');
  process.exitCode = 1;
}
