import { resolve } from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createPostgresDatabase } from "@/platform/database/postgres";

import { DEMO_DISCLOSURE, DEMO_EMAIL, DEMO_PASSWORD } from "./content";
import { readDemoEnvironment } from "./environment";
import { prepareDemoAccount } from "./prepare-account";
import { prepareDemoContent } from "./prepare-content";

async function main(): Promise<void> {
  const environment = readDemoEnvironment();
  const { database, pool } = createPostgresDatabase(environment.databaseUrl);

  try {
    console.log(`${DEMO_DISCLOSURE}｜正在迁移独立 Demo 数据库。`);
    await migrate(database, {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });

    const account = await prepareDemoAccount(database, environment);
    console.log(
      `${DEMO_DISCLOSURE}｜固定 Demo 账号已${account.state === "created" ? "创建并通过正规验证链接验证" : "使用固定凭据登录核验并复用"}。`,
    );

    const content = await prepareDemoContent(database);
    console.log(
      `${DEMO_DISCLOSURE}｜固定学习地图：${content.map}；固定题集：${content.questionSet}。`,
    );
    console.log(
      `${DEMO_DISCLOSURE}｜登录地址：${environment.authBaseUrl}/auth`,
    );
    console.log(`${DEMO_DISCLOSURE}｜Demo 邮箱：${DEMO_EMAIL}`);
    console.log(`${DEMO_DISCLOSURE}｜Demo 密码：${DEMO_PASSWORD}`);
    console.log(
      `${DEMO_DISCLOSURE}｜未启动 generation Worker；页面现场生成仍要求真实供应方。`,
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : "unknown error";
  console.error(`${DEMO_DISCLOSURE}｜Demo 准备失败：${reason}`);
  process.exitCode = 1;
});
