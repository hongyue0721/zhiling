import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

type ArchitectureIssueCode =
  | "circular-dependency"
  | "client-private-environment"
  | "client-server-leak"
  | "cross-module-internal"
  | "domain-external-dependency"
  | "generated-import-forbidden"
  | "generated-source-dependency"
  | "layer-dependency"
  | "undeclared-module-dependency";

export type ArchitectureIssue = Readonly<{
  code: ArchitectureIssueCode;
  file: string;
  dependency?: string;
  detail: string;
}>;

export type ArchitectureOptions = Readonly<{
  root: string;
  moduleDependencies?: Readonly<Record<string, readonly string[]>>;
}>;

type SourceFile = Readonly<{
  absolutePath: string;
  relativePath: string;
  imports: readonly string[];
  clientEntry: boolean;
  privateEnvironmentKeys: readonly string[];
}>;

type ModuleLocation = Readonly<{
  name: string;
  layer: string;
  rest: string;
}>;

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const resolutionExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function collectSourcePaths(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const paths: string[] = [];

  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const statistics = statSync(absolutePath);

    if (statistics.isDirectory()) {
      paths.push(...collectSourcePaths(absolutePath));
    } else if (
      sourceExtensions.has(extname(entry)) &&
      !entry.endsWith(".d.ts") &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry)
    ) {
      paths.push(absolutePath);
    }
  }

  return paths.sort();
}

function findPrivateEnvironmentKeys(sourceFile: ts.SourceFile): string[] {
  const keys = new Set<string>();

  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "process" &&
      node.expression.name.text === "env" &&
      !node.name.text.startsWith("NEXT_PUBLIC_")
    ) {
      keys.add(node.name.text);
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "process" &&
      node.expression.name.text === "env" &&
      ts.isStringLiteral(node.argumentExpression) &&
      !node.argumentExpression.text.startsWith("NEXT_PUBLIC_")
    ) {
      keys.add(node.argumentExpression.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...keys].sort();
}

function parseSourceFile(root: string, absolutePath: string): SourceFile {
  const contents = readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(
    absolutePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const firstStatement = sourceFile.statements[0];
  const clientEntry = Boolean(
    firstStatement &&
    ts.isExpressionStatement(firstStatement) &&
    ts.isStringLiteral(firstStatement.expression) &&
    firstStatement.expression.text === "use client",
  );

  return {
    absolutePath,
    relativePath: normalizePath(relative(root, absolutePath)),
    imports: ts
      .preProcessFile(contents, true, true)
      .importedFiles.map(({ fileName }) => fileName),
    clientEntry,
    privateEnvironmentKeys: findPrivateEnvironmentKeys(sourceFile),
  };
}

function resolveLocalImport(
  root: string,
  sourcePath: string,
  specifier: string,
  knownFiles: ReadonlySet<string>,
): string | undefined {
  let candidate: string;

  if (specifier.startsWith("@/")) {
    candidate = resolve(root, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    candidate = resolve(dirname(sourcePath), specifier);
  } else {
    return undefined;
  }

  const candidateExtension = extname(candidate);
  const extensionlessCandidate = resolutionExtensions.includes(
    candidateExtension,
  )
    ? candidate.slice(0, -candidateExtension.length)
    : candidate;
  const candidates = [
    candidate,
    ...resolutionExtensions.map(
      (extension) => `${extensionlessCandidate}${extension}`,
    ),
    ...resolutionExtensions.map((extension) =>
      join(extensionlessCandidate, `index${extension}`),
    ),
  ];

  return candidates.find((path) => knownFiles.has(path));
}

function getModuleLocation(path: string): ModuleLocation | undefined {
  const match = /^src\/modules\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(path);

  if (!match) {
    return undefined;
  }

  return {
    name: match[1],
    layer: match[2],
    rest: match[3] ?? "",
  };
}

function isModulePublicEntry(location: ModuleLocation): boolean {
  return (
    location.layer === "public" &&
    ["client.ts", "contracts.ts", "server.ts"].includes(location.rest)
  );
}

function isWithin(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

function isAllowedModuleDependency(
  source: ModuleLocation,
  target: ModuleLocation,
): boolean {
  if (source.name !== target.name) {
    return (
      source.layer === "application" &&
      target.layer === "public" &&
      target.rest === "contracts.ts"
    );
  }

  switch (source.layer) {
    case "domain":
      return target.layer === "domain";
    case "application":
      return ["application", "domain"].includes(target.layer);
    case "infrastructure":
      return ["application", "domain", "infrastructure"].includes(target.layer);
    case "presentation":
      return (
        target.layer === "presentation" ||
        (target.layer === "public" &&
          ["client.ts", "contracts.ts"].includes(target.rest))
      );
    case "public":
      if (source.rest === "contracts.ts") {
        return target.layer === "public" && target.rest === "contracts.ts";
      }
      if (source.rest === "server.ts") {
        return (
          ["application", "domain", "infrastructure"].includes(target.layer) ||
          (target.layer === "public" &&
            ["contracts.ts", "server.ts"].includes(target.rest))
        );
      }
      if (source.rest === "client.ts") {
        return (
          target.layer === "presentation" ||
          (target.layer === "public" &&
            ["client.ts", "contracts.ts"].includes(target.rest))
        );
      }
      return false;
    default:
      return false;
  }
}

function isAllowedLocalDependency(
  sourcePath: string,
  targetPath: string,
): boolean {
  const sourceModule = getModuleLocation(sourcePath);
  const targetModule = getModuleLocation(targetPath);

  if (sourceModule && targetModule) {
    return isAllowedModuleDependency(sourceModule, targetModule);
  }

  if (sourceModule) {
    if (
      sourceModule.layer === "domain" ||
      sourceModule.layer === "application"
    ) {
      return isWithin(targetPath, "src/shared/kernel");
    }
    if (sourceModule.layer === "infrastructure") {
      return (
        isWithin(targetPath, "src/platform") ||
        isWithin(targetPath, "src/generated")
      );
    }
    if (sourceModule.layer === "presentation") {
      return isWithin(targetPath, "src/shared/ui");
    }
    if (sourceModule.layer === "public") {
      return sourceModule.rest === "client.ts"
        ? isWithin(targetPath, "src/shared/ui")
        : isWithin(targetPath, "src/shared/kernel");
    }
    return false;
  }

  if (isWithin(sourcePath, "src/app")) {
    return (
      isWithin(targetPath, "src/app") ||
      isWithin(targetPath, "src/bootstrap") ||
      isWithin(targetPath, "src/shared/ui") ||
      isWithin(targetPath, "src/generated") ||
      Boolean(targetModule && isModulePublicEntry(targetModule))
    );
  }

  if (isWithin(sourcePath, "src/bootstrap")) {
    return (
      isWithin(targetPath, "src/bootstrap") ||
      isWithin(targetPath, "src/platform") ||
      Boolean(
        targetModule &&
        targetModule.layer === "public" &&
        ["contracts.ts", "server.ts"].includes(targetModule.rest),
      )
    );
  }

  if (isWithin(sourcePath, "src/platform")) {
    return (
      isWithin(targetPath, "src/platform") ||
      isWithin(targetPath, "src/shared/kernel")
    );
  }

  if (isWithin(sourcePath, "src/shared")) {
    return isWithin(targetPath, "src/shared");
  }

  if (isWithin(sourcePath, "src/generated")) {
    return isWithin(targetPath, "src/generated");
  }

  return true;
}

function isServerOnlyPath(path: string): boolean {
  const moduleLocation = getModuleLocation(path);

  return (
    isWithin(path, "src/bootstrap") ||
    path === "src/platform/config/server.ts" ||
    /\.server\.[cm]?[jt]sx?$/.test(path) ||
    Boolean(
      moduleLocation &&
      (moduleLocation.layer === "infrastructure" ||
        (moduleLocation.layer === "public" &&
          moduleLocation.rest === "server.ts")),
    )
  );
}

function addIssue(
  issues: ArchitectureIssue[],
  issue: ArchitectureIssue,
  seen: Set<string>,
): void {
  const identity = `${issue.code}:${issue.file}:${issue.dependency ?? ""}:${issue.detail}`;

  if (!seen.has(identity)) {
    seen.add(identity);
    issues.push(issue);
  }
}

export function checkArchitecture({
  root,
  moduleDependencies = {},
}: ArchitectureOptions): ArchitectureIssue[] {
  const absoluteRoot = resolve(root);
  const sourceFiles = collectSourcePaths(join(absoluteRoot, "src")).map(
    (path) => parseSourceFile(absoluteRoot, path),
  );
  const filesByAbsolutePath = new Map(
    sourceFiles.map((file) => [file.absolutePath, file]),
  );
  const knownFiles = new Set(filesByAbsolutePath.keys());
  const graph = new Map<string, string[]>();
  const serverOnlyFiles = new Set<string>();
  const issues: ArchitectureIssue[] = [];
  const seenIssues = new Set<string>();

  for (const file of sourceFiles) {
    const dependencies: string[] = [];

    if (
      file.imports.includes("server-only") ||
      isServerOnlyPath(file.relativePath)
    ) {
      serverOnlyFiles.add(file.relativePath);
    }

    for (const specifier of file.imports) {
      const resolvedImport = resolveLocalImport(
        absoluteRoot,
        file.absolutePath,
        specifier,
        knownFiles,
      );

      if (!resolvedImport) {
        const sourceModule = getModuleLocation(file.relativePath);
        if (sourceModule?.layer === "domain") {
          addIssue(
            issues,
            {
              code: "domain-external-dependency",
              file: file.relativePath,
              dependency: specifier,
              detail:
                "Domain code may not depend on packages or Node.js built-ins.",
            },
            seenIssues,
          );
        }
        continue;
      }

      const target = filesByAbsolutePath.get(resolvedImport);
      if (!target) {
        continue;
      }
      dependencies.push(target.relativePath);

      const sourceModule = getModuleLocation(file.relativePath);
      const targetModule = getModuleLocation(target.relativePath);

      if (
        sourceModule &&
        targetModule &&
        sourceModule.name !== targetModule.name
      ) {
        if (!isModulePublicEntry(targetModule)) {
          addIssue(
            issues,
            {
              code: "cross-module-internal",
              file: file.relativePath,
              dependency: target.relativePath,
              detail: "Cross-module imports must use an explicit public entry.",
            },
            seenIssues,
          );
        }

        const declaredTargets = moduleDependencies[sourceModule.name] ?? [];
        if (!declaredTargets.includes(targetModule.name)) {
          addIssue(
            issues,
            {
              code: "undeclared-module-dependency",
              file: file.relativePath,
              dependency: target.relativePath,
              detail: `${sourceModule.name} does not declare a dependency on ${targetModule.name}.`,
            },
            seenIssues,
          );
        }
      }

      if (
        isWithin(target.relativePath, "src/generated") &&
        sourceModule &&
        ["application", "domain", "public"].includes(sourceModule.layer)
      ) {
        addIssue(
          issues,
          {
            code: "generated-import-forbidden",
            file: file.relativePath,
            dependency: target.relativePath,
            detail:
              "Domain, application, and public module code cannot consume generated types.",
          },
          seenIssues,
        );
      }

      if (
        isWithin(file.relativePath, "src/generated") &&
        !isWithin(target.relativePath, "src/generated")
      ) {
        addIssue(
          issues,
          {
            code: "generated-source-dependency",
            file: file.relativePath,
            dependency: target.relativePath,
            detail:
              "Generated source must not depend on handwritten application source.",
          },
          seenIssues,
        );
      }

      if (!isAllowedLocalDependency(file.relativePath, target.relativePath)) {
        addIssue(
          issues,
          {
            code: "layer-dependency",
            file: file.relativePath,
            dependency: target.relativePath,
            detail:
              "The dependency points against the accepted layer direction.",
          },
          seenIssues,
        );
      }
    }

    graph.set(file.relativePath, dependencies);
  }

  const visitState = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];

  function visit(path: string): void {
    const state = visitState.get(path);
    if (state === "visited") {
      return;
    }
    if (state === "visiting") {
      const cycleStart = stack.indexOf(path);
      const cycle = [...stack.slice(cycleStart), path];
      addIssue(
        issues,
        {
          code: "circular-dependency",
          file: path,
          detail: cycle.join(" -> "),
        },
        seenIssues,
      );
      return;
    }

    visitState.set(path, "visiting");
    stack.push(path);
    for (const dependency of graph.get(path) ?? []) {
      visit(dependency);
    }
    stack.pop();
    visitState.set(path, "visited");
  }

  for (const path of graph.keys()) {
    visit(path);
  }

  const sourceFilesByPath = new Map(
    sourceFiles.map((file) => [file.relativePath, file]),
  );

  for (const clientEntry of sourceFiles.filter((file) => file.clientEntry)) {
    const queue: Array<{ path: string; chain: string[] }> = [
      { path: clientEntry.relativePath, chain: [clientEntry.relativePath] },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.path)) {
        continue;
      }
      visited.add(current.path);

      const currentFile = sourceFilesByPath.get(current.path);
      if (!currentFile) {
        continue;
      }

      if (serverOnlyFiles.has(current.path)) {
        addIssue(
          issues,
          {
            code: "client-server-leak",
            file: clientEntry.relativePath,
            dependency: current.path,
            detail: current.chain.join(" -> "),
          },
          seenIssues,
        );
      }

      for (const key of currentFile.privateEnvironmentKeys) {
        addIssue(
          issues,
          {
            code: "client-private-environment",
            file: clientEntry.relativePath,
            dependency: current.path,
            detail: `Client dependency graph reads non-public environment key ${key}.`,
          },
          seenIssues,
        );
      }

      for (const dependency of graph.get(current.path) ?? []) {
        queue.push({
          path: dependency,
          chain: [...current.chain, dependency],
        });
      }
    }
  }

  return issues.sort((left, right) => {
    const leftKey = `${left.file}:${left.code}:${left.dependency ?? ""}`;
    const rightKey = `${right.file}:${right.code}:${right.dependency ?? ""}`;
    return leftKey.localeCompare(rightKey);
  });
}

async function runCommand(): Promise<void> {
  const root = process.cwd();
  const configUrl = pathToFileURL(join(root, "architecture.config.mjs")).href;
  const config = (await import(configUrl)).default as {
    moduleDependencies?: Readonly<Record<string, readonly string[]>>;
  };
  const issues = checkArchitecture({
    root,
    moduleDependencies: config.moduleDependencies,
  });

  if (issues.length === 0) {
    process.stdout.write("Architecture boundaries are valid.\n");
    return;
  }

  for (const issue of issues) {
    const dependency = issue.dependency ? ` -> ${issue.dependency}` : "";
    process.stderr.write(
      `[${issue.code}] ${issue.file}${dependency}: ${issue.detail}\n`,
    );
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void runCommand();
}
