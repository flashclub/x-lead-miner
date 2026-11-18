# RAG 与 LangChain 场景挖掘（x-lead-miner）

- 结论日期：2026-11-16
- 目的：找**真值得做**的 RAG / LangChain 落点——既有产品价值，又能扛住面试追问
- 纪律：不做「为了简历关键词而框架」。反例清单见文末。

## 结论速览

| 场景 | 技术 | 真价值 | 面试含金量 | 建议优先级 |
| --- | --- | --- | --- | --- |
| ① 自然语言挖掘代理 | LangGraph/LangChain.js + tools | ★★★ | ★★★（agentic 是 2026 关键词） | P1，演示最大亮点 |
| ② 线索库语义检索 + 相似成交线索打分 | RAG（Cloudflare Vectorize + 已有嵌入） | ★★★ | ★★☆（把 PyTorch 故事串成闭环） | P1，产品完整度最大 |
| ③ 蒸馏标注管线升级 | LangChain structured output + few-shot 检索 | ★★ | ★☆ | P2，半天活 |
| ✗ 把 /api/chat 包进 LangChain | — | ✗ 单次 fetch 足够 | 负分（会被问穿） | 不做 |
| ✗ 产品文档 RAG 问答 | — | ✗ 产品没有文档体量 | 负分 | 不做 |

## 场景①：自然语言挖掘代理（最值得做）

**用户痛点**：现在用户要自己会写 `lang:en -filter:replies` 这类操作符。目标用户（创始人/销售）不会。

**形态**：在 Chat 页把对话升级为 agent——LLM 配三个工具：

```
用户「帮我找这周吐槽 HubSpot 并想换掉的人」
  └─ agent 规划：generate_query 工具（自然语言 → X 高级搜索语句）
       → x_search 工具（调 /api/leads/search 同一链路，复用打分）
       → author_profile 工具（screenname.php 拉作者画像）
       → 汇总输出 top 5 线索 + 推荐话术角度
```

**技术选型**：LangChain.js 的 agent 直接住在 Next.js API 路由里（与部署栈一致），工具=对自有 API 的 fetch 封装；要更强的规划/中断恢复就上 LangGraph（Python 版可放 intent/ sidecar）。工具只是自有 API 的薄封装，不引入新的数据风险。

**面试答辩点**：为什么这里用 agent 而不是一条 prompt？——因为任务需要多步规划（生成查询→执行→评估→补搜），且每步失败要重试换路；工具调用+状态机是这个形状问题的标准解。同时能答「LangChain 我们只在 agent 编排层用，单次补全仍是裸 fetch」——框架用在刀刃上。

**工作量**：2-3 天（工具封装 0.5 天 + agent 路由 1 天 + Chat 页流式呈现 1 天）。

## 场景②：线索库 RAG +「相似成交线索」信号（产品价值最大）

**痛点**：搜索结果刷新即失，产品口号是 "scored lead queue" 但队列不存在；用户的「哪类线索真正成交过」经验没有沉淀。

**形态**：
1. 新增 D1 表 `x_lead_miner_post`（两表预算内），存已挖线索 + 用户动作（已回复/成交/忽略）
2. 帖子嵌入（intent/ 管线现成）入 **Cloudflare Vectorize**（Workers 原生向量库，与部署栈零摩擦）
3. 两个 RAG 用法：
   - **Chat 里查线索库**：「过去两周有哪些人在抱怨客服系统？」→ 向量检索 → LLM 总结
   - **相似成交信号**：新帖子向量 vs 用户标记为「成交」的线索向量做相似度，作为打分特征混入排序——**让 PyTorch 模型 + 用户反馈数据形成闭环**

**面试答辩点**：嵌入模型是我们自己选型 benchmark 过的（embeddinggemma-2），同一套嵌入既喂分类头又喂向量库——「一个嵌入空间，两个下游」，这是 RAG 架构里很顺的讲法。Vectorize 的选型对比（vs Pinecone/自建 pgvector）也要能讲：绑定在 Workers 内零网络跳数、按量计费、容量上限适合小线索库。

**工作量**：1-2 天（表 + 迁移 0.5 天，Vectorize 绑定与检索 0.5 天，UI 队列页 1 天）。

## 场景③：标注管线升级（低成本先做）

label.py 现在是单发 prompt + 正则抠 JSON。LangChain 化改两处：
1. `with_structured_output` 强约束 schema（intent/type/confidence），消灭正则兜底
2. few-shot：从已人工确认的标注里检索 3 条相似帖作为示例（检索本身就是场景②的副产品）

收益：标注质量提升 → 分类头 precision@k 上限提升；同时给 label.py 的面试叙述加一句「结构化输出 + few-shot 蒸馏」。**工作量：半天。**

## 反模式清单（面试官会追问「你为什么不用 X」时的防守）

- **不用 LangChain 包 /api/chat**：单次 chat completion 是一个 fetch 的事，框架抽象只增加延迟、依赖和调试成本。正确说法：「框架在多步编排处才引入，单点调用我坚持裸 fetch」。
- **不做产品文档 RAG**：产品自己没有文档体量，硬做就是空壳 RAG（违反本仓库「SEO 页面必须有真实内容」的同一纪律）。
- **不自己维护向量库**：D1 没有向量索引；自建 pgvector 要多养一个 Postgres。Vectorize 是部署栈原生件，选它不需要辩解。

## 推进顺序建议

1. 先跑完训练（intent/ 已就绪）→ precision@k 有数
2. 场景②（队列表 + Vectorize）——它同时补上「产品完整度」和 RAG 故事
3. 场景①（agent）——演示压轴
4. 场景③随手带上
