/**
 * 发 B站 动态
 *
 * 接口是网页版「发布动态」用的那个：正文 application/json，csrf 放 query。
 * 新手号第一次发可能会被拦（-352 / -111），遇到就歇着，别硬试。
 */
import { readFileSync } from 'node:fs';
import { COOKIE_FILE } from './bili.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function createDynamic(text) {
  const content = String(text || '').trim();
  if (!content) throw new Error('动态正文是空的');
  const ck = JSON.parse(readFileSync(COOKIE_FILE, 'utf8'));
  if (!ck.sessdata || !ck.bili_jct) throw new Error('cookie 不完整（缺 sessdata 或 bili_jct），重新扫码登录');

  const payload = {
    dyn_req: {
      content: { contents: [{ raw_text: content, type: 1, biz_id: '' }] },
      meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
      scene: 1,
    },
  };
  const url = `https://api.bilibili.com/x/dynamic/feed/create/dyn?csrf=${encodeURIComponent(ck.bili_jct)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: 'https://t.bilibili.com/',
      Origin: 'https://t.bilibili.com',
      'Content-Type': 'application/json',
      Cookie: `SESSDATA=${ck.sessdata}; bili_jct=${ck.bili_jct}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (json.code === 0) {
    const dynId = json.data?.dyn_id_str || json.data?.dyn_id || '';
    return { ok: true, dynId: String(dynId), url: `https://t.bilibili.com/${dynId}` };
  }
  const hint =
    json.code === -111 ? '（CSRF 失败，cookie 过期，重新扫码）'
    : json.code === -101 ? '（没登录）'
    : json.code === -352 ? '（风控拦截，歇一天再试）'
    : '';
  throw new Error(`发动态失败 code=${json.code} ${json.message || ''}${hint}`);
}
