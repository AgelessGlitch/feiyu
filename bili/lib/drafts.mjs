/**
 * 动态草稿箱：默认「先起草、你点头再发」
 *
 * bili/data/drafts.jsonl，一行一条，同 id 以最后一次状态为准。
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DATA_DIR } from './config.mjs';

const FILE = join(DATA_DIR, 'drafts.jsonl');

function readAll() {
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

export function addDraft({ date, text, kind = 'daily', meta = {} }) {
  mkdirSync(DATA_DIR, { recursive: true });
  const d = { id: randomUUID().slice(0, 8), ts: new Date().toISOString(), date, kind, text, status: 'pending', ...meta };
  appendFileSync(FILE, JSON.stringify(d) + '\n', 'utf8');
  return d;
}

/** 合并同 id 的最后状态 */
export function listDrafts({ status } = {}) {
  const map = new Map();
  for (const d of readAll()) map.set(d.id, { ...(map.get(d.id) || {}), ...d });
  const all = [...map.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return status ? all.filter((d) => d.status === status) : all;
}

export function updateDraft(id, patch) {
  const d = listDrafts().find((x) => x.id === id);
  if (!d) return null;
  const next = { ...d, ...patch, updatedAt: new Date().toISOString() };
  appendFileSync(FILE, JSON.stringify(next) + '\n', 'utf8');
  return next;
}
