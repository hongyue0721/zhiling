# GitHub 仓库治理设置

本文记录 GitHub 远程设置的已核实状态、目标状态和受平台限制的差距。远程设置不是仓库文件，调整后必须在本文更新审查日期与实际结果，不能把建议写成已经生效的事实。

## 当前状态

审查日期：2026-09-02。

通过 GitHub CLI 只读查询确认：

| 项目 | 当前状态 |
| --- | --- |
| 仓库 | `hongyue0721/zhiling`，私有仓库 |
| 默认分支 | `main` |
| 集成分支 | `dev`，普通任务 PR 的唯一目标 |
| Actions | 已启用，仅允许 GitHub 官方 Action |
| 工作流默认权限 | 仅读取仓库内容；`dev-to-main` Bot 单独声明最小写权限 |
| Action SHA 固定要求 | 已启用；所有外部 Action 必须使用完整提交 SHA |
| 合并方式 | 仅允许 rebase；merge commit 与 squash 已关闭 |
| PR 分支更新 | 维护者可更新落后于目标分支的 PR 分支 |
| 合并后删除分支 | 已启用 |
| Dependabot 漏洞告警 | 已启用 |
| Secret scanning 与 push protection | 当前仓库不可用，启用请求返回 HTTP 422 |
| 协作者 | 当前只有仓库管理员 `hongyue0721` |
| 分支保护与规则集 | 当前私有仓库套餐不支持；读取接口返回 HTTP 403 并要求升级 GitHub Pro 或公开仓库 |

最后一项表示平台能力当前不可用，不能据此声称 `dev` 或 `main` 已受保护。仓库中的 CI 会报告违规；正常流程由普通 PR 合入 `dev`、`dev-to-main` Bot 提升到 `main` 共同保证，但管理员仍可能直接推送或绕过检查。

## 仓库内门禁

工作流 [`.github/workflows/collaboration.yml`](../../.github/workflows/collaboration.yml) 和 [`.github/workflows/quality.yml`](../../.github/workflows/quality.yml) 检查目标为 `dev` 或 `main` 的 PR，以及两个分支的推送。

普通工作流使用最小的 `contents: read` 权限，并把官方 `actions/checkout` 固定到 `v7.0.1` 对应的完整提交。拉取请求会检查：

- 当前树和变更范围没有 Git 空白错误；
- Markdown 本地文件链接指向仓库内现存目标；
- `api/openapi.yaml` 能被安全解析，并具备 OpenAPI 基础根结构；
- ADR 文件、索引链接和状态保持一致；
- PR 相对目标提交新增的每个提交都包含中文标题，以及独立非空的“功能：”“原因：”“验证：”正文行。

工作流 [`.github/workflows/dev-to-main.yml`](../../.github/workflows/dev-to-main.yml) 仅监听 `dev` 推送，使用 `contents: write`、`pull-requests: write` 和 `checks: read`：

1. 等待同一 dev 提交的 `协作规范检查 / 验证协作基线` 和 `工程质量检查 / 验证工程基线` 成功；
2. 创建或复用 `dev` → `main` 提升 PR；
3. 使用 rebase 自动合入；冲突、失败或超时直接停止。

开发者可在本地执行：

```bash
scripts/verify-collaboration.sh --base origin/dev --head HEAD
```

需要同时检查某个提交范围时执行：

```bash
scripts/verify-collaboration.sh --base <目标提交> --head <待检查提交>
```

该检查只提供不依赖项目包管理器的基础治理门禁。它验证 OpenAPI YAML 的语法与基础结构，不冒充完整的 OpenAPI 语义校验；应用工程建立后仍需增加正式契约校验与契约测试。

## 目标设置

平台能力允许后，应同时为 `dev` 和 `main` 建立规则集或分支保护：

1. `dev` 必须通过普通 PR 合入，禁止直接推送和强制推送；
2. `dev` 必须通过状态检查 `协作规范检查 / 验证协作基线` 与 `工程质量检查 / 验证工程基线`；
3. `main` 只允许 `dev-to-main` Bot 的提升 PR，禁止普通 PR 和直接推送；
4. `main` 必须保留提升 PR 的自动检查与审计记录；
5. 新增其他稳定 CI 后，将其纳入 `dev` 和 `main` 的必需检查；
6. 至少一名代码所有者批准普通 PR，并在新提交后撤销旧批准；
7. 所有评审会话解决后才能合入；
8. 禁止删除 `dev` 和 `main`，保留管理员应急绕过的审计记录。

提交说明门禁要求保留每个已经通过检查的中文提交，因此远程现已关闭 merge commit 与 squash，只保留 rebase 合入。合入后自动删除任务分支；`dev` 与 `main` 的正常推进均保留 PR、工作流和提交记录。

新增实际协作者后仍需维护 `CODEOWNERS`，避免把单人所有权误写成多人审批已经生效。

## 启用保护前的确认

哥哥需要先在下列方案中选择一个，才能真正启用远程保护：

- 将仓库继续保持私有并升级到支持私有仓库保护规则的方案；
- 将仓库改为公开，以使用公开仓库支持的保护能力；
- 暂时保持现状，接受 CI 只能审计、不能强制阻止合入的限制。

这属于仓库可见性、费用和协作权限决策，本文不代替哥哥选择，也不通过 API 自动修改。
