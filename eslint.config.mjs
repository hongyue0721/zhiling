import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: directory });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "node_modules/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
      "tests/architecture/fixtures/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Playwright fixture 的 use() 是测试夹具生命周期 API 而非 React Hook，
    // 规则无法区分，按官方建议对 e2e 测试目录关闭 hooks 规则
    files: ["tests/e2e/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];

export default eslintConfig;
