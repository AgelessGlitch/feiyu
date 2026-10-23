/**
 * 每天刷 3~5 个 B站 视频：挑 → 看 → 总结 → 写 bili-memory → 写日记 → 起草动态
 *
 *   node bili/daily.mjs              正常跑（真的播放心跳，3~5 个，约 6~10 分钟）
 *   node bili/daily.mjs --fast       不看播放，只拿详情+字幕（几十秒）
 *   node bili/daily.mjs --dry        只挑视频、打印要看的单子，什么都不写
 *
 * 也可以被 serve.mjs 直接 import 调用。
 */
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bili from './lib/bili.mjs';
import { createDynamic } from './lib/dyn.mjs';
import { addDraft } from './lib/drafts.mjs';
import {
  readConfig, readJson, writeJson, DATA_DIR, DIARY_DIR,
  localDate, nowParts, randInt, shuffle,
} from './lib/config.mjs';
import * as memory from './memory.mjs';
import { logAction, countByKind } from './lib/actions.mjs';
import { tidName } from './lib/tid.mjs';
import { summarizeVideo, summarizeDay, closeModel } from './lib/llm.mjs';

const SEEN_FILE = join(DATA_DIR, 'seen.json');
const RUNS_FILE = join(DATA_DIR, 'runs.jsonl');

const log = (...a) => console.error('[daily]', ...a);

function seenMap() {
  const all = readJson(SEEN_FILE, {});
  const cut = localDate(new Date(Date.now() - 30 * 86400_000));
  return Object.fromEntries(Object.entries(all).filter(([, d]) => String(d) >= cut));
}

/** 候选：推荐 + 按喜好搜 + 偶尔热门 */
async function gather(cfg, seen) {
  const found = new Map();
  const add = (list, source) => {
    for (const x of list || []) {
      if (!x?.bvid || found.has(x.bvid) || seen[x.bvid]) continue;
      const dur = Number(x.durationSec ?? x.duration) || 0;
      if (dur && (dur > cfg.watch.maxDurationSec || dur < 60)) continue;
      found.set(x.bvid, { ...x, source });
    }
  };

  try {
    add(await bili.feedVideos(20), 'feed');
  } catch (e) {
    log('推荐拿不到：', e.message);
  }
  for (const kw of shuffle(cfg.interests).slice(0, 2)) {
    try {
      add(await bili.searchVideo(kw, 'click', 1), `search:${kw}`);
    } catch (e) {
      log(`搜「${kw}」失败：`, e.message);
    }
  }
  if (Math.random() < 0.4) {
    try {
      add(await bili.hotVideos(20), 'hot');
    } catch (e) {
      log('热门拿不到：', e.message);
    }
  }
  return [...found.values()];
}

/** 挑的时候尽量别都是一个分区 */
function choose(candidates, want) {
  const out = [];
  const used = new Set();
  const rounds = shuffle(candidates);
  for (const c of rounds) {
    if (out.length >= want) break;
    if (used.has(c.tname)) continue;
    out.push(c);
    used.add(c.tname);
  }
  for (const c of rounds) {
    if (out.length >= want) break;
    if (!out.includes(c)) out.push(c);
  }
  return out.slice(0, want);
}

async function watchOne(cand, cfg, { fast }) {
  const info = await bili.browseVideo(cand.bvid);
  const duration = Number(info.duration) || 0;

  let subtitleExcerpt = '';
  if (cfg.watch.subtitles) {
    try {
      const sub = await bili.videoSubtitle(info.bvid, info.cid);
      if (sub?.lines?.length) {
        subtitleExcerpt = sub.lines.map((l) => l.text).join(' ').slice(0, cfg.watch.maxSubtitleChars);
      }
    } catch (e) {
      log('字幕拿不到：', e.message);
    }
  }

  if (cfg.watch.realWatch && !fast) {
    const seconds = Math.max(15, Math.min(cfg.watch.secondsPerVideo, Math.round(duration * 0.8) || cfg.watch.secondsPerVideo));
    try {
      await bili.watchVideo(info.bvid, { seconds });
    } catch (e) {
      log('播放心跳失败（不影响总结）：', e.message);
    }
  }

  const s = await summarizeVideo(info, { subtitle: subtitleExcerpt, comments: info.comments || [] });
  return {
    ...info,
    ...s,
    // view 接口经常不给 tname，就用 tid 查表，再不行才用「视频」
    tname: info.tname || tidName(info.tid) || cand.tname || '',
    subtitleExcerpt,
    duration,
  };
}

export function diaryAppend(date, videos, day) {
  mkdirSync(DIARY_DIR, { recursive: true });
  const file = join(DIARY_DIR, `${date}.md`);
  if (!existsSync(file)) {
    // 这天第一次写：先写个开头，别覆盖已有的日记
    appendFileSync(file, `# ${date}\n\n`, 'utf8');
  }
  const { time } = nowParts();
  const kinds = [...new Set(videos.map((v) => v.tname).filter(Boolean))].slice(0, 4);
  const lines = [
    `## B 站 ${time.slice(0, 5)}`,
    day.diary || `今天在 B 站看了 ${videos.length} 个视频。`,
    '',
    ...videos.map((v) => `- 《${v.title}》${v.thought ? `：${v.thought}` : ''}`),
    '',
  ];
  appendFileSync(file, lines.join('\n') + '\n', 'utf8');
  return { file, kinds };
}

export async function runDaily(opts = {}) {
  try {
    return await runDailyInner(opts);
  } finally {
    closeModel(); // 起过的 ACP 子进程要收掉，不然命令行会挂着不退出
  }
}

async function runDailyInner({ fast = false, dry = false } = {}) {
  const cfg = readConfig();
  const date = localDate();

  if (!bili.isLoggedIn()) throw new Error('还没登录 B站，先跑：node bili/login.mjs');

  const n = randInt(cfg.watch.perDayMin, cfg.watch.perDayMax);
  const already = memory.watchedCount(date);
  const want = Math.max(0, n - already);
  if (!want) {
    log(`今天已经看了 ${already} 个，够了`);
    return { skipped: true, date, already };
  }

  const seen = seenMap();
  const candidates = await gather(cfg, seen);
  if (!candidates.length) throw new Error('没挑到合适的视频（可能都被看过了），明天再试');
  const picked = choose(candidates, want);

  if (dry) {
    console.log(`今天打算看 ${picked.length} 个：`);
    picked.forEach((c, i) => console.log(`${i + 1}. ${c.title}（${c.owner || '?'}｜${c.tname || ''}｜${c.bvid}）`));
    return { dry: true, picked: picked.map((c) => ({ bvid: c.bvid, title: c.title })) };
  }

  const videos = [];
  // 投币前先看一眼余额：硬币不够就别去打扰接口（余额不足不算失败，也不会上锁）
  let coinOk = !!cfg.coin?.enabled;
  if (coinOk) {
    try {
      const st = await bili.getAccountStatus();
      coinOk = Number(st.coins || 0) > 0;
      if (!coinOk) log('硬币余额 0，今天不投币（等小号自己攒够）');
    } catch {
      /* 查不到余额就照常试，真不够接口会拦 */
    }
  }
  for (const [i, cand] of picked.entries()) {
    log(`(${i + 1}/${picked.length}) 看 ${cand.title}`);
    let v;
    try {
      v = await watchOne(cand, cfg, { fast });
    } catch (e) {
      log('这个没看成：', e.message);
      logAction({ kind: 'watch', bvid: cand.bvid, title: cand.title, ok: false, error: e.message });
      continue;
    }
    videos.push(v);
    // 记忆里只留一小段字幕，别把整页撑爆；完整字幕已经喂给总结用过了
    memory.appendVideo(date, { ...v, subtitleExcerpt: v.subtitleExcerpt ? v.subtitleExcerpt.slice(0, 300) : '' }, already + i + 1);
    seen[v.bvid] = date;
    writeJson(SEEN_FILE, seen);
    logAction({ kind: 'watch', bvid: v.bvid, title: v.title, meta: { score: v.score, fast } });

    // 互动：点赞（>=4 分）、收藏（5 分偶尔）、投币（默认关）
    const counts = countByKind(date);
    if (v.score >= 4 && Math.random() < cfg.like.chance && (counts.like || 0) < cfg.like.dailyMax) {
      try {
        await bili.likeVideo(v.bvid, true);
        logAction({ kind: 'like', bvid: v.bvid, title: v.title });
      } catch (e) {
        log('点赞失败（可能风控）：', e.message);
        logAction({ kind: 'like', bvid: v.bvid, title: v.title, ok: false, error: e.message });
      }
    }
    if (v.score === 5 && Math.random() < cfg.favorite.chance && (counts.favorite || 0) < cfg.favorite.dailyMax) {
      try {
        await bili.favoriteVideo(v.bvid);
        logAction({ kind: 'favorite', bvid: v.bvid, title: v.title });
      } catch (e) {
        log('收藏失败：', e.message);
        logAction({ kind: 'favorite', bvid: v.bvid, title: v.title, ok: false, error: e.message });
      }
    }
    if (coinOk && v.score === 5 && (counts.coin || 0) < cfg.coin.dailyMax) {
      try {
        await bili.coinVideo(v.bvid, 1);
        logAction({ kind: 'coin', bvid: v.bvid, title: v.title });
      } catch (e) {
        if (e?.code === 'NO_COIN') {
          coinOk = false; // 余额不够：今天不再试，也不上锁
          log('硬币不够，今天不投了');
        } else {
          log('投币失败（接口敏感，先别试了）：', e.message);
        }
        logAction({ kind: 'coin', bvid: v.bvid, title: v.title, ok: false, error: e.message });
      }
    }
  }

  if (!videos.length) throw new Error('一个都没看成，看看是不是 cookie 过期或风控了');

  const day = await summarizeDay(videos, { date, interests: cfg.interests });
  if (day.day) memory.appendOverall(date, day);

  const diary = diaryAppend(date, videos, day);

  // 动态：默认只起草
  let dyn = null;
  if (day.dynamic) {
    if (cfg.dynamic.autoPost) {
      try {
        dyn = await createDynamic(day.dynamic);
        memory.appendDynamicNote(date, day.dynamic, { posted: true });
        logAction({ kind: 'dynamic', title: day.dynamic.slice(0, 40), meta: { dynId: dyn.dynId } });
      } catch (e) {
        log('自动发动态失败：', e.message);
        logAction({ kind: 'dynamic', ok: false, error: e.message });
      }
    }
    if (!dyn) {
      const d = addDraft({ date, text: day.dynamic, kind: 'daily' });
      memory.appendDynamicNote(date, d.text, { posted: false });
      logAction({ kind: 'dynamic_draft', title: d.text.slice(0, 40), meta: { draftId: d.id } });
      dyn = { draft: d.id };
    }
  }

  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(
    RUNS_FILE,
    JSON.stringify({
      ts: new Date().toISOString(), date, count: videos.length, fast,
      videos: videos.map((v) => ({ bvid: v.bvid, title: v.title, score: v.score })),
      dyn, diary: diary.file,
    }) + '\n',
    'utf8',
  );

  return { date, videos: videos.map((v) => ({ bvid: v.bvid, title: v.title, score: v.score })), day, dyn, diary: diary.file };
}

// ─── CLI ──────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('daily.mjs')) {
  const args = process.argv.slice(2);
  const run = runDaily({ fast: args.includes('--fast'), dry: args.includes('--dry') });
  run
    .then((r) => {
      if (r.skipped) console.log(`今天已经刷过了（${r.already} 个）`);
      else if (r.dry) console.log('（dry：没写任何东西）');
      else {
        console.log(`\n今天看了 ${r.videos.length} 个：`);
        for (const v of r.videos) console.log(`- ${v.title}（${v.score}/5）`);
        if (r.day?.day) console.log(`\n今天整体：${r.day.day}`);
        if (r.dyn?.draft) console.log(`\n动态草稿 #${r.dyn.draft}，点头再发：node bili/cli.mjs drafts`);
        if (r.dyn?.url) console.log(`\n动态已发：${r.dyn.url}`);
        console.log(`\n记忆：bili-memory/${r.date}.md`);
        console.log(`日记：${r.diary}`);
      }
    })
    .catch((e) => {
      console.error(`✗ ${e.message}`);
      process.exitCode = 1;
    });
}
