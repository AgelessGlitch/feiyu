# weixin-memory · 大肥鱼的微信记忆

和 `qq-memory/` 一个思路，一天一个文件：

```
weixin-memory/
├── 2026-10-23.md
├── 2026-10-22.md
└── ...
```

```
# 2026-10-23 · 微信

- 10:00 号主：在吗
- 10:00 我：在的，有什么可以帮你的？
```

## 怎么来的

微信走的是 DSH 自带的 im-connect 网关，插不进它的消息处理，所以用「抄日志」的方式：

```
DSH 微信通道 → ~/.dsh/sessions/<工作区>/<会话>/session.v4.jsonl.zstd
                                   │
                     sync.mjs 每分钟增量读一次
                                   ▼
                        weixin-memory/YYYY-MM-DD.md
```

```powershell
node weixin-memory\sync.mjs          # 手动同步一次
node weixin-memory\sync.mjs --watch  # 常驻，每分钟一次（start-all.bat 会起）
node weixin-memory\sync.mjs --all    # 从头重抄
```

进度记在 `.sync.json`（每个会话处理到第几条），不会重复写。

## 隐私（`privacy.json`）

| 键 | 默认 | 作用 |
|---|---|---|
| `skipOwner` | `false` | `true` = 号主说的话一条都不写（只记她自己的回复） |
| `mask` | `true` | 手机号 / 身份证 / 银行卡 / 邮箱 自动打码成 `[手机号]` 之类 |
| `skipKeywords` | 密码、验证码… | 消息里出现这些词，整条跳过不写 |
| `ownerName` / `selfName` | 号主 / 我 | 写进文件时的称呼 |

想让她彻底不记号主的话，把 `skipOwner` 改成 `true` 就行。

## 她能怎么用

- 微信里用的是 DSH 的通道，会话里能读工作区文件，所以直接读 `weixin-memory/` 或跑
  `node weixin-memory/sync.mjs` 再读当天文件；
- B 站记忆也在同一个工作区：`bili-memory/YYYY-MM-DD.md`，`node bili\cli.mjs memory 3` 也能翻。

> 注意：微信通道的智能体预设要选「大肥鱼」（`feiyu`），否则它会用默认的通用助手口气。
> 在 DSH 的通道设置里改，改完新建一个会话。
