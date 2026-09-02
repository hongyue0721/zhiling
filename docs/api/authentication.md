# 认证框架契约

> 实现版本：Better Auth `1.7.2`、`@better-auth/drizzle-adapter` `1.7.2`。本文件记录知径已经验证并依赖的框架边界；Better Auth 托管端点不属于知径业务 OpenAPI。

## 入口与身份边界

Next.js Route Handler 挂载在 `/api/auth/[...all]`，只转交 `GET`、`POST` 给 Better Auth。页面、业务 Route Handler、Server Action 与 SSE 不得读取请求中的用户 ID 作为身份，必须调用身份模块的服务端 `resolve` 或 `require` 能力。

正式身份仅包含：

```ts
{
  userId: string;
  email: string; // 去除首尾空白并转为小写
  emailVerified: true;
}
```

无有效数据库 Session 或邮箱尚未验证时，`resolve` 返回 `null`，`require` 抛出稳定的 `FORMAL_IDENTITY_REQUIRED` 错误。数据库用户行、Session Token、Cookie 与 Better Auth 内部对象不得跨出身份模块。

## 一期托管端点

Route Handler 只允许下表中的方法与路径进入 Better Auth `1.7.2`；字段和错误体仍是锁定框架版本的契约。调用方不得根据英文错误文案驱动业务状态。

| 方法与路径 | 一期用途 | 已验证约束 |
| --- | --- | --- |
| `POST /api/auth/sign-up/email` | 创建邮箱账户 | `name`、`email`、`password`；密码 12–128；创建后不建立 Session；触发验证邮件 |
| `POST /api/auth/sign-in/email` | 显式登录 | 邮箱未验证时拒绝；成功后设置不透明 Session Cookie |
| `POST /api/auth/send-verification-email` | 显式重发验证邮件 | 允许未登录调用；受数据库限流保护 |
| `GET /api/auth/verify-email` | 消费一次性验证链接 | Token 1 小时有效；成功后不自动登录 |
| `GET /api/auth/get-session` | 读取当前框架 Session | 业务代码不得把返回对象直接作为跨模块身份 |
| `POST /api/auth/sign-out` | 撤销当前 Session | 下一次身份解析立即失效 |
| `GET /api/auth/list-sessions` | 列出当前账户 Session | 只供当前已登录账户查看自己的 Session |
| `POST /api/auth/revoke-session` | 按不透明 Token 撤销自己的 Session | 撤销后下一次校验立即失效 |

其他 Better Auth 路径或错误方法在进入框架前统一返回空 HTTP `404`。一期因此不暴露密码恢复、修改密码、修改邮箱、删除账户或未确认插件能力；产品界面不得调用这些路径。新增能力必须先更新决策和允许列表。

## 邮箱验证与投递语义

- 注册时发送验证邮件；未验证账户不能登录成为正式身份；
- 验证链接只包含 Better Auth 生成的一次性 Token 与回调地址；验证后仍需显式登录；
- Resend 适配器直接调用 `POST https://api.resend.com/emails`，不引入 Resend SDK；
- 适配器不读取或透传 Resend 失败正文，把失败收敛为 `VERIFICATION_EMAIL_DELIVERY_FAILED`；API Key、Token 和完整验证 URL 不得进入响应或日志；
- Better Auth `1.7.2` 把账户创建与邮件投递视为两个结果：邮件回调异常会被框架记录，已成功创建的未验证账户及注册成功响应不会回滚。该成功只表示账户请求已受理，不证明邮件已送达；用户通过显式重发端点恢复。前端不得展示“已送达”，只能提示检查邮箱或重试发送。
- 重复注册与已知/未知邮箱的登录失败保持相同外部状态和错误码，响应不得用于枚举账户。

## Session、Cookie 与防护

- Session 存在 PostgreSQL；`expiresIn=7 天`、`updateAge=1 天`；
- 不启用 `session.cookieCache`，数据库中过期或撤销后下一次请求立即失效；
- Cookie 为 `HttpOnly`、`SameSite=Lax`、`Path=/`，生产环境为 `Secure`；调用方只转发 Cookie，不解析名称或结构；
- 明确配置 `BETTER_AUTH_TRUSTED_ORIGINS`，保持 Better Auth Origin 与 CSRF 检查开启；
- 允许同一账户拥有多个设备 Session，不设置一期无依据的数量上限。

## 限流

限流状态使用 PostgreSQL `rateLimit` 表，不使用单进程内存：

`BETTER_AUTH_TRUSTED_PROXIES` 必须是部署反向代理的精确 IP/CIDR 列表，并传入 Better Auth 的 `advanced.ipAddress.trustedProxies`。源站必须限制为只能经这些代理访问；部署检查必须确认代理提供可信 `X-Forwarded-For`。生产请求缺少可解析地址时，Better Auth 会退化为同一路径共享桶并记录警告，这属于部署错误，不能当作正常限流。

- 通用认证路径：每个框架识别的客户端地址每 60 秒最多 100 次；
- `/sign-in/email`：每 10 秒最多 3 次；
- `/sign-up/email`：每 60 秒最多 3 次；
- `/send-verification-email`：每 60 秒最多 3 次。

服务端直接调用 `auth.api` 不经过受管 HTTP 端点的全部限流边界，不得封装成对外公共代理。

## 持久化契约

迁移 `drizzle/0000_identity_auth.sql` 建立 `user`、`account`、`session`、`verification` 与 `rateLimit` 表。邮箱、Session Token、账户发行方与账户 ID、限流 Key 具有唯一约束；账户和 Session 在用户删除时级联删除。模式由 Drizzle 管理，禁止对 Drizzle adapter 使用 Better Auth 内建 `migrate`。

## 变更规则

升级 Better Auth、修改挂载路径、开启 Cookie cache、增加密码恢复、改变邮件供应商、增加 OAuth 或调整 Session/限流策略，必须先更新 ADR、本文、迁移与真实 PostgreSQL 集成测试。托管端点若需要成为知径自有稳定协议，应另建应用层接口并纳入 `api/openapi.yaml`，不能把框架响应原样冒充业务契约。
