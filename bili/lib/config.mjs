/**
 * 大肥鱼的 B站：配置与路径
 *
 * bili/config.json 里的东西都能直接改；缺的键用下面的默认值补。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const BILI_DIR = join(here, '..');
export const WORKSPACE = join(BILI_DIR, '..');
export const DATA_DIR = join(BILI_DIR, 'data');
export const LOGIN_DIR = join(BILI_DIR, 'login');
export const MEMORY_DIR = join(WORKSPACE, 'bili-memory');
export const DIARY_DIR = join(WORKSPACE, 'feiyu', 'diary');
export const CONFIG_FILE = join(BILI_DIR, 'config.json');

export const DEFAULTS = {
  // 每天看几个、看多久
  watch: {
    perDayMin: 3,
    perDayMax: 5,
    maxDurationSec: 1500, // 超过 25 分钟的不看
    secondsPerVideo: 90, // 每个视频「看」多久（真实心跳，会写进观看历史）
    realWatch: true, // false = 只看详情不播放心跳（不发心跳，很快）
    subtitles: true, // 认真看的视频读字幕（CC / B站 AI 字幕）
    maxSubtitleChars: 1500,
  },
  // 她的喜好：用来挑视频（搜索词），也写给模型当口味
  interests: ['猫', '做饭', '老歌', '悬疑解说', '水族', '天文', '治愈'],
  // 轻互动（保守一点，新号容易被风控）
  like: { chance: 0.6, dailyMax: 3 },
  favorite: { chance: 0.15, dailyMax: 1 },
  // 投币：接口对脚本最敏感，默认关（失败一次就可能锁），要开自己改 true
  coin: { enabled: false, dailyMax: 1 },
  // 总结用的模型：配了 apiKey 就直接调；没配就走 dsh headless（用 DSH 的账号）
  llm: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: '',
    maxTokens: 1200,
  },
  // 发动态：默认只起草、等你点头
  dynamic: { autoPost: false, dailyMax: 1 },
  // 每天在哪几个时段里随机挑一个时间刷（24 小时制，[起, 止)）
  windows: [
    [13, 15],
    [17, 19],
    [21, 24],
  ],
  // 每个时段真的去刷的概率（真人不会天天准点）
  runChance: 0.85,
  // 本地面板
  panel: { port: 8899 },
};

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

export function deepMerge(base, over) {
  if (Array.isArray(base) || !isObj(base)) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = deepMerge(base[k], over[k]);
  return out;
}

export function readConfig() {
  mkdirSync(DATA_DIR, { recursive: true });
  try {
    return deepMerge(DEFAULTS, JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(patch) {
  const next = deepMerge(readConfig(), patch);
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

// ─── 小工具 ────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

/** 本地日期 / 时间（东八区，和号主一致） */
export function nowParts(d = new Date(), timeZone = 'Asia/Shanghai') {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  const [date, time] = s.split(' ');
  return { date, time };
}

export function localDate(d = new Date()) {
  return nowParts(d).date;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, readFileSync(tmp));
  }
}

/** 随机整数 [min, max] */
export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export { pad };
