# 蓝色大肥鱼 🐟

> 把 DeepSeek 养成一个住在 QQ / 微信里、会自己刷 B 站、记得住事的伙伴。

这不是一个通用助手，是一个**有人格、有记忆、有自己生活**的 AI 伙伴：

- 在 **QQ**（个人号，NapCat 自建通道）和 **微信**（DSH 官方机器人通道）里聊天，语气像真人；
- 自己有个 **B 站小号**，每天刷 3~5 个视频，读完字幕写总结，晚上写日记、起草动态；
- 聊天记忆**按天存成 Markdown**，能"想起"你上周说过的话；
- 有一个本地**面板**，能看她今天刷了没、看了什么、赞了几个、动态草稿。

> 仓库里**不包含**任何聊天记录、日记、cookie、token。所有密钥和数据都在 `.gitignore` 里，第一次用要自己登录。

## 架构

```
                     ┌──────────────────────────────┐
   QQ 好友/群友 ────► │ NapCat（协议端，自备）        │
                     └──────────────┬───────────────┘
                                    │ OneBot 11 / WS
                                    ▼
                     ┌──────────────────────────────┐
                     │ qq-bridge（Node，零依赖）       │
                     │  · 谁该回、限流、拆消息          │
                     │  · 写 qq-memory/，带最近 7 天    │
                     └──────────────┬───────────────┘
                                    │ ACP（JSON-RPC over stdio）
                                    ▼
   B 站小号 ◄──── bili/（Node）────►│  dsh --profile qqfish
   每天 3~5 个视频 / 总结 / 日记     │  （人格 + 模型）
                                    │
   微信 ◄──── DSH 官方 IM 通道 ─────┘
                     │
                     ▼
        qq-memory/ weixin-memory/ bili-memory/ feiyu/diary/
        （一天一个 .md，人能直接读、直接改）
```

## 能做什么

| 模块 | 能力 |
|---|---|
| `feiyu-agent/` | 人格唯一来源 `persona.md`，`build.mjs` 同时生成 DSH 预设和 `qqfish` profile |
| `qq-bridge/` | 真 QQ 号收发；按天记忆；最近 7 天注入；提到日期会回查 |
| `bili/` | 每天挑 3~5 个视频、读字幕、总结、写记忆/日记、起草动态、投币/点赞（可关） |
| `bili/panel.mjs` | 本地看板：今天刷没刷、看了什么、赞/收/币、7 天趋势、待审动态、聊天条数 |
| `weixin-memory/` | 微信聊天按天落盘（从 DSH 会话日志增量同步），带隐私打码 |
| `tools/memory.mjs` | `digest` 翻最近几天 / `stats` 看体积 / `archive` 归档 90 天前 |
| `tools/backup.ps1` | 一键备份记忆 + B 站登录 + 配置成 zip |

## 目录

```
.
├── feiyu-agent/      人格、build.mjs、DSH 预设
├── qq-bridge/        QQ 桥接 + 记忆
├── bili/             B 站：日常 / CLI / 面板 / 登录 / 动态
├── weixin-memory/    微信记忆同步
├── qq-memory/        QQ 聊天记忆（按天，默认不进库）
├── bili-memory/      B 站记忆（按天，默认不进库）
├── feiyu/            心情、日记（默认不进库）
├── tools/            记忆工具箱、备份脚本
├── start-all.bat     一键：B 站小管家 + 面板 + 微信同步
├── start-bili.bat    只开 B 站小管家
├── start-panel.bat   只开面板
└── backup.bat        备份
```

## 快速开始（Windows）

**前置**：Windows 10/11、Node.js ≥ 22、[DSH 桌面版](https://deepseek.com)（登录账号，提供模型）；想用真 QQ 号还需要自己装 NapCat。

```powershell
git clone https://github.com/<你的名字>/feiyu.git
cd feiyu
```

### 1. 人格与 profile

```powershell
# 生成 DSH 预设和 qqfish profile
node feiyu-agent\build.mjs

# 装 qqfish（QQ 桥接用）
mkdir "$env:USERPROFILE\.dsh\profiles\qqfish"
copy qq-bridge\profile\package.json,qq-bridge\profile\cordis.patch.yml "$env:USERPROFILE\.dsh\profiles\qqfish\"
```

### 2. B 站（她自己的小号）

```powershell
cd bili
npm install --ignore-scripts
copy config.example.json config.json
cd ..
node bili\login.mjs          # 手机 B站 App（小号）扫码
node bili\cli.mjs status
```

### 3. QQ（可选）

1. 下载 NapCat，解压到 `qq-bridge\napcat\`，开 OneBot 11 WS `127.0.0.1:3001`，记下 token；
2. 复制 `qq-bridge\config.example.json` 为 `config.json`，填 `onebot.token` / `owner` / `agent.cwd`；
3. 启动 NapCat（管理员）用小号登录 → 双击 `qq-bridge\start-bridge.bat`。

### 4. 微信（可选）

用 DSH 桌面版的 **IM 通道 → 微信**（官方 ilink 机器人）：按提示扫码绑定，然后把通道的智能体预设选成「大肥鱼」。
注意：这是**机器人号**，不是个人微信号。个人号自动化有封号风险，本仓库不包含。

### 5. 启动

```powershell
start-all.bat        # B 站小管家 + 面板 + 微信记忆同步
```

面板：<http://127.0.0.1:8899>

> 想开机自启：`Win+R` → `shell:startup` → 把 `start-all.bat` 的快捷方式拖进去。

## 记忆是怎么存的

一天一个 Markdown 文件，人能直接读、直接改：

```
qq-memory/2026-10-23.md
  - 14:39 [私聊 123456789] 张三：在干什么
  - 14:39 [私聊 123456789] 我：在发呆呢

bili-memory/2026-10-23.md
  ### 1. 【搞笑】某个视频
  - UP：xxx ｜ 时长：5:12 ｜ 播放：1.2 万
  - 喜欢：4/5
  - 内容：视频讲了什么
  - 我：她的感想
```

- QQ：每条消息带最近 7 天；提到具体日期会去读那一天；
- 微信：`weixin-memory/sync.mjs` 从 DSH 会话日志增量抄，默认给手机号/身份证/银行卡/邮箱打码；
- B 站：每天刷完写当天文件，收尾写一段"今天整体"，日记里也有一段；
- 归档：`node tools\memory.mjs archive 90`；
- 备份：`backup.bat`。

## 配置

| 文件 | 说明 |
|---|---|
| `qq-bridge/config.json` | QQ 号、NapCat token、群规则、记忆天数 |
| `bili/config.json` | 每天几个、喜好、时段、点赞/收藏/投币、模型 |
| `weixin-memory/privacy.json` | 微信记忆的隐私规则（打码、跳过关键词、是否记对方的话） |

## 安全与风险

- **只用小号**：QQ 个人号接协议端、B 站脚本自动化，都可能违反平台协议，有封号风险；
- **密钥不入库**：`bili/login/cookie.json`、`qq-bridge/config.json`、`qq-bridge/state.json` 都在 `.gitignore` 里；
- **记忆是明文**：想彻底不落盘就别开对应模块；
- **NapCat 不在仓库里**：自行下载，注意来源；
- B 站接口随时可能变，`bili/` 里的风控处理（投币上锁、点赞熔断）是保守配置，别改成高频。

## 第三方

- [NapCat](https://github.com/NapNeko/NapCatQQ)（QQ 协议端）
- [bilibili-mcp-server](https://github.com/Iseenope/bilibili-mcp-server)（WBI 签名等，MIT）
- [qrcode](https://www.npmjs.com/package/qrcode)（登录二维码）

## License

MIT
