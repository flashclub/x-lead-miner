# AI API Key X 数据契约记录（x-lead-miner）

- 来源：https://aiapikey.ai/docs（完整参考 `/llms-full.txt`，OpenAPI `/openapi.json`，交互式 `/docs/reference`）
- 本文核对日期：**2026-11-25**（真实 key 实测，非文档转抄）
- 代码位置：`src/lib/x-api.ts`（类型化客户端）、`scripts/x-api-smoke.ts`（契约冒烟）
- 密钥：`AIAPIKEY_KEY`（.dev.vars 本地 / Workers secrets 生产），只经服务端 `Authorization: Bearer` 上送，禁止进浏览器/日志

> 历史：2026-11-25 从 scraper.tech 迁移而来（旧服务当时不可用）。搜索操作符、
> 游标分页、legacy 日期格式都与旧服务兼容；字段命名从 snake_case 变为 camelCase。

## 实测核验结论（2026-11-25）

| 项 | 结论 |
| --- | --- |
| 鉴权 | header `Authorization: Bearer ua_live_…`；不带鉴权头返回 402（x402 USDC 支付挑战），无效 key 返回 401 `{"error":{"code":"unauthorized",...}}`（均实测） |
| 计费 | **按返回条数计费**：X 结果 12 credits/条，$1 = 100,000 credits；免费层 60,000 credits/月 ≈ 5,000 条。一页 20 条 = 240 credits。无按请求的固定费 |
| 限速 | 无文档化的 req/min 限制，只有 credits 配额；429 `quota_exceeded` = credits 用尽 |
| 分页 | search 返回 `nextCursor`/`previousCursor`（不透明字符串），实测每页 **20 条**，0 重叠，cursor 原样回传 `cursor=` 翻页 |
| 高级操作符 | 精确短语、`lang:en`、`-filter:replies` 实测透传且精确生效（线上同一查询 20/20 命中）；`since:`/`until:`/`min_faves:` 见官方操作符表 |
| searchType | `Top`/`Latest`/`Media`/`People`/`Lists`；应用只用 Top/Latest，均实测（Latest 20 条、Top 19 条） |
| 延迟 | 单页搜索实测 3.9–4.1s |

## 端点 schema（已实测字段）

应用只用三个端点（括号内为替代的旧 scraper.tech 端点）：

| 用途 | 端点 | 替代 |
| --- | --- | --- |
| 线索搜索（核心） | `GET /v1/x/search?query&searchType&cursor` | `search.php` |
| 作者画像 | `GET /v1/x/users?username=`（或 `?id=`） | `screenname.php` |
| 线索详情 | `GET /v1/x/tweets?id=` | `tweet.php` |

响应统一为 camelCase 的 `XTweet`（`tweets[]`），字段见 `src/lib/x-api.ts` 的 schema：

| 字段含义 | 上游字段 |
| --- | --- |
| 推文 id | `id` |
| 正文 | `text` |
| 链接 | `url`（完整 x.com 链接，实测带真实 handle） |
| 时间 | `createdAt` — Twitter legacy 格式 `Wed Nov 25 01:46:03 +0000 2026`（V8 `new Date()` 可直接解析，与旧服务相同） |
| 语言 | `language` |
| 作者 | `author.{name, screenName, avatar, followers(int), verified(bool)}` |
| 指标 | `metrics.{bookmarks, favorites, quotes, replies, retweets, views}`（全 int） |
| 附加 | `hashtags[]`、`mentions[]` |

`/v1/x/users` 返回 `{id, name, screenName, avatar, followers, verified, bio, createdAt}`。

### 已知坑

- **整页作者被清空 / 整页为空（实测 2026-11-25，事故级）**：上游间歇性返回两种坏页——
  ① `author` 全空的推文页（`screenName`/`name` 空串、`followers` 0、`url` 退化为
  `x.com/i/status/…`），② 直接 `tweets: []` 的空页。与查询词无关，劣化期约一半页面中招、
  重取也可能再中。`search()` 最多尝试 3 页、保留作者最全的一页（每页都花 credits，事故期
  一次搜索最多 720 credits；真正无结果的查询也会跑满 3 次）。UI 侧对空 handle 做隐藏降级。
- **单条推文端点的 author 是 best-effort**：实测 `author.followers = 0`、`avatar = ""`，
  与 search 结果里的真实值不一致。产品只依赖 search 的作者字段。
- **上游没有**（旧服务有，归一化接口里恒为 `undefined`）：推文级作者 `rest_id`、
  `conversation_id`；profile 的 `location`/`statuses_count`/`protected`。无调用方使用。
- 错误码名与文档表略有出入（实测 400 返回 `invalid-query`，文档写 `invalid_params`）——
  按 **HTTP 状态码**分类，不要 hardcode code 字符串。

## 产品映射

- **线索搜索**（核心）：`/v1/x/search` + 意向短语组合（"anyone recommend"、"alternative to"、竞品名 + complaint 词），`Latest` 保新鲜度
- **作者画像/打分特征**：`/v1/x/users`（粉丝量、注册时长、认证状态）
- **线索详情/上下文**：`/v1/x/tweets` 单条复取；会话上下文可用 `/v1/x/tweets/replies`（未实测）

## 冒烟验证

```bash
pnpm x:smoke   # 3 次授权请求：profile + search + tweet 交叉核验（约消耗 50 条 credits）
```

失败即上游 schema 变化——先去 https://aiapikey.ai/docs/reference 核对，再更新 `x-api.ts` 的 schema 与本表。
