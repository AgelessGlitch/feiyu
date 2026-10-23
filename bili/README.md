# bili · 大肥鱼的 B站

她自己的 B 站小号：每天自己刷 3~5 个视频，看完总结进 `bili-memory/YYYY-MM-DD.md`，晚上写进日记，还会起草一条动态等你点头。

## 每天开机怎么打开

双击工作区根目录的 **`start-all.bat`**：它会把「小管家」和「面板」都起起来，并自动打开 <http://127.0.0.1:8899>。关掉窗口就停。

| 双击 | 作用 |
|---|---|
| `start-all.bat` | 小管家 + 面板 + 打开浏览器（推荐） |
| `start-bili.bat` | 只开小管家（每天随机时间刷视频） |
| `start-panel.bat` | 只开面板（只看，不刷） |

**想开机自动**：`Win+R` → 输入 `shell:startup` → 把 `start-all.bat` 的快捷方式拖进去。下次登录就会自己起。

两个注意：

- 小管家要**一直开着**——它整天在等自己挑的那个时间点，关掉窗口那天就不刷了；
- 晚上总结要用 DSH 账号，所以 **DSH 桌面版也得开着**（别关）。

## 一次性准备

1. **准备小号**（别用大号）：注册一个 B 站账号，手机 App 登录着。
2. **扫码登录**（在普通 PowerShell 窗口里，不是在 DSH 里）：

   ```powershell
   cd "D:\your-workspace\feiyu"
   node bili\login.mjs
   ```

   终端会出二维码（也存了一份 `bili\login\qr.png`），用**小号的手机 B站 App** 扫一下、点确认。
   凭证落在 `bili\login\cookie.json`——别提交、别外发。
3. **验证**：`node bili\cli.mjs status` 应该能看到小号的名字和等级。

### 扫码报错怎么办

如果手机上出现 `ERR_INTERNET_DISCONNECTED` 打不开 `account.bilibili.com/...`，那是**手机这边没连上**，不是二维码坏了：

- 必须是 **B站 App 里的「扫一扫」**（首页右上角 + → 扫一扫），别用相机、微信、支付宝扫——那些只会拿系统浏览器打开网页；
- 手机自己得有网：关掉 VPN / 代理 / 广告拦截（它们常把 `account.bilibili.com` 拦掉），换个 WiFi 或流量再试；
- 用 App 扫完要在手机上点「确认登录」，然后电脑这边会打印「登录成功」。

实在扫不动，就走手动导 cookie（不用手机）：

```powershell
node bili\login.mjs --cookie     # 第一次会生成 bili\login\cookie.txt
```

然后在电脑浏览器里登录小号 → F12 → Application（应用）→ Storage → Cookies → `https://www.bilibili.com`，
把 `SESSDATA`、`bili_jct`、`DedeUserID` 三个 Value 填进 `bili\login\cookie.txt`，保存后再跑一次
`node bili\login.mjs --cookie`。验证通过会写成 `cookie.json` 并把 `cookie.txt` 删掉（那里面有 key）。

更省事的办法：F12 → Network（网络）→ 刷一下页面，随便点一个 `bilibili.com` 的请求 → 右键
**Copy → Copy as cURL**，把整段直接贴进 `cookie.txt` 也行（脚本会从里面自己挑 cookie）。

## 每天自己刷（常驻）

```powershell
start-bili.bat
```

`bili/serve.mjs` 会在 `config.json` 的 `windows`（默认 13–15、17–19、21–24 点）里随机挑一个时间，
按 `runChance`（0.85）决定今天刷不刷——像人一样，不是准点打卡。
每天 3~5 个（`perDayMin/perDayMax`），每个真播放心跳 `secondsPerVideo` 秒（会进观看历史），
看完写记忆、写日记、起草动态。

- 手动跑一轮：`node bili\daily.mjs`（约 6~10 分钟，因为真的在"看"）
- 快点跑：`node bili\daily.mjs --fast`（不发心跳，只看详情+字幕，几十秒）
- 只看看会挑中什么：`node bili\daily.mjs --dry`
- 立刻跑一次（管家窗口里）：`node bili\serve.mjs --now`

## 她在 QQ 里能用的命令

```powershell
node bili\cli.mjs status                 # 登录状态、等级、今日经验
node bili\cli.mjs feed 8                 # 首页推荐
node bili\cli.mjs search 猫 8            # 搜索
node bili\cli.mjs view BV1xx             # 详情 + 热评
node bili\cli.mjs sub BV1xx              # 字幕（她说"看看这个讲了啥"时用）
node bili\cli.mjs watch BV1xx 60         # 像真人一样看 60 秒
node bili\cli.mjs like BV1xx             # 点赞
node bili\cli.mjs fav BV1xx              # 收藏
node bili\cli.mjs coin BV1xx             # 投币（接口敏感，自己决定）
node bili\cli.mjs unlock-coin            # 投币被上锁后手动解锁
node bili\cli.mjs comment BV1xx "内容"   # 发评论（少用，新号容易风控）
node bili\cli.mjs history 10             # 观看历史
node bili\cli.mjs memory 3               # 最近 3 天的 B站 记忆
```

### 改自己的昵称 / 头像

```powershell
node bili\profile.mjs show                        # 昵称、UID、等级、硬币、头像
node bili\profile.mjs name "水缸里的肥鱼"          # 改昵称（要 6 硬币，新号首次免费）
node bili\profile.mjs face bili\assets\face.png   # 换头像（立刻生效，不用等审核）
node bili\profile.mjs retry-name                  # 硬币够了，把 pending-nickname.txt 里的名字改上
```

头像那张图是 `bili\assets\make-face.ps1` 画的（`& .\bili\assets\make-face.ps1 -Dest bili/assets/face.png`），
想换样子就改坐标和颜色重跑。

踩过的坑：昵称**全站唯一**，「蓝色大肥鱼」「一条蓝色大肥鱼」都被人占了（code=40014 就是重名）；
改昵称**要 6 枚硬币**，不够报 40007；连改几次会 -702 限流，歇几分钟。
上传接口是 `/x/member/web/face/update`（multipart：`dopost=save`、`DisplayRank=10000`、`face=图片`，csrf 在 query），
`/x/member/web/face/upload` 那个是 404。

## 转正答题（Lv0 → Lv1）

新号是 Lv0，答到 60 分才转正。题目是**图片**（题干+选项印在一张图上），接口：
`/x/answer/v4/{base,extra,pro}` 取题、`/base/check` 交题、`/status` 看分数。

```powershell
node bili\quiz-fetch.mjs 25 base        # 抽 25 道基础题，图片和清单存 bili\quiz-tmp\
& .\bili\quiz-stitch.ps1 -part base -per 9   # 把图拼成长图，看图判断
node bili\quiz-answer.mjs base "1,1,2,1,..." # 按 base.json 顺序交（1=A 2=B）
node bili\quiz-captcha.mjs grab         # 基础题过了要验证码：取图
node bili\quiz-captcha.mjs send Z1OW    # 填识别出来的字
```

交题太快报 `41014`、重复题报 `41032`，都正常，隔 1.5 秒以上慢慢来。60 分就转正，自选题可以不管。

## 动态（默认先审）

每天刷完会写一条草稿，不会自己发。你点头才发：

```powershell
node bili\cli.mjs drafts      # 看草稿
node bili\cli.mjs approve <id>
node bili\cli.mjs drop <id>
```

想让她自动发：`config.json` 里 `"dynamic": { "autoPost": true }`。

## 看板：今天刷没刷，一眼看到

```powershell
start-panel.bat        # 自动开 http://127.0.0.1:8899
# 或者：node bili\panel.mjs
```

面板上能看到：

- **顶上大字**：今天刷了没、目标 3~5 个、平均喜欢几分；
- **今天每个视频**：分区、标题（点开 B站）、UP、喜欢几星、内容摘要、她的感想；
- **点赞 / 收藏 / 投币**：今天各几个、上限多少（投币默认关，显示"关"）；
- **小管家**：在不在线、下次计划几点、今天是不是随机到「不刷」；
- **最近 7 天**：柱状图；
- **待审动态**：草稿全文 + `approve` 命令；
- **今天做了什么**：看了/赞了/收了/发了的时间流水；
- **账号**：小号昵称、Lv、硬币、今日经验（登录/观看/分享/投币）。

每 10 秒自动刷新，只读本地文件 + 一次账号接口（60 秒缓存），不往外发任何东西。

## 记忆长什么样

`bili-memory/2026-10-23.md`：

```md
# 2026-10-23 · 我的 B 站

## 看了什么
### 1. 【喵星人】标题
- UP：xxx ｜ 时长：5:12 ｜ 播放：1.2 万 ｜ 弹幕：34
- 链接：https://www.bilibili.com/video/BV1xx
- 喜欢：4/5
- 内容：这个视频讲了……
- 我：……
- 字幕：……

## 今天整体
……
## 动态
- 草稿（等你点头）：……
```

直接改、直接删都行；`bili-memory` 是她自己的经历，QQ 聊天时能用 `node bili/cli.mjs memory` 翻。

## 总结用什么模型

默认**借她自己的模型**：脚本会起一个 `dsh --profile qqfish`（ACP，和 QQ 桥接同一条路），
问一句、收一段、退出——用的是 DSH 桌面版登录的账号，不用另外配 key。
所以跑 `daily` 的时候 **DSH 桌面版得开着**（账号凭证在它那儿）。

想更省事/更省钱，可以在 `config.json` 里填 `llm.apiKey`（OpenAI 兼容接口，默认 DeepSeek），
脚本就直接调 API，不再起 ACP。

哪个都失败时，视频照样记进记忆，内容退化成简介/字幕的截断，不会整条丢掉。

## 风控（认真看）

- 新号 + 脚本容易被 `-352`/`-403` 拦。所以默认：**只点赞、不评论、每天最多 3~5 个、真播放心跳**。
- 投币（`config.json` → `coin`）默认只投当你给了 5 分的视频、每天最多 1 枚；**硬币不够会自动跳过**，不调用接口、也不算失败。
- 投币接口真被拒一次就**永久上锁**（防连败），之后所有投币都被拦；确认没事了跑 `node bili\cli.mjs unlock-coin` 手动解锁。
- 点赞/收藏被拒就当天停手，别重试。
- 发动态第一次可能被拦，被拦就歇一天。
- 个人自动化可能违反 B 站用户协议，用**小号**、自己承担风险；别刷量、别引流、别发广告。

## 文件

| 路径 | 是什么 |
|---|---|
| `bili/login/cookie.json` | 登录凭证（别外传） |
| `bili/config.json` | 喜好、每天几个、时段、开关 |
| `bili/data/seen.json` | 看过的 bvid（去重） |
| `bili/data/actions.jsonl` | 动作流水：看了/赞了/收了/投了/发了（面板统计用） |
| `bili/data/drafts.jsonl` | 动态草稿 |
| `bili/data/runs.jsonl` | 每天跑了的记录 |
| `bili/panel.mjs` | 本地面板（`start-panel.bat`） |
| `bili-memory/` | 她的 B站 记忆（按天） |
| `feiyu/diary/` | 她的日记（每天追加一段 B站 的） |
