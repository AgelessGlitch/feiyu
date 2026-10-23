# QQ 自建通道（个人号 + NapCat）

给「蓝色大肥鱼」一个**真·QQ 号**：不依赖腾讯官方机器人平台，用自己的小号收发消息。

```
QQ 好友/群友
   │  发消息
   ▼
QQ 客户端（NapCat 注入，小号登录）
   │  OneBot 11 / WebSocket  ws://127.0.0.1:3001
   ▼
bridge.mjs  ── 谁该回、回什么、拆长消息、限流、记记忆
   │  ACP / JSON-RPC over stdio
   ▼
dsh --profile qqfish   （她的人格 + 模型）
```

## 依赖

- **NapCat**（QQ 协议端，不在本仓库里，自行下载安装）
- **DSH 桌面版**（提供模型和账号；`dsh` 命令可用）
- Node.js ≥ 22

## 目录

| 文件 | 作用 |
|---|---|
| `bridge.mjs` | 桥接服务，零依赖 |
| `memory.mjs` | 聊天记忆：按天写 `qq-memory/`，每条消息带最近 7 天 |
| `memory.test.mjs` | 记忆的测试（`node qq-bridge/memory.test.mjs`） |
| `profile/` | `qqfish` 这个 DSH profile 的源文件（人格、模型） |
| `config.example.json` | 配置模板，复制成 `config.json` 再填 |
| `start-bridge.bat` | 启动桥接 |

## 一次性准备

1. **NapCat**：下载解压到 `qq-bridge/napcat/`，在它的配置里开 OneBot 11 的 WebSocket：
   `ws://127.0.0.1:3001`，设一个 token。启动时用它注入 QQ（小号登录）。
2. **装 qqfish profile**：把 `profile/package.json` 和 `profile/cordis.patch.yml` 复制到
   `%USERPROFILE%\.dsh\profiles\qqfish\`：
   ```powershell
   mkdir "$env:USERPROFILE\.dsh\profiles\qqfish"
   copy profile\package.json,profile\cordis.patch.yml "$env:USERPROFILE\.dsh\profiles\qqfish\"
   ```
3. **配置**：
   ```powershell
   copy config.example.json config.json
   ```
   填 `onebot.token`（和 NapCat 一致）、`owner`（你的 QQ 号）、`agent.cwd`（工作区绝对路径）。

## 启动顺序

1. 完全退出自己的 QQ（托盘 → 退出），否则 NapCat 起不来；
2. 启动 NapCat（管理员），用小号扫码登录；
3. 看到登录成功后，双击 `start-bridge.bat`；
4. 用大号给这个号发一句「在吗」。

## 她会怎么回

`config.json`：

- `owner`：你的 QQ 号，私聊永远回；
- `privatePolicy`：`owner`（只回号主）/ `allowlist` / `anyone`；
- `group.mode`：`at`（只回 @ 她的）/ `prefix`（@ 或「肥鱼」开头）/ `all`；
- `group.allowlist`：只在这些群工作，空 = 所有群；
- `group.cooldownSec` / `maxPerHour`：防刷屏；
- `reply.maxChars`：一条太长就拆。

## 记忆

`memory.mjs` 把每条消息记成 `qq-memory/YYYY-MM-DD.md` 的一行，每次调模型前把**最近 7 天**拼进提示；
对方提到具体日期（`昨天` / `上周三` / `10月15日` / `2026-10-01`…）就单独读那天。
群聊只带这个群自己的记录，号主私聊能看全部。

改记忆：直接编辑/删除 `qq-memory/` 里的文件；想让她忘掉某个人，删 `state.json` 里对应的键。

## 风险

- 个人号接协议端**违反腾讯用户协议**，可能被限制登录或封号。**只用小号**，别绑重要东西。
- 群聊里她可能被套话；默认 `at` + 白名单 + 冷却已经是保守配置。
- `config.json`、`state.json`、`napcat/`、`logs/` 都在 `.gitignore` 里，别提交。
