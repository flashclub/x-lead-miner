# Scraper.tech X API 契约记录（x-lead-miner）

- 来源：https://scraper.tech/panel/playground/twitter/
- 仓库级文档：monoboard `docs/apis/scraper-tech-x/README.md`（接入边界/合规注意事项以它为准）
- 本文核对日期：**2026-11-16**（真实 key 实测，非文档转抄）
- 代码位置：`src/lib/x-api.ts`（类型化客户端）、`scripts/x-api-smoke.ts`（契约冒烟）
- 密钥：`SCRAPER_API_KEY`（.dev.vars 本地 / Workers secrets 生产），只经服务端 `Scraper-Key` header 上送，禁止进浏览器/日志

## 实测核验结论

| 项 | 结论 |
| --- | --- |
| 鉴权 | header `Scraper-Key: <key>`。`X-API-KEY`/`api_key=` query 均无效（实测 Access denied） |
| HTTP 状态 | **业务错误也返回 HTTP 200**，错误在 body `{"error":"..."}`；客户端必须查 body 而非 status |
| 限速 | Search 官方 120 req/min（官方文档；未实测逼近）；HTTP 429 也会出现，两种都按 rate_limited 处理 |
| 分页 | search 返回 `next_cursor`/`prev_cursor`，实测每页 **20 条**，cursor 原样回传 `cursor=` 翻页 |
| 高级操作符 | 精确短语、`lang:en`、`-filter:replies` 实测透传且精确生效（20/20 命中）；`since:`/`until:`/`since_time:` 见官方文档（未实测，时间戳必须秒） |

## 端点 schema（已实测字段）

三个端点的作者/指标字段名互不一致，**必须走 `x-api.ts` 归一化，禁止直接透传上游对象**：

| 字段含义 | search `timeline[]` | tweet | screenname |
| --- | --- | --- | --- |
| 推文 id | `tweet_id` | `id` | — |
| 正文 | `text` | `text` + `display_text` | — |
| 作者对象 | `user_info` | `author` | —（顶层） |
| 作者 handle | `user_info.screen_name` | `author.screen_name` | `profile` |
| 粉丝数 | `user_info.followers_count` | `author.sub_count` | `sub_count` |
| 关注数 | `user_info.friends_count` | — | `friends` |
| 点赞数 | `favorites` | `likes` | — |
| 浏览数 | `views`（字符串） | `views`（字符串） | — |
| 认证标记 | `user_info.verified` | `author.blue_verified` | `blue_verified` |
| 头像 | `user_info.avatar` | `author.image` | `avatar` |
| 时间格式 | Twitter legacy：`Sat Nov 07 00:00:01 +0000 2026`（V8 `new Date()` 可直接解析） | 同左 | 同左 |

其余可用端点（timeline / latest_replies / followers / listtimeline 等）尚未实测，schema 见仓库级文档端点表；接入前先在 Playground 验证字段，不要按本表猜。

## 产品映射

- **线索搜索**（核心）：`search.php` + 意向短语组合（"anyone recommend"、"alternative to"、竞品名 + complaint 词），`Latest` 保新鲜度
- **作者画像/打分特征**：`screenname.php`（粉丝量、注册时长、认证状态）+ `user_info`（搜索结果内联）
- **线索详情/上下文**：`tweet.php` 单条复取；会话上下文可用 `latest_replies.php`（未实测）

## 冒烟验证

```bash
pnpm x:smoke   # 3 次授权请求：profile + search + tweet 交叉核验
```

失败即上游 schema 变化——先去 Playground 核对，再更新 `x-api.ts` 的 schema 与本表。
