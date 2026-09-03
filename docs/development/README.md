# 开发与部署文档

- [本地开发](local-setup.md)：环境、依赖、数据库和开发命令。
- [测试策略](testing.md)：分层测试边界与执行入口。
- [工作包](work-packages.md)：交付顺序和任务边界。
- [Worker 与 VPS Docker 部署](generation-worker-deployment.md)：同镜像 Web/Worker、PostgreSQL 持久卷、供应方环境和 SSE 反向代理配置。
- [生产发布与恢复运维](production-operations.md)：不可变镜像发布、迁移门禁、备份/恢复演练、Worker 租约接管和 Nginx SSE 代理。
- [所有权与评审分配](ownership.md)：模块与共享文件归属。
- [并行工作与交接协议](parallel-work.md)：并行修改的交接规则。
