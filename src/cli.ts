import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "./db";
import { NurbsService, ServiceError } from "./service";
import { resolveConfig } from "./server";

function help(): string {
  return `NURBS 后端 CLI

用法:
  node dist/cli.js <命令> [参数]

命令:
  constants                                      查看次数/控制点上限等常量
  import <file.json>                             从 JSON 文件导入曲线，返回 curveId/version
  list                                           列出全部曲线
  versions <curveId>                             列出某曲线的全部冻结版本
  meta <curveId> [version]                       查看曲线元数据（有效参数区间等）
  eval <curveId> <u1,u2,...> [--version N]       批量求值（点+一阶导数+可微性）
  tangent <curveId> <u> [left|right] [--version N]  切向查询
  refine <curveId> <u1,u2,...> [--version N]     事务性节点细化（新版本+保形核验）
  arclength <curveId> [--tol T] [--max-sub N] [--from a] [--to b] [--version N]
                                                 自适应弧长积分
  compare <curveId> <v1> <v2>                    两版本结构对照 + 保形核验
  report <reportId>                              读取已冻结的历史报告（JSON）
  reports [curveId]                              列出报告
  export <curveId> [version] [json|csv]          导出到 stdout（可重定向到文件）
  help                                           显示本帮助

环境变量:
  PORT / NURBS_PORT        HTTP 端口（默认 3000）
  NURBS_DATA_DIR           SQLite 数据目录（默认 ./data）
`;
}

function parseNumList(s: string): number[] {
  return s.split(",").map((x) => {
    const n = Number(x.trim());
    if (!Number.isFinite(n)) throw new Error(`无法解析为数字: ${x}`);
    return n;
  });
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<number> {
  const cfg = resolveConfig();
  const store = new Store(cfg.dataDir);
  const svc = new NurbsService(store);
  const [cmd, ...args] = argv;
  try {
    switch (cmd) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        process.stdout.write(help());
        return 0;
      case "constants":
        print(svc.constants());
        return 0;
      case "import": {
        const file = args[0];
        if (!file) throw new Error("需要 JSON 文件路径");
        const json = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
        print(svc.importCurve(json));
        return 0;
      }
      case "list":
        print(svc.listCurves());
        return 0;
      case "versions":
        print(svc.listVersions(Number(args[0])));
        return 0;
      case "meta":
        print(svc.metadata(Number(args[0]), args[1] ? Number(args[1]) : undefined));
        return 0;
      case "eval": {
        const ver = option(args, "--version");
        print(svc.batchEvaluate(Number(args[0]), parseNumList(args[1]), ver ? Number(ver) : undefined));
        return 0;
      }
      case "tangent": {
        const ver = option(args, "--version");
        print(
          svc.tangentQuery(
            Number(args[0]),
            Number(args[1]),
            (args[2] as "left" | "right") ?? "right",
            ver ? Number(ver) : undefined,
          ),
        );
        return 0;
      }
      case "refine": {
        const ver = option(args, "--version");
        print(
          svc.refine(Number(args[0]), parseNumList(args[1]), ver ? Number(ver) : undefined),
        );
        return 0;
      }
      case "arclength": {
        const cid = Number(args[0]);
        const v = option(args, "--version");
        print(
          svc.arcLength(cid, {
            version: v ? Number(v) : undefined,
            tolerance: option(args, "--tol") ? Number(option(args, "--tol")) : undefined,
            maxSubdivisions: option(args, "--max-sub")
              ? Number(option(args, "--max-sub"))
              : undefined,
            rangeStart: option(args, "--from") ? Number(option(args, "--from")) : undefined,
            rangeEnd: option(args, "--to") ? Number(option(args, "--to")) : undefined,
          }),
        );
        return 0;
      }
      case "compare":
        print(svc.compareVersions(Number(args[0]), Number(args[1]), Number(args[2])));
        return 0;
      case "report":
        print(svc.getReport(Number(args[0])));
        return 0;
      case "reports":
        print(svc.listReports(args[0] ? Number(args[0]) : undefined));
        return 0;
      case "export": {
        const fmt = (args[2] as "json" | "csv") ?? "json";
        process.stdout.write(
          svc.exportCurve(Number(args[0]), args[1] ? Number(args[1]) : undefined, fmt),
        );
        process.stdout.write("\n");
        return 0;
      }
      default:
        process.stderr.write(`未知命令: ${cmd}\n\n${help()}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof ServiceError) {
      process.stderr.write(`错误[${e.status}]: ${e.message}\n`);
      if (e.fields) process.stderr.write(JSON.stringify(e.fields, null, 2) + "\n");
      return 1;
    }
    process.stderr.write(`错误: ${(e as Error).message}\n`);
    return 1;
  } finally {
    store.close();
  }
}

function print(x: unknown) {
  process.stdout.write(JSON.stringify(x, null, 2) + "\n");
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
