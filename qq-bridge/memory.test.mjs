import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QQMemory, datesIn, addDays, nowParts } from './memory.mjs';

const NOW = new Date('2026-10-23T12:00:00+08:00');
const at = (iso) => new Date(`${iso}T12:00:00+08:00`);

function tmpMem(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qqmem-'));
  return { mem: new QQMemory({ dir, ...opts }), dir };
}

test('nowParts 按东八区算日期', () => {
  assert.deepEqual(nowParts(new Date('2026-10-22T16:30:00Z')), { date: '2026-10-23', time: '00:30' });
});

test('addDays 跨月跨年', () => {
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('识别相对日期', () => {
  assert.deepEqual(datesIn('昨天的事', NOW), ['2026-10-22']);
  assert.deepEqual(datesIn('前天', NOW), ['2026-10-21']);
  assert.deepEqual(datesIn('大前天', NOW), ['2026-10-20']);
  assert.deepEqual(datesIn('3天前', NOW), ['2026-10-20']);
  assert.deepEqual(datesIn('三天前', NOW), ['2026-10-20']);
  assert.deepEqual(datesIn('今天', NOW), ['2026-10-23']);
});

test('识别星期几', () => {
  assert.deepEqual(datesIn('上周三', NOW), ['2026-10-14']);
  assert.deepEqual(datesIn('周三', NOW), ['2026-10-21']); // 今天周五，指这周三
  assert.deepEqual(datesIn('星期一', NOW), ['2026-10-19']);
  assert.deepEqual(datesIn('礼拜天', NOW), ['2026-10-18']);
});

test('识别具体日期', () => {
  assert.deepEqual(datesIn('2026-10-01', NOW), ['2026-10-01']);
  assert.deepEqual(datesIn('2026/10/01', NOW), ['2026-10-01']);
  assert.deepEqual(datesIn('2026年10月1日', NOW), ['2026-10-01']);
  assert.deepEqual(datesIn('10月15日', NOW), ['2026-10-15']);
  assert.deepEqual(datesIn('10/15', NOW), ['2026-10-15']);
  assert.deepEqual(datesIn('12月1日', NOW), ['2025-12-01']); // 还没到，算去年
  assert.deepEqual(datesIn('随便聊聊', NOW), []);
});

test('记一条、读回来', () => {
  const { mem, dir } = tmpMem();
  mem.record({ chat: '私聊 111', speaker: '张三', text: '在干什么', at: at('2026-10-23') });
  mem.record({ chat: '私聊 111', speaker: '我', text: '在发呆呢', at: at('2026-10-23') });
  const file = path.join(dir, '2026-10-23.md');
  assert.ok(fs.existsSync(file));
  const lines = mem.readDay('2026-10-23');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].chat, '私聊 111');
  assert.equal(lines[0].rest, '张三：在干什么');
  assert.equal(lines[1].rest, '我：在发呆呢');
});

test('最近 7 天会带上，8 天前不带；提到那天就单独翻', () => {
  const { mem } = tmpMem();
  mem.record({ chat: '私聊 111', speaker: '张三', text: '七天前的旧事', at: at('2026-10-17') });
  mem.record({ chat: '私聊 111', speaker: '张三', text: '十天前的旧事', at: at('2026-10-13') });
  mem.record({ chat: '私聊 111', speaker: '张三', text: '今天的话', at: at('2026-10-23') });

  const plain = mem.block({ chat: '私聊 111', text: '今天干嘛', at: NOW });
  assert.match(plain, /今天的话/);
  assert.match(plain, /七天前的旧事/);
  assert.doesNotMatch(plain, /十天前的旧事/);
  assert.match(plain, /最近 7 天/);

  const asked = mem.block({ chat: '私聊 111', text: '还记得10月13日说的吗', at: NOW });
  assert.match(asked, /另外翻到的更早记录/);
  assert.match(asked, /十天前的旧事/);
});

test('群聊看不到私聊，号主私聊能看到全部', () => {
  const { mem } = tmpMem();
  mem.record({ chat: '私聊 111', speaker: '张三', text: '这是私聊内容', at: at('2026-10-23') });
  mem.record({ chat: '群 999', speaker: '李四', text: '这是群里的内容', at: at('2026-10-23') });

  const group = mem.block({ chat: '群 999', scope: 'chat', text: '在吗', at: NOW });
  assert.match(group, /这是群里的内容/);
  assert.doesNotMatch(group, /这是私聊内容/);

  const owner = mem.block({ chat: '私聊 111', scope: 'all', text: '在吗', at: NOW });
  assert.match(owner, /这是私聊内容/);
  assert.match(owner, /这是群里的内容/);
});

test('一天太长时只留最近的几条', () => {
  const { mem } = tmpMem({ perDayChars: 200, totalChars: 400 });
  for (let i = 0; i < 30; i++) {
    mem.record({ chat: '私聊 111', speaker: '张三', text: `第 ${i} 句话`, at: at('2026-10-23') });
  }
  const block = mem.block({ chat: '私聊 111', text: '在吗', at: NOW });
  assert.ok(block.length < 900, `不该太长，实际 ${block.length}`);
  assert.match(block, /更早的略/);
  assert.match(block, /第 29 句话/);
  assert.doesNotMatch(block, /第 0 句话/);
});

test('没记录就什么都不注入', () => {
  const { mem } = tmpMem();
  assert.equal(mem.block({ chat: '私聊 111', text: '在吗', at: NOW }), '');
});

test('超长消息截断', () => {
  const { mem } = tmpMem({ maxMsgChars: 100 });
  mem.record({ chat: '私聊 111', speaker: '张三', text: '啊'.repeat(300), at: at('2026-10-23') });
  const line = mem.readDay('2026-10-23')[0];
  assert.ok(line.rest.length <= 112);
  assert.match(line.rest, /…$/);
});

test('人手动往里写也能被解析', () => {
  const { mem, dir } = tmpMem();
  fs.writeFileSync(path.join(dir, '2026-10-20.md'), '# 2026-10-20 的聊天\n\n- 09:15 [私聊 111] 我：手写的记录\n');
  const block = mem.block({ chat: '私聊 111', text: '20号聊了啥', at: NOW });
  assert.match(block, /09:15 我：手写的记录/);
});
