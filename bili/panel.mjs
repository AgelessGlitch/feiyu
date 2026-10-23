#!/usr/bin/env node
/**
 * 大肥鱼的 B站 面板：今天刷没刷、看了什么、赞/收/币、下次什么时候刷
 *
 *   node bili/panel.mjs          打开 http://127.0.0.1:8899
 *   node bili/panel.mjs --port 9000
 *
 * 零依赖，只读本地文件（bili-memory / data/actions.jsonl / drafts / serve-state），
 * 账号信息（等级、今日经验）走一次 B站 接口，60 秒缓存一次。
 */
import http from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as bili from './lib/bili.mjs';
import * as memory from './memory.mjs';
import { readConfig, readJson, DATA_DIR, WORKSPACE, localDate, nowParts } from './lib/config.mjs';
import { readActions, countByKind } from './lib/actions.mjs';
import { listDrafts } from './lib/drafts.mjs';

const cfg = readConfig();
const args = process.argv.slice(2);
const portArg = (() => {
  const i = args.indexOf('--port');
  return i >= 0 ? Number(args[i + 1]) : null;
})();
const PORT = portArg || cfg.panel?.port || 8899;

const RUNS = join(DATA_DIR, 'runs.jsonl');
const STATE = join(DATA_DIR, 'serve-state.json');
const QQ_MEMORY = join(WORKSPACE, 'qq-memory');
const WX_MEMORY = join(WORKSPACE, 'weixin-memory');

/** 某个记忆目录今天有几条、最后一句是什么 */
function chatStats(dir, date) {
  const file = join(dir, `${date}.md`);
  if (!existsSync(file)) return { count: 0, last: '' };
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('- '));
  return {
    count: lines.length,
    last: (lines.at(-1) || '').replace(/^-\s*/, '').slice(0, 80),
  };
}

// ─── 解析 bili-memory 一天的内容 ──────────────────────────
function parseDayText(text) {
  const out = { videos: [], overall: '', dynamic: '' };
  if (!text) return out;
  for (const b of text.split(/^### /m).slice(1)) {
    const lines = b.split('\n');
    const head = lines[0].trim();
    const hm = /^(\d+)\.\s*(?:【([^】]*)】)?\s*(.*)$/.exec(head);
    if (!hm) continue;
    const fields = {};
    for (const line of lines.slice(1)) {
      const fm = /^-\s*([^：:]+)[：:](.*)$/.exec(line.trim());
      if (fm) fields[fm[1].trim()] = fm[2].trim();
    }
    const upBit = (fields['UP'] || '').split('｜')[0].trim();
    const score = Number((fields['喜欢'] || '').split('/')[0]) || 0;
    out.videos.push({
      index: Number(hm[1]),
      tname: hm[2] || '',
      title: hm[3] || '',
      up: upBit,
      link: fields['链接'] || '',
      score,
      summary: fields['内容'] || '',
      thought: fields['我'] || '',
    });
  }
  const overall = /## 今天整体\n([\s\S]*?)(?=\n## |$)/.exec(text);
  if (overall) out.overall = overall[1].trim();
  const dyn = /## 动态\n([\s\S]*?)(?=\n## |$)/.exec(text);
  if (dyn) out.dynamic = dyn[1].trim();
  return out;
}

function dayInfo(date) {
  const text = memory.readDay(date);
  const parsed = parseDayText(text);
  const counts = countByKind(date);
  return {
    date,
    hasMemory: !!text,
    videos: parsed.videos,
    overall: parsed.overall,
    dynamic: parsed.dynamic,
    counts,
  };
}

function last7() {
  const base = new Date(`${localDate()}T12:00:00+08:00`).getTime();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = localDate(new Date(base - i * 86400_000));
    days.push(dayInfo(d));
  }
  return days;
}

function readJsonl(file, n = 8) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-n)
    .reverse();
}

function status() {
  const date = localDate();
  const today = dayInfo(date);
  const week = last7();
  const cfgNow = readConfig();
  const serve = readJson(STATE, {});
  const hb = serve.heartbeat ? Date.parse(serve.heartbeat) : 0;
  const online = hb && Date.now() - hb < 2 * 3600_000;
  const plan = serve.plan && serve.plan.date === date ? serve.plan : null;
  const doneToday = serve.doneDate === date;

  return {
    now: new Date().toISOString(),
    date,
    target: { min: cfgNow.watch.perDayMin, max: cfgNow.watch.perDayMax },
    today,
    week,
    coins: liveCache.data?.coins ?? null,
    chats: { qq: chatStats(QQ_MEMORY, date), weixin: chatStats(WX_MEMORY, date) },
    account: {
      loggedIn: bili.isLoggedIn(),
      dynamicAutoPost: !!cfgNow.dynamic.autoPost,
      coinEnabled: !!cfgNow.coin?.enabled,
    },
    limits: {
      like: cfgNow.like.dailyMax,
      favorite: cfgNow.favorite.dailyMax,
      coin: cfgNow.coin?.dailyMax ?? 0,
    },
    scheduler: {
      online,
      heartbeat: serve.heartbeat || null,
      plan: plan ? { at: plan.at, hour: plan.hour, minute: plan.minute, run: plan.run } : null,
      doneToday,
    },
    drafts: listDrafts({ status: 'pending' }).slice(0, 5),
    runs: readJsonl(RUNS, 6),
    actions: readActions().filter((a) => a.date === date).slice(-20).reverse(),
  };
}

// ─── 账号实时信息（60 秒缓存）────────────────────────────
let liveCache = { at: 0, data: null };
async function live() {
  if (Date.now() - liveCache.at < 60_000 && liveCache.data) return liveCache.data;
  if (!bili.isLoggedIn()) {
    liveCache = { at: Date.now(), data: { loggedIn: false } };
    return liveCache.data;
  }
  try {
    const [acc, exp] = await Promise.all([bili.getAccountStatus(), bili.getExpStatus().catch(() => null)]);
    const data = {
      loggedIn: !!acc.loggedIn,
      uname: acc.uname,
      uid: acc.uid,
      level: acc.level,
      coins: acc.coins,
      moral: acc.moral,
      exp: exp
        ? { login: exp.login, watch: exp.watch, share: exp.share, coinsExp: exp.coinsExp }
        : null,
    };
    liveCache = { at: Date.now(), data };
    return data;
  } catch (e) {
    const data = { loggedIn: false, error: e.message };
    liveCache = { at: Date.now(), data };
    return data;
  }
}

// ─── HTTP ─────────────────────────────────────────────────
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === '/api/status') return json(res, 200, status());
    if (url.pathname === '/api/live') return json(res, 200, await live());
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(PAGE);
    }
    res.writeHead(404).end('not found');
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const { time } = nowParts();
  console.log(`🐟 大肥鱼 B站面板：http://127.0.0.1:${PORT}   （${time} 启动）`);
});

// ─── 页面 ─────────────────────────────────────────────────
const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>大肥鱼 · B站面板</title>
<style>
  :root{
    --bg:#0b1020; --card:#121a2e; --line:#24304d; --txt:#e6edf7; --dim:#8b9ab5;
    --accent:#4da3ff; --good:#3ddc97; --warn:#ffb84d; --bad:#ff6b6b;
  }
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,#17233f 0%,var(--bg) 60%);
    color:var(--txt);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;padding:24px}
  .wrap{max-width:1080px;margin:0 auto}
  header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
  h1{font-size:22px;margin:0;font-weight:650}
  .sub{color:var(--dim);font-size:13px}
  .pill{margin-left:auto;padding:5px 12px;border-radius:999px;font-size:12px;border:1px solid var(--line);background:#101830}
  .pill.on{color:var(--good);border-color:#1f5c46}
  .pill.off{color:var(--bad);border-color:#5c2020}
  .banner{border-radius:16px;padding:18px 20px;margin-bottom:16px;border:1px solid var(--line);
    background:linear-gradient(120deg,#16223c,#101830);display:flex;gap:16px;align-items:center;flex-wrap:wrap}
  .banner .big{font-size:19px;font-weight:650}
  .banner .meta{color:var(--dim);font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
  .card .k{color:var(--dim);font-size:12px;margin-bottom:6px}
  .card .v{font-size:22px;font-weight:650}
  .card .v small{font-size:12px;color:var(--dim);font-weight:400}
  h2{font-size:15px;margin:22px 0 10px;color:#cfe0ff;font-weight:600}
  .list{display:flex;flex-direction:column;gap:10px}
  .item{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
  .item .row1{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
  .tag{font-size:11px;color:var(--accent);border:1px solid #244a7a;border-radius:6px;padding:1px 6px}
  .title{font-weight:600}
  .title a{color:var(--txt);text-decoration:none}
  .title a:hover{color:var(--accent)}
  .dim{color:var(--dim);font-size:12px}
  .stars{color:var(--warn);letter-spacing:1px}
  .txt{margin-top:6px;color:#c6d3e8;font-size:13px}
  .thought{margin-top:4px;color:#9fd7ff;font-size:13px}
  .empty{color:var(--dim);padding:18px;text-align:center;border:1px dashed var(--line);border-radius:14px}
  .chart{display:flex;gap:10px;align-items:flex-end;height:110px;padding:12px 4px}
  .bar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px;height:100%}
  .bar i{display:block;width:70%;max-width:34px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#4da3ff,#2d6dbb);min-height:2px}
  .bar span{font-size:11px;color:var(--dim)}
  .bar b{font-size:11px;color:#cfe0ff;font-weight:500}
  .drafts .item{border-color:#3a3350;background:#171a2c}
  .actions{display:flex;flex-direction:column;gap:6px}
  .act{display:flex;gap:8px;font-size:12.5px;color:#c6d3e8}
  .act time{color:var(--dim);min-width:44px}
  footer{margin-top:26px;color:#5f6f8d;font-size:12px;text-align:center}
  .rate{color:var(--dim);font-size:12px;margin-left:6px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>🐟 蓝色大肥鱼 · B站</h1>
    <span class="sub" id="date"></span>
    <span class="pill" id="pill">读取中…</span>
  </header>

  <div class="banner" id="banner">
    <div>
      <div class="big" id="bannerBig">读取中…</div>
      <div class="meta" id="bannerMeta"></div>
    </div>
  </div>

  <div class="grid" id="cards"></div>

  <h2>今天看了什么</h2>
  <div class="list" id="videos"></div>

  <h2>最近 7 天</h2>
  <div class="card"><div class="chart" id="chart"></div></div>

  <h2>待审动态</h2>
  <div class="list drafts" id="drafts"></div>

  <h2>今天做了什么</h2>
  <div class="card"><div class="actions" id="actions"></div></div>

  <h2>今天的聊天</h2>
  <div class="card"><div class="actions" id="chats"></div></div>

  <footer>每 10 秒自动刷新 · 数据来自 bili-memory 和 bili/data</footer>
</div>

<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const stars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtClock(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function renderStatus(s) {
  $('date').textContent = s.date + (s.today.videos.length ? ' · 今天第 ' + s.today.videos.length + ' 个' : '');
  const n = s.today.videos.length;
  const { min, max } = s.target;
  const avg = n ? (s.today.videos.reduce((a, v) => a + v.score, 0) / n).toFixed(1) : '—';

  // 顶部 banner
  let big, meta;
  if (n > 0) {
    big = '✅ 今天已经刷了 ' + n + ' 个视频';
    meta = '目标 ' + min + '~' + max + ' 个 · 平均喜欢 ' + avg + '/5' +
      (s.today.overall ? ' · ' + s.today.overall : '');
  } else if (s.scheduler.plan && !s.scheduler.doneToday) {
    big = '⏳ 今天还没刷';
    meta = '计划 ' + String(s.scheduler.plan.hour).padStart(2,'0') + ':' + String(s.scheduler.plan.minute).padStart(2,'0') +
      '（' + (s.scheduler.plan.run ? '会刷' : '随机到「今天不刷」') + '）';
  } else if (s.scheduler.doneToday) {
    big = '😴 今天不刷了';
    meta = '小管家今天已经处理过了';
  } else {
    big = '⏳ 今天还没刷';
    meta = s.scheduler.online ? '小管家在线，等它挑时间' : '小管家没在跑：双击 start-bili.bat';
  }
  $('bannerBig').textContent = big;
  $('bannerMeta').textContent = meta;

  const online = s.scheduler.online;
  $('pill').textContent = online ? '小管家在线' : '小管家离线';
  $('pill').className = 'pill ' + (online ? 'on' : 'off');

  // 统计卡
  const c = s.today.counts || {};
  const coinTxt = s.account.coinEnabled
    ? (c.coin || 0) + ' <small>/ ' + s.limits.coin + (s.coins === 0 ? ' · 硬币不足' : '') + '</small>'
    : '关';
  $('cards').innerHTML = [
    card('今日视频', n + ' <small>/ ' + min + '~' + max + '</small>'),
    card('平均喜欢', avg + ' <small>/ 5</small>'),
    card('点赞', (c.like || 0) + ' <small>/ ' + s.limits.like + '</small>'),
    card('收藏', (c.favorite || 0) + ' <small>/ ' + s.limits.favorite + '</small>'),
    card('投币', coinTxt),
    card('动态', (s.today.dynamic ? '1' : '0') + ' <small>' + (s.account.dynamicAutoPost ? '自动发' : '等你审') + '</small>'),
  ].join('');

  // 视频列表
  $('videos').innerHTML = s.today.videos.length ? s.today.videos.map(function (v) {
    return '<div class="item">' +
      '<div class="row1">' +
      '<span class="tag">' + esc(v.tname || '视频') + '</span>' +
      '<span class="title">' + (v.link ? '<a href="' + esc(v.link) + '" target="_blank" rel="noreferrer">' + esc(v.title) + '</a>' : esc(v.title)) + '</span>' +
      '<span class="stars">' + stars(v.score) + '</span>' +
      '</div>' +
      '<div class="dim">' + esc(v.up) + '</div>' +
      (v.summary ? '<div class="txt">' + esc(v.summary) + '</div>' : '') +
      (v.thought ? '<div class="thought">💭 ' + esc(v.thought) + '</div>' : '') +
      '</div>';
  }).join('') : '<div class="empty">今天还没有记录。等她刷完，或者跑 <code>node bili\\daily.mjs --fast</code></div>';

  // 7 天图
  const peak = Math.max(1, ...s.week.map((d) => d.videos.length));
  $('chart').innerHTML = s.week.map((d) => {
    const h = Math.round((d.videos.length / peak) * 82);
    return '<div class="bar" title="' + d.date + '">' +
      '<b>' + (d.videos.length || '') + '</b>' +
      '<i style="height:' + Math.max(2, h) + 'px"></i>' +
      '<span>' + d.date.slice(5) + '</span></div>';
  }).join('');

  // 草稿
  $('drafts').innerHTML = s.drafts.length ? s.drafts.map(function (d) {
    return '<div class="item">' +
      '<div class="dim">#' + esc(d.id) + ' · ' + esc(d.date) + ' · 待审</div>' +
      '<div class="txt">' + esc(d.text) + '</div>' +
      '<div class="dim" style="margin-top:6px">在终端：node bili\\cli.mjs approve ' + esc(d.id) + '</div>' +
      '</div>';
  }).join('') : '<div class="empty">没有待审的动态</div>';

  // 动作流水
  const actName = { watch: '看了', like: '点赞', favorite: '收藏', coin: '投币', share: '分享', comment: '评论', dynamic: '发动态', dynamic_draft: '起草动态' };
  $('actions').innerHTML = s.actions.length ? s.actions.map(function (a) {
    return '<div class="act">' +
      '<time>' + fmtClock(a.ts) + '</time>' +
      '<span>' + esc(actName[a.kind] || a.kind) + '</span>' +
      '<span class="dim">' + esc(a.title || a.bvid || '') + '</span>' +
      (a.ok ? '' : '<span style="color:var(--bad)">失败</span>') +
      '</div>';
  }).join('') : '<div class="dim">今天还没有动作</div>';

  // 今天的聊天（记忆文件里的条数和最后一句）
  const chats = s.chats || {};
  const chatRow = function (name, c) {
    return '<div class="act">' +
      '<span>' + name + '</span>' +
      '<span class="dim">' + (c && c.count ? c.count + ' 条' : '今天没聊') + '</span>' +
      '<span class="dim">' + esc((c && c.last) || '—') + '</span>' +
      '</div>';
  };
  $('chats').innerHTML = chatRow('QQ', chats.qq) + chatRow('微信', chats.weixin);
}

function card(k, v) {
  return '<div class="card"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
}

async function tick() {
  try {
    const r = await fetch('/api/status');
    renderStatus(await r.json());
  } catch (e) {
    $('bannerBig').textContent = '连不上面板进程';
  }
}

async function tickLive() {
  try {
    const r = await fetch('/api/live');
    const d = await r.json();
    let div = document.getElementById('acct');
    if (!div) {
      div = document.createElement('div');
      div.id = 'acct';
      div.className = 'card';
      $('cards').appendChild(div);
    }
    if (!d.loggedIn) {
      div.innerHTML = '<div class="k">账号</div><div class="v" style="font-size:14px;color:var(--bad)">未登录</div>';
      return;
    }
    let exp = '';
    if (d.exp) {
      const ok = (x) => (x ? '<span style="color:var(--good)">✓</span>' : '<span style="color:var(--dim)">✗</span>');
      exp = '<div class="dim" style="margin-top:4px">今日经验：登录 ' + ok(d.exp.login) +
        ' 观看 ' + ok(d.exp.watch) + ' 分享 ' + ok(d.exp.share) +
        ' 投币 ' + (d.exp.coinsExp || 0) + '</div>';
    }
    div.innerHTML = '<div class="k">账号</div><div class="v" style="font-size:15px">' + esc(d.uname) +
      ' <small>Lv' + (d.level ?? '?') + ' · 硬币 ' + (d.coins ?? '?') + '</small></div>' + exp;
  } catch {}
}

tick(); tickLive();
setInterval(tick, 10000);
setInterval(tickLive, 60000);
</script>
</body>
</html>`;
