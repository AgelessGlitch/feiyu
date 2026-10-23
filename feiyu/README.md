# feiyu · 她的心情和日记

| 文件 | 作用 |
|---|---|
| `mood.json` | 上次的心情：`mood` / `intensity` / `why` / `closeness` / `updated`。会话开始时她可以读，情绪明显变化时写回（从 `mood.example.json` 复制） |
| `diary/YYYY-MM-DD.md` | 睡前（或你说「写日记」）写一两句当天的心情；B 站那条线每天也会往这里追加一段 |

设计上刻意**不要求每条消息都记录**——只在情绪真的变了、或一天结束时动一下，不打断聊天。

这两样都是她的私人东西，默认不进仓库（见 `.gitignore`）。
