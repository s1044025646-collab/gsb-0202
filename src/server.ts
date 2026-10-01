import * as http from "node:http";
import { Store } from "./db";
import { NurbsService, ServiceError } from "./service";
import * as path from "node:path";

interface AppConfig {
  port: number;
  dataDir: string;
}

export function resolveConfig(): AppConfig {
  const port = Number(process.env.PORT ?? process.env.NURBS_PORT ?? 3000);
  const dataDir = path.resolve(
    process.env.NURBS_DATA_DIR ?? path.join(process.cwd(), "data"),
  );
  return { port, dataDir };
}

interface Route {
  method: string;
  pattern: RegExp;
  handler: (svc: NurbsService, body: any, params: RegExpExecArray, url: URL) => any;
  raw?: boolean;
  format?: "json" | "csv";
}

const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/constants$/, handler: (s) => s.constants() },
  { method: "GET", pattern: /^\/api\/curves$/, handler: (s) => s.listCurves() },
  {
    method: "POST",
    pattern: /^\/api\/curves$/,
    handler: (s, body) => s.importCurve(body),
  },
  {
    method: "GET",
    pattern: /^\/api\/curves\/(\d+)$/,
    handler: (s, _b, m, url) =>
      s.metadata(Number(m[1]), numParam(url, "version")),
  },
  {
    method: "GET",
    pattern: /^\/api\/curves\/(\d+)\/versions$/,
    handler: (s, _b, m) => s.listVersions(Number(m[1])),
  },
  {
    method: "POST",
    pattern: /^\/api\/curves\/(\d+)\/evaluate$/,
    handler: (s, body, m) =>
      s.batchEvaluate(Number(m[1]), body.us ?? (body.u === undefined ? [] : [body.u]), body.version),
  },
  {
    method: "POST",
    pattern: /^\/api\/curves\/(\d+)\/tangent$/,
    handler: (s, body, m) =>
      s.tangentQuery(Number(m[1]), body.u, body.side ?? "right", body.version),
  },
  {
    method: "POST",
    pattern: /^\/api\/curves\/(\d+)\/refine$/,
    handler: (s, body, m) => s.refine(Number(m[1]), body.knots ?? [], body.version),
  },
  {
    method: "POST",
    pattern: /^\/api\/curves\/(\d+)\/arc-length$/,
    handler: (s, body, m) =>
      s.arcLength(Number(m[1]), {
        version: body.version,
        tolerance: body.tolerance,
        maxSubdivisions: body.maxSubdivisions,
        rangeStart: body.rangeStart,
        rangeEnd: body.rangeEnd,
      }),
  },
  {
    method: "POST",
    pattern: /^\/api\/curves\/(\d+)\/compare$/,
    handler: (s, body, m) => s.compareVersions(Number(m[1]), body.v1, body.v2),
  },
  {
    method: "GET",
    pattern: /^\/api\/curves\/(\d+)\/export$/,
    raw: true,
    format: "json",
    handler: (s, _b, m, url) =>
      s.exportCurve(
        Number(m[1]),
        numParam(url, "version"),
        (url.searchParams.get("format") as "json" | "csv") ?? "json",
      ),
  },
  {
    method: "GET",
    pattern: /^\/api\/reports$/,
    handler: (s, _b, _m, url) =>
      s.listReports(numParam(url, "curveId")),
  },
  {
    method: "GET",
    pattern: /^\/api\/reports\/(\d+)$/,
    handler: (s, _b, m) => s.getReport(Number(m[1])),
  },
];

function numParam(url: URL, key: string): number | undefined {
  const v = url.searchParams.get(key);
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(new ServiceError("请求体不是合法 JSON", 400));
      }
    });
    req.on("error", reject);
  });
}

export function createApp(store: Store) {
  const svc = new NurbsService(store);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api")) {
        return sendJson(res, 200, {
          service: "nurbs-backend",
          endpoints: routes.map((r) => `${r.method} ${r.pattern.source.replace(/[\\^$()\\d+]/g, "")}`),
        });
      }
      const route = routes.find(
        (r) => r.method === req.method && r.pattern.test(url.pathname),
      );
      if (!route) return sendJson(res, 404, { error: "未找到对应路由", path: url.pathname });

      const body = req.method === "POST" ? await readBody(req) : {};
      const match = route.pattern.exec(url.pathname)!;
      const result = route.handler(svc, body, match, url);
      if (route.raw) {
        const fmt = (url.searchParams.get("format") as string) ?? "json";
        res.writeHead(200, {
          "Content-Type": fmt === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        });
        return res.end(String(result));
      }
      return sendJson(res, 200, result);
    } catch (e) {
      if (e instanceof ServiceError) {
        return sendJson(res, e.status, { error: e.message, fields: e.fields });
      }
      return sendJson(res, 500, { error: (e as Error).message });
    }
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

if (require.main === module) {
  const cfg = resolveConfig();
  const store = new Store(cfg.dataDir);
  const server = createApp(store);
  server.listen(cfg.port, () => {
    console.log(`NURBS 后端已启动`);
    console.log(`  端口:   ${cfg.port} (环境变量 PORT / NURBS_PORT 可改)`);
    console.log(`  数据目录: ${cfg.dataDir} (环境变量 NURBS_DATA_DIR 可改)`);
  });
}
