# 前端书卷风改造 · 接口契约与功能保护清单

本文档是视觉改造的约束基线：改造只动"皮"（样式类、布局、动效），不动"骨"（API 调用、状态机、竞态防护）。改造后逐条对照本清单验收，任何一条失效即视为功能丢失。

## 一、API 调用契约（全部保持，一处不许少）

统一出口 `src/shared/ui/api-client.ts`：`apiRequest<T>`（JSON、credentials:include、no-store、错误信封 → `ApiRequestError(status/code/message/requestId)`）、`createIdempotencyKey`。SSE 用原生 fetch + `Last-Event-ID` 手工解析（不用 EventSource）。

| # | 端点 | 调用点 | 请求 | 消费字段 |
|---|---|---|---|---|
| 1 | POST /api/auth/sign-in/email | auth-form | `{email,password,callbackURL}` | 成功 router.replace |
| 2 | POST /api/auth/sign-up/email | auth-form | `{name,email,password,callbackURL}` | 同上 |
| 3 | POST /api/auth/send-verification-email | auth-form | `{email,callbackURL}` | 同上 |
| 4 | POST /api/auth/sign-out | app-header | `{}` | 无 |
| 5 | GET /api/featured-learning-maps | featured-maps-page | – | `items[](mapId,versionId,title,summary,nodeCount)` |
| 6 | POST /api/featured-learning-maps/{mapId}/learning-relationship | featured-maps-page | 无 body | `learningRelationshipId` |
| 7 | GET /api/learning-relationships | my-learning-page、featured-maps-page | – | `items[](learningRelationshipId,mapId,versionId,title,summary)` |
| 8 | GET /api/learning-relationships/{id}/map | learning-workspace | – | `nodes[]、prerequisites[]、sources[]、viewpoints[]` |
| 9 | GET .../nodes/{nodeId}/assessment | assessment-panel | – | `questions[](questionId,type,prompt,options,sourceIds)` |
| 10 | POST .../nodes/{nodeId}/assessment | assessment-panel | `{answers:[{questionId,selectedOptionIds?/matches?}]}` + `Idempotency-Key` 头 | `nodeScore、completed、questions[].correct/explanation/sourceIds` |
| 11 | GET .../progress | learning-workspace | – | `nodes[](nodeId,completed,bestScore)` |
| 12 | GET .../report | learning-report-page | – | `completion(completionBasisPoints,completedNodeCount,totalNodeCount)、weakNodes、nextSteps、encounteredViewpoints、sources、map.title` |
| 13 | POST /api/map-generations | generation-page | `{topic≤200}` | `snapshot(taskId,status,sequence,result,failure)` |
| 14 | GET /api/map-generations/{taskId} | generation-page | – | terminal snapshot 一致性校验 |
| 15 | GET /api/map-generations/{taskId}/events (SSE) | generation-page | `Accept:text/event-stream`、`Last-Event-ID` | `protocolVersion:"1"/taskId/sequence/type`，重连≤8 次 |

保护条款：

- `api/openapi.yaml` 共 11 path；前端未消费的 `GET /api/featured-learning-maps/{mapId}` 保留在契约中，不得删除。
- 竞态防护必须原样保留：`requestGenerationRef` 计数 + `AbortController`（workspace/report/generation）；SSE sequence 游标 + terminal snapshot 校验。
- 401 / `authentication_required` → 重定向 `/auth` 的错误分支保留。
- URL 即状态：`?page=`（safePage 归一化回写）、`?node=`、`?topic=`、`?next=`、`?verified=1` 全部保留。

## 二、交互入口清单（40 项零丢失验收表）

导航/账户：① 顶部 4 项导航（/learning 高亮覆盖 /learn/* 前缀）② logo→首页 ③ 退出登录（loading 态、失败 inline Alert）④ auth 登录/注册 Segmented 切换 ⑤ 登录提交 ⑥ 注册提交（邮箱格式、密码≥12 校验）⑦ 重发验证邮件 ⑧ nextPath/verified 重定向流。

首页：⑨ 主题输入（≤200、计数、禁用态、role=alert）→ /generate?topic= ⑩ 三张路径卡。

精选页：⑪ 加入学习/继续学习 → 建关系 → /learn/:id（resource_not_found 特判）⑫ 分页(4/页) + 刷新 + 空态。

我的学习：⑬ 关系卡 → /learn/:id ⑭ 分页(5/页) + 刷新 + 空态引导。

生成页：⑮ 主题 TextArea + 提交（idle/submitting/streaming/reconnecting/succeeded/failed/connection_error 七态）⑯ 12 阶段时间线（Progress + aria-current）⑰ 断线自动重连≤8 次 + 警告 ⑱ 手动重连 ⑲ 失败后重置 ⑳ 成功跳 /learn/:id ㉑ generationRequestsEnabled=false 禁用态。

工作区：㉒ 画布 pointer 平移（data-map-node 排除选择器不得改名/删除）㉓ 滚轮缩放 ㉔ 缩放按钮 + 百分比 aria-live ㉕ 节点选中（aria-pressed、completed/selected 态）㉖ 移动端纵向路线 ㉗ 刷新进度 ㉘ 报告入口 ㉙ 来源外链（_blank noopener）㉚ 观点卡（kind/适用条件/依据）㉛ 开始/再次验证。

答题：㉜ Radio 单选 ㉝ Checkbox 多选 ㉞ 匹配 Select ㉟ 观点辨析 ㊱ 进度 ㊲ 返回节点 ㊳ 提交（未答完校验、提交后 disabled 锁定）→ 得分/正确性/解释 → refreshProgress。

报告：㊴ 薄弱节点/下一步 Link（?node= 直达）㊵ 返回地图/重试。

## 三、样式契约

- CSS Modules 的 camelCase 导出名（`styles.xxx`）与类名一律不变：9 处 import 的所有 `styles.*` 引用是 TSX↔CSS 的硬契约。
- Module 内 `:global()` 回钩的全局语义类名不得改名：`.panel-card`、`.back-link`、`.section-kicker`、`.button-primary`、`.workspace-grid`、`.form-message` 等；globals.css 重写时保持全部现有类名。
- 画布几何常量（NODE_WIDTH 264 / HEIGHT 150 / LEVEL_GAP 112 / MIN_SCALE 0.58）与 module 尺寸假设绑定，调整画布视觉时保持节点尺寸常量与 CSS 同步。
- `:not(.ant-btn)` 原生按钮体系与 antd Button 并存，新样式需同时覆盖两套。
- Ant Design 唯一定制点 `app-theme-provider.tsx`，token 换肤在此进行。
- 响应式断点 1100 / 820 / 640px，globals 与 module 两层同步调整。

## 四、改造范围声明

允许：token 层重写（书卷手帐风）、布局重排、字体替换（霞鹜文楷 + Noto Serif SC 自托管）、动效编排（reveal/stagger/粒子背景）、移动端抽屉导航、滚动感知 header。

禁止：改 API 调用、改状态机结构、改路由结构、删除/合并上表任何交互入口、引入"解释性小字"文案（说明性文字仅保留业务必需的 aria 标签与错误提示）。
