/**
 * 一次性用一下「她」的模型（ACP，和 qq-bridge 走同一条路）
 *
 * 为什么不用 `dsh headless`：headless profile 走的是 API-key 路由，
 * 这台机器没配 DEEPSEEK_API_KEY；而 qqfish profile 用的是桌面版登录的账号
 * （deepseek-account），已经有凭证。所以这里直接起 `dsh --profile qqfish`，
 * 用 ACP 发一句、收一段、退出。
 *
 * 只用来「给一段文字，回一段 JSON」，不挂 MCP、不给工具。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function dshBin() {
  const cands = [
    join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(process.env.ProgramFiles || '', 'nodejs', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ];
  return cands.find((p) => p && existsSync(p)) || null;
}

export class AcpOneShot {
  constructor({ profile = 'qqfish', cwd, timeoutMs = 240_000 } = {}) {
    this.profile = profile;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.sessionId = null;
    this.collector = null;
  }

  async #ensure() {
    if (this.sessionId) return;
    const bin = dshBin();
    if (!bin) throw new Error('找不到 dsh 的 bin.js（设一下 dsh 的路径）');
    this.child = spawn(process.execPath, [bin, '--profile', this.profile], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (d) => this.#feed(d));
    this.child.stderr.on('data', () => {});
    this.child.on('exit', () => {
      this.child = null;
      this.sessionId = null;
      for (const { reject } of this.pending.values()) reject(new Error('dsh 退出了'));
      this.pending.clear();
    });

    await this.#request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: 'feiyu-bili', version: '1.0.0' },
    });
    const r = await this.#request('session/new', { cwd: this.cwd, mcpServers: [] });
    this.sessionId = r.sessionId;
  }

  #feed(chunk) {
    this.buffer += chunk;
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this.#handle(msg);
    }
  }

  #handle(msg) {
    if (msg.id != null && msg.method) {
      // 服务端要权限：只要能「允许」就允许
      let result = {};
      if (msg.method === 'session/request_permission') {
        const opts = msg.params?.options || [];
        const allow =
          opts.find((o) => /allow/i.test(o.optionId || '') || /allow|允许/i.test(o.name || '')) || opts[0];
        result = allow
          ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
          : { outcome: { outcome: 'cancelled' } };
      }
      this.#write({ jsonrpc: '2.0', id: msg.id, result });
      return;
    }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'acp error'));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'session/update' && this.collector) {
      const { update } = msg.params || {};
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
        this.collector.text += update.content.text;
      }
    }
  }

  #write(obj) {
    if (!this.child) throw new Error('dsh 没在跑');
    this.child.stdin.write(JSON.stringify(obj) + '\n');
  }

  #request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, this.timeoutMs);
      const done = (fn) => (v) => {
        clearTimeout(timer);
        fn(v);
      };
      const p = this.pending.get(id);
      this.pending.set(id, { resolve: done(p.resolve), reject: done(p.reject) });
      try {
        this.#write({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  /** 发一句，等她把话说完 */
  async ask(text) {
    await this.#ensure();
    const col = { text: '' };
    this.collector = col;
    try {
      await this.#request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] });
      return col.text.trim();
    } finally {
      this.collector = null;
    }
  }

  close() {
    try {
      this.child?.kill();
    } catch {}
    this.child = null;
    this.sessionId = null;
  }
}
