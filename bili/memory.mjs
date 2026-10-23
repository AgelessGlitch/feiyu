/**
 * B站记忆：一天一个 Markdown 文件，放在工作区的 bili-memory/YYYY-MM-DD.md
 *
 * 结构：
 *   # 2026-10-23 · 我的 B 站
 *   ## 看了什么
 *   ### 1. 【猫】标题
 *   - UP / 时长 / 播放 / 链接 / 喜欢几分 / 内容 / 我 / 字幕摘录
 *   ## 今天整体
 *   ## 动态
 *
 * 和 qq-memory 一个思路：人能直接读、直接改；改坏了最多丢一条。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEMORY_DIR, localDate } from './lib/config.mjs';

export function memoryPath(date = localDate()) {
  return join(MEMORY_DIR, `${date}.md`);
}

function ensureHeader(date) {
  mkdirSync(MEMORY_DIR, { recursive: true });
  const file = memoryPath(date);
  if (!existsSync(file)) {
    writeFileSync(file, `# ${date} · 我的 B 站\n\n`, 'utf8');
  }
  return file;
}

export function appendRaw(date, text) {
  const file = ensureHeader(date);
  appendFileSync(file, text.replace(/\s+$/g, '') + '\n\n', 'utf8');
  return file;
}

const fmtNum = (n) => {
  const x = Number(n) || 0;
  if (x >= 10000) return `${(x / 10000).toFixed(1)} 万`;
  return String(x);
};

const fmtDur = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

/** 记一个视频（index 是当天第几个） */
export function appendVideo(date, video, index) {
  const lines = [
    `### ${index}. 【${video.tname || '视频'}】${video.title}`,
    `- UP：${video.owner || '?'} ｜ 时长：${fmtDur(video.duration)} ｜ 播放：${fmtNum(video.stat?.view)} ｜ 弹幕：${fmtNum(video.stat?.danmaku)}`,
  ];
  if (video.bvid) lines.push(`- 链接：https://www.bilibili.com/video/${video.bvid}`);
  lines.push(`- 喜欢：${video.score || 3}/5`, `- 内容：${video.summary || '（没总结）'}`);
  if (video.thought) lines.push(`- 我：${video.thought}`);
  if (video.subtitleExcerpt) lines.push(`- 字幕：${video.subtitleExcerpt}`);
  const hasSection = (readDay(date) || '').includes('## 看了什么');
  return appendRaw(date, (hasSection ? '' : '## 看了什么\n\n') + lines.join('\n'));
}

export function appendOverall(date, { day, diary }) {
  const lines = ['## 今天整体', day || '（没写）'];
  return appendRaw(date, lines.join('\n'));
}

export function appendDynamicNote(date, text, { posted = false } = {}) {
  return appendRaw(date, ['## 动态', `- ${posted ? '已发' : '草稿（等你点头）'}：${text}`].join('\n'));
}

export function readDay(date = localDate()) {
  const file = memoryPath(date);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** 今天已经看了几个（数 ### 标题） */
export function watchedCount(date = localDate()) {
  const text = readDay(date);
  if (!text) return 0;
  return (text.match(/^### \d+\./gm) || []).length;
}

/** 最近几天看过的 bvid（从链接行里抓），用来去重 */
export function recentBvids(days = 14) {
  const out = new Set();
  const base = new Date(`${localDate()}T12:00:00+08:00`).getTime();
  for (let i = 0; i < days; i++) {
    const d = localDate(new Date(base - i * 86400_000));
    const text = readDay(d);
    if (!text) continue;
    for (const m of text.matchAll(/video\/(BV[\w]+)/g)) out.add(m[1]);
  }
  return out;
}

/** 最近几天记忆的纯文本（给模型或给 QQ 里的她翻） */
export function recentText(days = 3) {
  const base = new Date(`${localDate()}T12:00:00+08:00`).getTime();
  const parts = [];
  for (let i = 0; i < days; i++) {
    const d = localDate(new Date(base - i * 86400_000));
    const text = readDay(d);
    if (text) parts.push(text.trim());
  }
  return parts.join('\n\n---\n\n');
}
