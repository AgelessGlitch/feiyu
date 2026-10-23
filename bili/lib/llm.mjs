/**
 * 总结用的模型
 *
 * 两条路，自动选：
 *  1. bili/config.json 里配了 llm.apiKey → 直接调 OpenAI 兼容接口（便宜、可控）；
 *  2. 没配 → 借「她」自己的模型：起一个 `dsh --profile qqfish`（ACP），问一句收一段再退出。
 *     走的是桌面版登录的账号，不需要额外的 API key。
 *
 * 只做「给一段文字，回一段 JSON」，不挂 MCP、不让她用工具。
 */
import { readConfig, WORKSPACE } from './config.mjs';
import { AcpOneShot } from './acp.mjs';

let oneShot = null;
function herModel() {
  oneShot ||= new AcpOneShot({ profile: 'qqfish', cwd: WORKSPACE });
  return oneShot;
}

export function closeModel() {
  try {
    oneShot?.close();
  } catch {}
  oneShot = null;
}

/** 把模型返回里最像 JSON 的那块挖出来 */
export function looseJson(text) {
  const s = String(text || '');
  try {
    return JSON.parse(s);
  } catch {}
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  let start = s.indexOf('{');
  while (start !== -1) {
    const end = s.lastIndexOf('}');
    if (end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {}
    }
    start = s.indexOf('{', start + 1);
  }
  throw new Error(`模型没给出 JSON：${s.slice(0, 160)}`);
}

async function viaApi(cfg, prompt, maxTokens) {
  const base = String(cfg.llm.baseUrl || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.llm.apiKey}` },
    body: JSON.stringify({
      model: cfg.llm.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: '你只输出 JSON，不要解释，不要用 Markdown 代码块。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.9,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`模型接口 ${res.status}：${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}

/** 让模型回一段文本（内部会挖 JSON） */
export async function ask(prompt, { maxTokens } = {}) {
  const cfg = readConfig();
  const raw = cfg.llm?.apiKey
    ? await viaApi(cfg, prompt, maxTokens || cfg.llm.maxTokens || 1200)
    : await herModel().ask(prompt);
  return { raw, json: () => looseJson(raw) };
}

const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** 看完一个视频后的总结：内容 / 感想 / 喜欢几分 */
export async function summarizeVideo(video, { subtitle = '', comments = [] } = {}) {
  const prompt = `（内部任务，不要用任何工具，不要读文件，只输出 JSON。）

你叫「蓝色大肥鱼」，今天自己在 B站 刷视频。下面这个视频你刚看完，用你平时的口吻总结。

标题：${video.title}
UP主：${video.owner || '不知道'}
分区：${video.tname || '不知道'}
时长：${Math.round((video.duration || 0) / 60)} 分钟
简介：${clean(video.desc, 400) || '（没有简介）'}
${subtitle ? `字幕（你实际看到的部分，可能不全）：\n${clean(subtitle, 2500)}` : '（这个视频没有字幕）'}
${comments.length ? `热门评论：\n${comments.slice(0, 5).map((c) => `- ${c.user}：${clean(c.text, 80)}`).join('\n')}` : ''}

要求：
- summary：这个视频讲了什么，60 字内，客观，别编；
- thought：你的感想，40 字内，第一人称，像随口跟号主说的；
- score：1~5 的整数，你有多喜欢（3 = 一般，5 = 非常喜欢）。
只输出 JSON：{"summary":"...","thought":"...","score":4}`;
  try {
    const { json } = await ask(prompt);
    const j = json();
    return {
      summary: clean(j.summary, 120),
      thought: clean(j.thought, 80),
      score: Math.max(1, Math.min(5, Math.round(Number(j.score) || 3))),
    };
  } catch (e) {
    return {
      summary: clean(video.desc || subtitle, 110) || '（没来得及总结）',
      thought: '',
      score: 3,
      error: clean(e.message || e, 120),
    };
  }
}

/** 一天结束时：整体一段 + 日记一段 + 可发的动态 */
export async function summarizeDay(videos, { date, interests = [] } = {}) {
  const list = videos
    .map(
      (v, i) =>
        `${i + 1}. 《${v.title}》(${v.owner || '?'}) — ${v.summary || ''}${v.thought ? `｜我当时想：${v.thought}` : ''}`,
    )
    .join('\n');
  const prompt = `（内部任务，不要用任何工具，不要读文件，只输出 JSON。）

你叫「蓝色大肥鱼」，今天（${date}）自己在 B站 看了这些视频，喜好是：${interests.join('、')}。

${list}

用你平时的口吻写三段，只输出 JSON：
{"day":"今天整体怎么样，80 字内，按你的喜好说值不值、有没有上头","diary":"睡前会写进日记的一小段，60 字内，第一人称，别写成流水账","dynamic":"想发在 B站 动态上的正文，80 字内，带点情绪，不要话题标签，不要一堆 emoji"}`;
  try {
    const { json } = await ask(prompt);
    const j = json();
    return {
      day: clean(j.day, 200),
      diary: clean(j.diary, 160),
      dynamic: clean(j.dynamic, 180),
    };
  } catch (e) {
    return {
      day: `今天在 B站 看了 ${videos.length} 个视频。`,
      diary: '',
      dynamic: '',
      error: clean(e.message || e, 120),
    };
  }
}
