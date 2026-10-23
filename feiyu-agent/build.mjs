#!/usr/bin/env node
/**
 * 把 persona.md 同步成两处配置：
 *   1. 本目录 cordis.patch.yml —— DSH 的「大肥鱼」Agent 预设
 *   2. ../qq-bridge/profile/cordis.patch.yml —— 个人 QQ 号的 ACP 运行时
 *
 * 用法：node build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERSONA_FILE = path.join(HERE, 'persona.md');
const PRESET_OUT = path.join(HERE, 'cordis.patch.yml');
const PROFILE_OUT = path.join(HERE, '..', 'qq-bridge', 'profile', 'cordis.patch.yml');

const raw = fs.readFileSync(PERSONA_FILE, 'utf8');

// 去掉开头那段给自己的元信息（第一个独立的 --- 之前）
const parts = raw.split(/^---$/m);
const personaText = (parts.length > 1 ? parts.slice(1).join('---') : raw).trim();
if (!personaText) throw new Error('persona.md 里没读到正文');

const indent = (text, n) =>
  text
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : ' '.repeat(n) + l))
    .join('\n');

const preset = `# 自动生成，别手改：改 persona.md 后运行 node build.mjs
# 大肥鱼 Agent 预设：一个带情感设计、人格与兴趣的 DSH Agent。
- insert:
    - id: preset-feiyu
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: feiyu
        name: 大肥鱼
        description: 住在 DSH 里的大肥鱼：七分温柔三分傲娇，聊天像真人，干活不含糊。
        order: 10
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |
${indent(personaText, 16)}
              complete: false
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: tool-ask-user
            name: '@deepseek-ai/dsh-tool-ask-user'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
            config:
              read: true
              readImage: true
              write: true
              edit: true
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
            config:
              sampleOverCapGlobResults: false
          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
            config:
              fetch: true
              searchTimeoutMs: 60000
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
`;

const profile = `# 自动生成，别手改：改 persona.md 后运行 node build.mjs
# 个人 QQ 号的 ACP 无头运行时（dsh --profile qqfish）
- id: acp
  config:
    provider: deepseek-account
    model: deepseek-flash

- id: system-prompt
  config:
    personaPrefix: |
${indent(personaText, 6)}
`;

fs.writeFileSync(PRESET_OUT, preset);
fs.writeFileSync(PROFILE_OUT, profile);

// 顺手把 QQ 运行时用的 qqfish profile 也刷新（存在才写）
const qqProfile = path.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'qqfish', 'cordis.patch.yml');
if (fs.existsSync(path.dirname(qqProfile))) {
  fs.writeFileSync(qqProfile, profile);
  console.log('已同步：' + qqProfile);
}

console.log('已生成：');
console.log('  ' + PRESET_OUT);
console.log('  ' + PROFILE_OUT);
console.log(`人格正文 ${personaText.length} 字`);
