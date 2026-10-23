/**
 * 动作流水：她今天看了/赞了/收了/投了/发了什么
 *
 * bili/data/actions.jsonl，一行一条。面板统计、日记、以后查账都用它。
 * kind: watch | like | favorite | coin | share | comment | dynamic | dynamic_draft
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, localDate } from './config.mjs';

const FILE = join(DATA_DIR, 'actions.jsonl');

export function logAction({ kind, bvid = '', title = '', ok = true, error = '', meta } = {}) {
  mkdirSync(DATA_DIR, { recursive: true });
  const ts = new Date().toISOString();
  const a = { ts, date: localDate(), kind, bvid, title, ok: !!ok };
  if (error) a.error = String(error).slice(0, 200);
  if (meta) a.meta = meta;
  try {
    appendFileSync(FILE, JSON.stringify(a) + '\n', 'utf8');
  } catch {
    /* 记流水失败不该影响主流程 */
  }
  return a;
}

export function readActions() {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, 'utf8')
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

/** 某天的汇总：{ watch: 3, like: 2, ... }（只算成功的） */
export function countByKind(date = localDate()) {
  const out = {};
  for (const a of readActions()) {
    if (a.date !== date || !a.ok) continue;
    out[a.kind] = (out[a.kind] || 0) + 1;
  }
  return out;
}

export function todayActions(date = localDate()) {
  return readActions().filter((a) => a.date === date);
}
