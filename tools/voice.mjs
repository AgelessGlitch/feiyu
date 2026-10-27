#!/usr/bin/env node
/**
 * 试音：生成一段语音，方便挑音色/调语调
 *
 *   node tools/voice.mjs "爹，今天的白饭特别香" 
 *   node tools/voice.mjs "文本" --voice zh-CN-XiaoxiaoNeural
 *   node tools/voice.mjs "文本" --voice zh-CN-XiaoyiNeural --rate +6% --pitch +35Hz
 *   node tools/voice.mjs "文本" --play       生成后直接用系统播放器打开
 *
 * 生成的文件在 tools/voice-samples/ 下，文件名带音色和参数，方便对比。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PYLIB = join(ROOT, 'tools', 'pylib');
const SAMPLES = join(HERE, 'voice-samples');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const text = args[0] && !args[0].startsWith('--') ? args[0] : '爹，今天的白饭特别香，你要不要也来一口呀？';
const voice = flag('voice', 'zh-CN-XiaoyiNeural');
const rate = flag('rate', '+4%');
const pitch = flag('pitch', '+25Hz');

mkdirSync(SAMPLES, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(4, 14);
const safe = (s) => s.replace(/[^a-z0-9+%-]/gi, '');
const out = join(SAMPLES, `try-${safe(voice)}-${safe(rate)}-${safe(pitch)}-${stamp}.mp3`);

const env = { ...process.env };
env.PYTHONPATH = [PYLIB, env.PYTHONPATH].filter(Boolean).join(';');

console.log(`[voice] ${voice}  rate=${rate}  pitch=${pitch}`);
const cmd = process.env.PYTHON || 'python';
const argv = ['-m', 'edge_tts', '--voice', voice, '--rate', rate, '--pitch', pitch, '--text', text, '--write-media', out];

let ok = false;
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    execFileSync(cmd, argv, { env, stdio: 'inherit', timeout: 60000 });
    ok = true;
    break;
  } catch {
    if (attempt < 4) await new Promise((r) => setTimeout(r, 800 * attempt));
  }
}
if (!ok) {
  console.error('[voice] 合成失败：连不上 speech.platform.bing.com，过会儿再试（Q 里发语音会自动重试 4 次 + 百度兜底）');
  process.exit(1);
}

console.log(`[voice] ${out}`);
if (args.includes('--play')) {
  execFileSync('cmd', ['/c', 'start', '', out], { stdio: 'ignore' });
}
