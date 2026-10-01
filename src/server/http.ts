import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { NurbsService } from '../services/nurbsService.js';
import { ValidationError } from '../core/types.js';
import { evalResultsToCsv } from '../services/export.js';

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, rejectJson) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 5_000_000) rejectJson(new Error('请求体过大'));
    });
    req.on('end', () => {
      if (!body) return resolveJson({});
      try {
        resolveJson(JSON.parse(body));
      } catch (e) {
        rejectJson(new Error('JSON 解析失败: ' + (e as Error).message));
      }
    });
    req.on('error', rejectJson);
  });
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

export function createApp(service: NurbsService) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    try {
      // 健康检查
      if (method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true });
      }

      // 导入曲线
      if (method === 'POST' && path === '/curves') {
        const body = (await readJson(req)) as {
          curve?: unknown;
          name?: string;
        };
        const rec = service.importCurve(body.curve ?? body, body.name);
        return send(res, 201, {
          id: rec.id,
          version: rec.version,
          hash: rec.hash,
          domain: service.domain(rec.id),
        });
      }

      const curveMatch = path.match(/^\/curves\/(\d+)$/);
      if (method === 'GET' && curveMatch) {
        const rec = service.get(Number(curveMatch![1]));
        return send(res, 200, rec);
      }
      if (method === 'GET' && path === '/curves') {
        return send(res, 200, service.store.listCurves());
      }

      const domainMatch = path.match(/^\/curves\/(\d+)\/domain$/);
      if (method === 'GET' && domainMatch) {
        return send(res, 200, service.domain(Number(domainMatch![1])));
      }

      const verifyMatch = path.match(/^\/curves\/(\d+)\/verify$/);
      if (method === 'GET' && verifyMatch) {
        return send(res, 200, service.verify(Number(verifyMatch![1])));
      }

      const evalMatch = path.match(/^\/curves\/(\d+)\/evaluate$/);
      if (method === 'POST' && evalMatch) {
        const body = (await readJson(req)) as { u: number };
        const out = service.evaluate(Number(evalMatch![1]), body.u);
        return send(res, 200, out);
      }

      const batchMatch = path.match(/^\/curves\/(\d+)\/batch-evaluate$/);
      if (method === 'POST' && batchMatch) {
        const body = (await readJson(req)) as { us: number[]; format?: string };
        const out = service.batchEvaluate(Number(batchMatch![1]), body.us);
        if (body.format === 'csv') {
          res.writeHead(200, {
            'content-type': 'text/csv; charset=utf-8',
          });
          return res.end(evalResultsToCsv(out.results));
        }
        return send(res, 200, out);
      }

      const tangentMatch = path.match(/^\/curves\/(\d+)\/tangent$/);
      if (method === 'POST' && tangentMatch) {
        const body = (await readJson(req)) as { u: number };
        return send(
          res,
          200,
          service.tangent(Number(tangentMatch![1]), body.u),
        );
      }

      const refineMatch = path.match(/^\/curves\/(\d+)\/refine$/);
      if (method === 'POST' && refineMatch) {
        const body = (await readJson(req)) as {
          knots: number[];
          verifySamples?: number;
          tolerance?: number;
        };
        return send(
          res,
          200,
          service.refine(Number(refineMatch![1]), body.knots, {
            verifySamples: body.verifySamples,
            tolerance: body.tolerance,
          }),
        );
      }

      const arcMatch = path.match(/^\/curves\/(\d+)\/arc-length$/);
      if (method === 'POST' && arcMatch) {
        const body = (await readJson(req)) as Parameters<
          NurbsService['arcLength']
        >[1];
        return send(res, 200, service.arcLength(Number(arcMatch![1]), body));
      }

      const compareMatch = path.match(/^\/compare$/);
      if (method === 'POST' && compareMatch) {
        const body = (await readJson(req)) as { a: number; b: number };
        return send(res, 200, service.compare(body.a, body.b));
      }

      if (method === 'GET' && path === '/reports') {
        return send(res, 200, service.store.listReports(url.searchParams.get('kind') ?? undefined));
      }
      const reportMatch = path.match(/^\/reports\/(\d+)$/);
      if (method === 'GET' && reportMatch) {
        const r = service.store.getReport(Number(reportMatch![1]));
        if (!r) return send(res, 404, { error: '报告不存在' });
        return send(res, 200, r);
      }

      return send(res, 404, { error: `未找到路由 ${method} ${path}` });
    } catch (err) {
      if (err instanceof ValidationError) {
        const rejected = (err as unknown as { rejected?: unknown }).rejected;
        return send(res, 400, {
          error: err.message,
          field: err.field,
          rejected,
        });
      }
      return send(res, 400, { error: (err as Error).message });
    }
  });
}
