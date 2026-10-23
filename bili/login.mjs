#!/usr/bin/env node
/**
 * 登录 B站（用小号！）
 *
 *   node bili/login.mjs          出二维码，用手机 B站 App（小号）里的「扫一扫」确认
 *   node bili/login.mjs --cookie 手机扫不动时：从电脑浏览器手动导 cookie
 *   node bili/login.mjs --check  只看现在的凭证还有没有效
 *
 * 二维码同时存一份 bili/login/qr.png，终端看不清就打开图扫。
 * --cookie 会读 bili/login/cookie.txt（格式见文件里的说明），验证通过后写成
 * bili/login/cookie.json 并删掉 cookie.txt。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { qrLoginStart, qrLoginPoll, isLoggedIn, getAccountStatus, COOKIE_FILE } from './lib/bili.mjs';
import { LOGIN_DIR, nowParts } from './lib/config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function verify() {
  if (!isLoggedIn()) return null;
  const s = await getAccountStatus().catch(() => null);
  return s?.loggedIn ? s : null;
}

async function check() {
  const s = await verify();
  if (!s) {
    console.log('没有凭证或已经过期。跑 node bili/login.mjs（或 --cookie）重新登录。');
    process.exitCode = 1;
    return;
  }
  console.log(`✅ 已登录：${s.uname}（${s.uid}）Lv${s.level ?? '?'} ｜ 硬币 ${s.coins}`);
}

// ─── 手动导 cookie ────────────────────────────────────────
const COOKIE_TXT = join(LOGIN_DIR, 'cookie.txt');

function parsePairs(raw) {
  const map = {};
  const text = String(raw || '');
  // 先试 JSON（{"sessdata": "...", "bili_jct": "..."}）
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object') {
      const s = j.sessdata ?? j.SESSDATA ?? j.sessData;
      if (s) map.SESSDATA = String(s);
      const c = j.bili_jct ?? j.biliJct ?? j.BILI_JCT;
      if (c) map.bili_jct = String(c);
      const u = j.dede_user_id ?? j.DedeUserID ?? j.dedeUserId;
      if (u) map.DedeUserID = String(u);
    }
  } catch {
    /* 不是 JSON，按 name=value 解析 */
  }
  // `SESSDATA=xxx; bili_jct=yyy`、`Cookie: SESSDATA=xxx`、一行一个都行
  for (const m of text.matchAll(/([A-Za-z0-9_]+)\s*=\s*([^;\s"']+)/g)) {
    const k = m[1];
    const v = m[2].trim();
    if (!map[k] || k === 'SESSDATA' || k === 'bili_jct' || k === 'DedeUserID') map[k] = v;
  }
  return map;
}

async function fromCookie() {
  if (!existsSync(COOKIE_TXT)) {
    mkdirSync(LOGIN_DIR, { recursive: true });
    writeFileSync(
      COOKIE_TXT,
      [
        '# 在这个文件里贴小号的 cookie，贴好保存，再跑一次：node bili/login.mjs --cookie',
        '#',
        '# 怎么拿：电脑 Chrome 登录小号 → F12 → Application（应用）',
        '#        → Storage → Cookies → https://www.bilibili.com',
        '#        复制这三行的 Value：SESSDATA、bili_jct、DedeUserID',
        '#',
        '# 下面三行把值填在等号后面（也可以直接贴一整个 Cookie 头）：',
        'SESSDATA=',
        'bili_jct=',
        'DedeUserID=',
        '',
      ].join('\n'),
      'utf8',
    );
    console.log(`已生成模板：${COOKIE_TXT}`);
    console.log('把 SESSDATA / bili_jct / DedeUserID 的值填进去，保存后再跑：node bili/login.mjs --cookie');
    process.exitCode = 1;
    return;
  }

  const map = parsePairs(readFileSync(COOKIE_TXT, 'utf8'));
  if (!map.SESSDATA) {
    console.log(`没在 ${COOKIE_TXT} 里找到 SESSDATA。`);
    process.exitCode = 1;
    return;
  }

  const extra = {};
  // 只留几个 B站 认识的附加 cookie，免得把 cURL 里的别的东西也当 cookie 发出去
  const EXTRA_OK = new Set(['DedeUserID__ckMd5', 'sid', 'b_nut', 'buvid3', 'buvid4']);
  for (const [k, v] of Object.entries(map)) {
    if (EXTRA_OK.has(k) && v) extra[k] = v;
  }
  const ck = {
    sessdata: map.SESSDATA,
    bili_jct: map.bili_jct || '',
    dede_user_id: map.DedeUserID || '',
    lastRefresh: Date.now(),
  };
  if (Object.keys(extra).length) ck.extra = extra;

  mkdirSync(LOGIN_DIR, { recursive: true });
  const tmp = `${COOKIE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(ck, null, 2), { mode: 0o600 });
  try {
    const { renameSync } = await import('node:fs');
    renameSync(tmp, COOKIE_FILE);
  } catch {
    writeFileSync(COOKIE_FILE, JSON.stringify(ck, null, 2), { mode: 0o600 });
  }

  const s = await verify();
  if (!s) {
    console.log('✗ 这份 cookie 不管用（可能复制少了、过期了，或者粘错了行）。');
    console.log(`  再检查一下 ${COOKIE_TXT}，或者回去扫码。`);
    process.exitCode = 1;
    return;
  }
  try {
    unlinkSync(COOKIE_TXT); // 里面有 key，验证完就删掉
  } catch {}
  const { time } = nowParts();
  console.log(`✅ ${time} 登录成功：${s.uname}（${s.uid}）Lv${s.level ?? '?'}`);
  console.log('凭证在 bili/login/cookie.json。接下来：node bili/cli.mjs status');
}

// ─── 扫码 ─────────────────────────────────────────────────
async function login() {
  mkdirSync(LOGIN_DIR, { recursive: true });
  const { key, url } = await qrLoginStart();
  const png = join(LOGIN_DIR, 'qr.png');
  await QRCode.toFile(png, url, { margin: 2, width: 320 });
  console.log(await QRCode.toString(url, { type: 'terminal', small: true, margin: 1 }));
  console.log(`二维码也存了一份：${png}`);
  console.log('用【小号的 B站 App】里的「扫一扫」扫（别用相机/微信扫），然后在手机上点确认。\n');

  const deadline = Date.now() + 170_000;
  let last = '';
  while (Date.now() < deadline) {
    await sleep(2000);
    let r;
    try {
      r = await qrLoginPoll(key);
    } catch (e) {
      console.log('查询超时一次，继续等…', e.message);
      continue;
    }
    if (r.status !== last) {
      if (r.status === 'waiting') console.log('等扫码…');
      if (r.status === 'scanned') console.log('扫到了，等你在手机上点确认…');
      if (r.status === 'expired') {
        console.log('二维码过期了，重新跑一次 node bili/login.mjs');
        process.exitCode = 1;
        return;
      }
      if (r.status === 'error') {
        console.log(`出错：${r.message}`);
        process.exitCode = 1;
        return;
      }
      last = r.status;
    }
    if (r.status === 'ok') {
      const s = await verify();
      const { time } = nowParts();
      console.log(`\n✅ ${time} 登录成功${s ? `：${s.uname}（${s.uid}）Lv${s.level ?? '?'}` : ''}`);
      console.log('凭证在 bili/login/cookie.json。接下来：node bili/cli.mjs status');
      return;
    }
  }
  console.log('等太久了，二维码过期。重新跑 node bili/login.mjs');
  process.exitCode = 1;
}

const arg = process.argv[2];
if (arg === '--check') await check();
else if (arg === '--cookie') await fromCookie();
else await login();
