#!/usr/bin/env node
/**
 * 大肥鱼的 B站 命令行（她在 QQ 里敲这个，人手也能敲）
 *
 *   node bili/cli.mjs status                  登录状态、等级、今日经验
 *   node bili/cli.mjs feed [n]                首页推荐
 *   node bili/cli.mjs hot [n]                 热门
 *   node bili/cli.mjs search 猫 [n]           搜索
 *   node bili/cli.mjs view BV1xx              视频详情 + 热评
 *   node bili/cli.mjs sub BV1xx [字数]        字幕
 *   node bili/cli.mjs watch BV1xx [秒]        像真人一样播放心跳
 *   node bili/cli.mjs like BV1xx              点赞
 *   node bili/cli.mjs fav BV1xx               收藏
 *   node bili/cli.mjs share BV1xx             分享
 *   node bili/cli.mjs comment BV1xx "内容"    发评论
 *   node bili/cli.mjs history [n]             观看历史
 *   node bili/cli.mjs memory [天数]           最近几天的 B站 记忆
 *   node bili/cli.mjs drafts                  待审动态
 *   node bili/cli.mjs approve <id>            发出去
 *   node bili/cli.mjs drop <id>               丢掉
 *   node bili/cli.mjs post "内容"             直接发动态
 *   node bili/cli.mjs daily [--fast] [--dry]  手动刷今天的 3~5 个
 */
import * as bili from './lib/bili.mjs';
import { createDynamic } from './lib/dyn.mjs';
import { listDrafts, updateDraft } from './lib/drafts.mjs';
import { logAction } from './lib/actions.mjs';
import { readConfig, localDate } from './lib/config.mjs';
import * as memory from './memory.mjs';
import { runDaily } from './daily.mjs';

const [cmd, ...args] = process.argv.slice(2);
const num = (i, d) => (args[i] != null && !Number.isNaN(Number(args[i])) ? Number(args[i]) : d);

const fmt = (v) => `- ${v.title} ｜ ${v.owner || '?'} ｜ ${v.bvid}`;

async function main() {
  switch (cmd) {
    case 'status': {
      if (!bili.isLoggedIn()) return console.log('还没登录，先跑：node bili/login.mjs');
      const s = await bili.getAccountStatus();
      const exp = await bili.getExpStatus().catch(() => null);
      console.log(`${s.uname}（${s.uid}）Lv${s.level ?? '?'} ｜ 硬币 ${s.coins} ｜ 节操 ${s.moral ?? '?'}`);
      if (exp) console.log(`今日：登录${exp.login ? '✓' : '✗'} 观看${exp.watch ? '✓' : '✗'} 分享${exp.share ? '✓' : '✗'} 投币经验${exp.coinsExp}`);
      const lock = bili.coinLock();
      if (lock) console.log(`⚠ 投币已上锁：${lock.at}（${lock.reason}）。确认没事了跑 node bili/cli.mjs unlock-coin`);
      console.log(`今天在 bili-memory 里记了 ${memory.watchedCount(localDate())} 个视频`);
      return;
    }
    case 'unlock-coin': {
      const ok = bili.unlockCoin();
      return console.log(ok ? '已解锁（旧锁文件留档了）' : '本来就没锁');
    }
    case 'feed': {
      const list = await bili.feedVideos(num(0, 10));
      return console.log(list.map(fmt).join('\n'));
    }
    case 'hot': {
      const list = await bili.hotVideos(num(0, 10));
      return console.log(list.map(fmt).join('\n'));
    }
    case 'search': {
      const kw = args[0];
      if (!kw) return console.log('用法：node bili/cli.mjs search 关键词 [数量]');
      const list = await bili.searchVideo(kw, 'totalrank', 1);
      return console.log(list.slice(0, num(1, 10)).map(fmt).join('\n'));
    }
    case 'view': {
      const id = args[0];
      if (!id) return console.log('用法：node bili/cli.mjs view BV号');
      const v = await bili.browseVideo(id);
      console.log(`《${v.title}》\nUP：${v.owner} ｜ ${v.tname} ｜ ${Math.round(v.duration / 60)} 分钟 ｜ 播放 ${v.stat.view}`);
      if (v.desc) console.log(`简介：${v.desc.slice(0, 300)}`);
      if (v.comments?.length) {
        console.log('\n热评：');
        for (const c of v.comments.slice(0, 5)) console.log(`- ${c.user}：${String(c.text).slice(0, 80)}`);
      }
      return;
    }
    case 'sub': {
      const id = args[0];
      if (!id) return console.log('用法：node bili/cli.mjs sub BV号 [字数]');
      const v = await bili.browseVideo(id);
      const sub = await bili.videoSubtitle(v.bvid, v.cid);
      if (!sub) return console.log('这个视频没有字幕');
      const text = sub.lines.map((l) => l.text).join(' ');
      return console.log(text.slice(0, num(1, 2000)));
    }
    case 'watch': {
      const id = args[0];
      if (!id) return console.log('用法：node bili/cli.mjs watch BV号 [秒]');
      const r = await bili.watchVideo(id, { seconds: num(1, 60) });
      logAction({ kind: 'watch', bvid: id, ok: true });
      return console.log(`看完了：${JSON.stringify(r)}`);
    }
    case 'like': {
      if (!args[0]) return console.log('用法：node bili/cli.mjs like BV号');
      try {
        const r = await bili.likeVideo(args[0], true);
        logAction({ kind: 'like', bvid: args[0] });
        return console.log(JSON.stringify(r));
      } catch (e) {
        logAction({ kind: 'like', bvid: args[0], ok: false, error: e.message });
        throw e;
      }
    }
    case 'fav': {
      if (!args[0]) return console.log('用法：node bili/cli.mjs fav BV号');
      try {
        const r = await bili.favoriteVideo(args[0]);
        logAction({ kind: 'favorite', bvid: args[0] });
        return console.log(JSON.stringify(r));
      } catch (e) {
        logAction({ kind: 'favorite', bvid: args[0], ok: false, error: e.message });
        throw e;
      }
    }
    case 'coin': {
      if (!args[0]) return console.log('用法：node bili/cli.mjs coin BV号 [枚数]');
      try {
        const r = await bili.coinVideo(args[0], num(1, 1));
        logAction({ kind: 'coin', bvid: args[0] });
        return console.log(JSON.stringify(r));
      } catch (e) {
        logAction({ kind: 'coin', bvid: args[0], ok: false, error: e.message });
        throw e;
      }
    }
    case 'share': {
      if (!args[0]) return console.log('用法：node bili/cli.mjs share BV号');
      try {
        const r = await bili.shareVideo(args[0]);
        logAction({ kind: 'share', bvid: args[0] });
        return console.log(JSON.stringify(r));
      } catch (e) {
        logAction({ kind: 'share', bvid: args[0], ok: false, error: e.message });
        throw e;
      }
    }
    case 'comment': {
      const id = args[0];
      const text = args.slice(1).join(' ');
      if (!id || !text) return console.log('用法：node bili/cli.mjs comment BV号 "内容"');
      try {
        const r = await bili.postComment({ bvid: id, message: text });
        logAction({ kind: 'comment', bvid: id, meta: { text: text.slice(0, 60) } });
        return console.log(JSON.stringify(r));
      } catch (e) {
        logAction({ kind: 'comment', bvid: id, ok: false, error: e.message });
        throw e;
      }
    }
    case 'history': {
      const list = await bili.watchHistory(num(0, 10));
      return console.log(list.map((x) => `- ${x.title} ｜ ${x.owner || ''} ｜ ${x.bvid}`).join('\n'));
    }
    case 'memory': {
      const t = memory.recentText(num(0, 3));
      return console.log(t || '这几天还没看过 B站');
    }
    case 'drafts': {
      const all = listDrafts({ status: 'pending' });
      if (!all.length) return console.log('没有待审的动态');
      return console.log(all.map((d) => `#${d.id}（${d.date}）\n${d.text}`).join('\n\n'));
    }
    case 'approve': {
      const d = listDrafts({ status: 'pending' }).find((x) => x.id === args[0]);
      if (!d) return console.log('没找到这条草稿');
      const r = await createDynamic(d.text);
      updateDraft(d.id, { status: 'posted', dynId: r.dynId });
      return console.log(`已发：${r.url}`);
    }
    case 'drop': {
      const d = listDrafts({ status: 'pending' }).find((x) => x.id === args[0]);
      if (!d) return console.log('没找到这条草稿');
      updateDraft(d.id, { status: 'dropped' });
      return console.log('丢掉了');
    }
    case 'post': {
      const text = args.join(' ');
      if (!text) return console.log('用法：node bili/cli.mjs post "内容"');
      return console.log(JSON.stringify(await createDynamic(text)));
    }
    case 'daily': {
      const r = await runDaily({ fast: args.includes('--fast'), dry: args.includes('--dry') });
      return console.log(JSON.stringify(r));
    }
    default:
      console.log('命令：status feed hot search view sub watch like fav share comment history memory drafts approve drop post daily');
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1; // 别用 process.exit：Node 24 + Windows 在 fetch 收尾时会断言崩溃
});
