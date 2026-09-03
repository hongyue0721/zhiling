# 精选学习地图前端接入契约

> 状态：C2a 已冻结；机器可读事实源为 [`api/openapi.yaml`](../../api/openapi.yaml)。本文给前端说明调用顺序、字段语义和不可推断的业务规则。

## 可用能力

前端可以使用三个精选地图闭环接口：

1. 精选目录：`GET /api/featured-learning-maps`；
2. 精选地图详情：`GET /api/featured-learning-maps/{mapId}`；
3. 建立或恢复本人学习关系：`POST /api/featured-learning-maps/{mapId}/learning-relationship`。

两个读取接口只读取已发布且当前仍被精选指针选中的版本；加入接口在同一事务中解析当前精选版本，并只在该版本绑定的已发布题目集完整覆盖每个地图节点（每节点 2–3 道题）时固定题目集。它们都不触发知乎 API、模型生成或后台刷新。干净数据库返回空目录是合法状态，不得用前端假数据伪装成精选内容。

加入成功后，前端应保存响应中的 `learningRelationshipId`，并通过[学习关系地图接口](learning-relationships.md)恢复固定版本；不要凭 `mapId` 或 `versionId` 自行创建关系。

本契约不包含自定义地图、题面、答案、进度或报告；一期不提供分享能力。

## 认证与缓存

- 三个接口都要求 Better Auth 正式 Session，且账户邮箱已验证；
- 同源浏览器请求默认携带 Cookie；封装请求时应显式使用 `credentials: "include"`，避免未来跨封装行为不一致；
- 请求体、查询参数和自定义请求头都不传 `userId`；服务端只从 Session 解析身份；
- 响应使用 `Cache-Control: private, no-store`。不要把正文写入共享 CDN、公共 Service Worker 缓存或跨账户持久缓存；
- 未登录或 Session 失效返回 `401 authentication_required`，前端应进入登录流程；不要通过错误 `message` 字符串判断逻辑。

```ts
export async function getFeaturedLearningMaps() {
  return fetch("/api/featured-learning-maps", {
    credentials: "include",
    cache: "no-store",
  });
}
```

## TypeScript 消费类型

以下类型与 OpenAPI 字段一一对应。前端可以先在其 API 边界使用；若项目后续引入 OpenAPI 类型生成器，应删除手写副本，避免两份事实源漂移。

```ts
export type FeaturedLearningMapSummary = Readonly<{
  mapId: string;
  versionId: string;
  title: string;
  summary: string;
  nodeCount: number;
}>;

export type FeaturedLearningMapList = Readonly<{
  items: readonly FeaturedLearningMapSummary[];
}>;

export type LearningMapNode = Readonly<{
  nodeId: string;
  title: string;
  learningObjective: string;
  sourceIds: readonly string[];
}>;

export type LearningMapPrerequisite = Readonly<{
  nodeId: string;
  prerequisiteNodeId: string;
}>;

export type KnowledgeSource = Readonly<{
  sourceId: string;
  title: string;
  excerpt: string;
  url: string;
  authorName: string;
}>;

export type ViewpointKind =
  "consensus" | "disagreement" | "practical_experience" | "supplementary";

export type SourcedViewpoint = Readonly<{
  viewpointId: string;
  nodeId: string;
  kind: ViewpointKind;
  statement: string;
  conditions: string | null;
  sourceIds: readonly string[];
}>;

export type LearningMapDetail = Readonly<{
  mapId: string;
  versionId: string;
  title: string;
  summary: string;
  nodes: readonly LearningMapNode[];
  prerequisites: readonly LearningMapPrerequisite[];
  sources: readonly KnowledgeSource[];
  viewpoints: readonly SourcedViewpoint[];
}>;

export type LearningRelationshipCreation = Readonly<{
  learningRelationshipId: string;
  mapId: string;
  versionId: string;
}>;
```

## 精选目录

### 请求

```http
GET /api/featured-learning-maps
Accept: application/json
Cookie: <Better Auth Session>
```

### 成功响应

```json
{
  "items": [
    {
      "mapId": "map_system_design",
      "versionId": "mapver_system_design_20260902",
      "title": "系统设计入门",
      "summary": "从需求拆解到可验证架构的学习路径",
      "nodeCount": 6
    }
  ]
}
```

`items` 按服务端保存的精选位置升序返回。精选位置是运营事实，不对外暴露；前端保持返回顺序即可。空目录响应为 `{ "items": [] }`。

## 精选地图详情

### 请求

```http
GET /api/featured-learning-maps/map_system_design
Accept: application/json
Cookie: <Better Auth Session>
```

路径使用稳定 `mapId`，不是 `versionId`。服务端通过精选指针解析当前发布版本。

```ts
export async function getFeaturedLearningMap(mapId: string) {
  return fetch(`/api/featured-learning-maps/${encodeURIComponent(mapId)}`, {
    credentials: "include",
    cache: "no-store",
  });
}
```

### 成功响应

```json
{
  "mapId": "map_system_design",
  "versionId": "mapver_system_design_20260902",
  "title": "系统设计入门",
  "summary": "从需求拆解到可验证架构的学习路径",
  "nodes": [
    {
      "nodeId": "node_requirements",
      "title": "需求与约束",
      "learningObjective": "能够区分业务事实、策略与工程约束",
      "sourceIds": ["source_zhihu_1"]
    },
    {
      "nodeId": "node_capacity",
      "title": "容量估算",
      "learningObjective": "能够把业务规模转换为容量约束",
      "sourceIds": ["source_zhihu_1"]
    },
    {
      "nodeId": "node_components",
      "title": "组件拆分",
      "learningObjective": "能够根据职责划分核心组件",
      "sourceIds": ["source_zhihu_1"]
    },
    {
      "nodeId": "node_tradeoffs",
      "title": "架构取舍",
      "learningObjective": "能够说明方案收益、成本和风险",
      "sourceIds": ["source_zhihu_1"]
    },
    {
      "nodeId": "node_validation",
      "title": "验证方案",
      "learningObjective": "能够设计覆盖关键风险的验证方式",
      "sourceIds": ["source_zhihu_1"]
    }
  ],
  "prerequisites": [
    {
      "nodeId": "node_capacity",
      "prerequisiteNodeId": "node_requirements"
    },
    {
      "nodeId": "node_components",
      "prerequisiteNodeId": "node_capacity"
    },
    {
      "nodeId": "node_tradeoffs",
      "prerequisiteNodeId": "node_components"
    },
    {
      "nodeId": "node_validation",
      "prerequisiteNodeId": "node_tradeoffs"
    }
  ],
  "sources": [
    {
      "sourceId": "source_zhihu_1",
      "title": "如何做好系统设计？",
      "excerpt": "需求和约束决定架构取舍……",
      "url": "https://www.zhihu.com/question/123456789/answer/987654321",
      "authorName": "示例作者"
    }
  ],
  "viewpoints": [
    {
      "viewpointId": "viewpoint_requirements_first",
      "nodeId": "node_requirements",
      "kind": "consensus",
      "statement": "系统设计应从已确认需求和约束开始",
      "conditions": null,
      "sourceIds": ["source_zhihu_1"]
    }
  ]
}
```

示例是结构完整的合成契约数据，不是仓库种子数据，也不得作为前端运行时回退数据。

## 建立或恢复本人学习关系

### 请求

```http
POST /api/featured-learning-maps/map_system_design/learning-relationship
Accept: application/json
Cookie: <Better Auth Session>
```

请求没有请求体。`mapId` 是稳定精选主题身份；服务端只从正式 Session 读取账户，不接受 `userId`、`versionId` 或 `questionSetId`。

服务端在同一持久化事务中解析当前精选指针指向的已发布版本，并确认该版本绑定的已发布题目集对地图中的每个节点恰好包含 2–3 道题，然后以 `(当前账户, versionId)` 唯一键建立或恢复关系。空题目集、缺少节点题目、单个节点题目少于 2 道或多于 3 道时均不会创建关系。相同账户重复加入同一当前版本返回同一个关系 ID，不会创建第二条关系；精选指针切换后再次加入会绑定新版本，旧关系保持不变。

### 成功响应

状态码 `200`，响应只包含后续恢复所需的安全标识：

```json
{
  "learningRelationshipId": "learning_01JXEXAMPLE",
  "mapId": "map_system_design",
  "versionId": "mapver_system_design_20260902"
}
```

响应不包含 `userId`、`questionSetId`、创建时间或数据库行。前端应保存 `learningRelationshipId`，随后使用[学习关系地图接口](learning-relationships.md)读取固定版本。
示例标识仅用于说明字段形状，不是仓库种子数据或运行时回退值。

### 失败响应

- `401 authentication_required`：没有有效正式身份；
- `404 resource_not_found`：精选主题不存在、未列入精选、版本未发布、没有可用的已发布题目集或题目集未覆盖每个节点 2–3 道题；这些情况统一处理，不暴露内部状态；
- `500 internal_error`：服务端无法完成关系事务。

成功与错误响应均为 `Cache-Control: private, no-store`。

## 图与证据渲染规则

- 观点身份使用 `(nodeId, viewpointId)` 复合键；不同节点可能使用相同 `viewpointId`，React key 和前端索引不得只取 `viewpointId`；
- `nodes` 数组顺序只是确定性传输顺序，不表示学习顺序；画布和路径必须读取 `prerequisites`；
- `prerequisiteNodeId → nodeId` 表示前者是后者的先修节点；服务端保证引用存在、无自环且整图无环；
- 正式版本固定包含 5–7 个节点；前端不需要用静默删除节点来“修复”错误图；若契约校验失败，应作为接口错误上报；
- 节点通过 `sourceIds` 关联 `sources`，观点通过 `nodeId` 和 `sourceIds` 同时关联节点及证据；不要按数组下标关联；
- `disagreement` 的 `conditions` 保证为非空文本；其他观点类型允许 `null`，前端应把 `null` 视为“该类型不要求适用条件”，而不是空字符串；
- `source.url` 是服务端已接受的知乎来源 URL。外链使用安全的新窗口属性，例如 `target="_blank" rel="noopener noreferrer"`；
- 首版没有节点展示顺序字段。需要稳定布局时基于节点 ID 和先修边使用确定性布局算法，不能把响应数组顺序固化为产品规则。

## 版本与刷新

`mapId` 在精选主题重新发布后保持不变，`versionId` 会变化。前端应：

1. 把 `versionId` 纳入详情查询缓存键或缓存内容校验；
2. 收到相同 `mapId`、不同 `versionId` 时替换整份图、来源和观点投影，不做按下标合并；
3. 不推断旧版已被删除。旧版为既有学习关系保留，但本接口只返回当前精选版本；
4. 不把当前精选指针切换解释为既有学习进度自动迁移。

## 错误处理

业务错误统一为：

```ts
export type ApiError = Readonly<{
  error: {
    code: string;
    message: string;
    requestId: string;
    issues?: readonly {
      path: string;
      code: string;
      message: string;
    }[];
  };
}>;
```

| HTTP | `error.code`              | 前端动作                                                         |
| ---- | ------------------------- | ---------------------------------------------------------------- |
| 401  | `authentication_required` | 清理本地身份视图并进入登录流程；不要无限重试                     |
| 404  | `resource_not_found`      | 展示统一“精选地图不存在或已下架”；不能区分未发布、非精选和不存在 |
| 500  | `internal_error`          | 展示安全失败状态，并携带 `requestId` 供问题定位                  |

`message` 是安全展示文案，不是稳定分支条件。不要显示响应之外的异常、SQL 或内部状态。

## 前端可立即建立的契约用例

- 有 Session 时目录可渲染 `items`，空数组显示真实空状态；
- 无 Session 时 401 进入登录，不展示缓存中的其他账户正文；
- 点击目录项使用 `mapId` 请求详情；
- 详情根据先修边构图，不依赖节点数组顺序；
- 每个节点可以用 `sourceIds` 找到来源；每个观点可以定位到所属节点和证据；
- 相同 `mapId` 返回新 `versionId` 时整份替换；
- 404 统一展示下架/不存在，不尝试探测草稿或自定义地图。
