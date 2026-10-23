#!/usr/bin/env node
/**
 * 每天自己刷 B站 的小管家
 *
 * 启动后：今天在 config.windows 里随机挑一个时段、随机一个分钟，
 * 到点有 runChance 的概率真的去刷（真人不会天天准点打卡），跑完就等明天。
 *
 *   node bili/serve.mjs        常驻
 *   node bili/serve.mjs --now  立刻刷一轮（测试用）
 *
 * 退出就重开，它会读 bili/data/serve-state.json，不会一天刷两遍。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runDaily } from './daily.mjs';
import { readConfig, readJson, writeJson, DATA_DIR, nowParts, localDate, randInt, pick, pad } from './lib/config.mjs';

const LOG_DIR = join(DATA_DIR, '..', 'logs');
const STATE_FILE = join(DATA_DIR, 'serve-state.json');

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, `serve-${localDate()}.log`), line + '\n', 'utf8');
  } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function planDay(date, cfg) {
  const windows = (cfg.windows || []).filter((w) => Array.isArray(w) && w.length === 2);
  const [h1, h2] = windows.length ? pick(windows) : [14, 16];
  const hour = randInt(h1, Math.max(h1, h2 - 1));
  const minute = randInt(0, 59);
  const at = new Date(`${date}T${pad(hour)}:${pad(minute)}:00+08:00`);
  return { date, at: at.toISOString(), hour, minute, run: Math.random() < cfg.runChance };
}

async function main() {
  const cfg = readConfig();
  if (process.argv.includes('--now')) {
    log('手动跑一轮');
    const r = await runDaily({ fast: process.argv.includes('--fast') });
    log('跑完：', JSON.stringify(r).slice(0, 300));
    return;
  }

  log('bili 小管家启动');
  let st = readJson(STATE_FILE, {});
  if (!st.plan || st.plan.date !== localDate()) {
    st = { ...st, plan: planDay(localDate(), cfg) };
    log(`今天计划 ${pad(st.plan.hour)}:${pad(st.plan.minute)}（${st.plan.run ? '会刷' : '随机到不刷'}）`);
  }
  writeJson(STATE_FILE, { ...st, heartbeat: new Date().toISOString() });

  while (true) {
    const today = localDate();
    st = readJson(STATE_FILE, {});
    if (st.plan?.date !== today && st.doneDate !== today) {
      st.plan = planDay(today, cfg);
      log(`新的一天，计划 ${pad(st.plan.hour)}:${pad(st.plan.minute)}（${st.plan.run ? '会刷' : '随机到不刷'}）`);
    }
    st.heartbeat = new Date().toISOString(); // 面板靠这个判断小管家在不在线
    writeJson(STATE_FILE, st);

    const wait = Date.parse(st.plan.at) - Date.now();

    if (wait > 0) {
      await sleep(Math.min(wait, 20 * 60_000));
      continue;
    }

    if (st.doneDate === today) {
      await sleep(20 * 60_000); // 今天已经处理过，等跨天
      continue;
    }

    // 到点了：太晚（超过 6 小时）就不补了，像人一样错过就算了
    const late = -wait;
    if (late > 6 * 3600_000) {
      log('今天的时间错过了，跳过');
      st.doneDate = today;
      writeJson(STATE_FILE, st);
      continue;
    }

    st.doneDate = today;
    writeJson(STATE_FILE, st);

    if (!st.plan.run) {
      log('今天懒得刷（随机决定）');
      continue;
    }

    log('开始刷今天的 B站');
    try {
      const r = await runDaily();
      log('刷完：', JSON.stringify({ count: r.videos?.length, skipped: r.skipped }));
    } catch (e) {
      log('刷失败了：', e.message);
    }
  }
}

main().catch((e) => {
  log('挂了：', e.stack || e.message);
  process.exit(1);
});
