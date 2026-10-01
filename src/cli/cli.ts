#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../storage/db.js';
import { NurbsService } from '../services/nurbsService.js';
import { loadConfig } from '../server/config.js';
import {
  curveToCsv,
  curveToJson,
  evalResultsToCsv,
} from '../services/export.js';
import {
  makeQuarterCircle,
  makeLine,
  makeParabola,
  makeRepeatedKnot,
} from '../core/presets.js';
import { ValidationError } from '../core/types.js';

type Flags = Record<string, string | boolean>;

function parseArgs(argv: string[]): {
  cmd: string;
  flags: Flags;
} {
  const flags: Flags = {};
  const [cmd = 'help', ...rest] = argv;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return { cmd, flags };
}

function num(v: string | boolean | undefined, name: string): number {
  const n = Number(v);
  if (typeof v !== 'string' || !Number.isFinite(n)) {
    throw new Error('参数 --' + name + ' 必须是数字，收到 ' + String(v));
  }
  return n;
}

function numList(v: string | boolean | undefined, name: string): number[] {
  if (typeof v !== 'string') {
    throw new Error('--' + name + ' 必须是逗号分隔数字');
  }
  return v.split(',').map((s, i) => {
    const n = Number(s.trim());
    if (!Number.isFinite(n)) throw new Error('--' + name + '[' + i + '] 非法: ' + s);
    return n;
  });
}

function output(content: string, out?: string | boolean): void {
  if (typeof out === 'string') {
    writeFileSync(resolve(out), content, 'utf-8');
    console.error('已写入 ' + out);
  } else {
    console.log(content);
  }
}

const HELP = [
  'nurbs — 本地 NURBS 求值与节点细化 CLI',
  '',
  '用法: npm run cli -- <命令> [参数]',
  '',
  '曲线管理:',
  '  import --file curve.json [--name 名称]',
  '  list',
  '  get --id <id> [--format json|csv]',
  '  domain --id <id>',
  '  verify --id <id>',
  '',
  '计算:',
  '  eval --id <id> --u <u>',
  '  batch --id <id> --us 0,0.25,0.5 [--format json|csv]',
  '  tangent --id <id> --u <u>',
  '  refine --id <id> --knots 0.25,0.5 [--tolerance 1e-9] [--samples 64]',
  '  arclength --id <id> [--u-start 0] [--u-end 1] [--tolerance 1e-7] [--max-subdivisions 100000]',
  '  compare --a <id> --b <id>',
  '',
  '报告:',
  '  reports [--kind insert]',
  '  report --id <reportId>',
  '',
  '预设:',
  '  preset --name quarter-circle|line|parabola|repeated-knot',
  '',
  '环境变量: PORT / NURBS_PORT, NURBS_DATA_DIR',
].join('\n');

function main(): void {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const store = new Store(config.dbPath);
  const service = new NurbsService(store);

  try {
    switch (cmd) {
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP);
        break;

      case 'import': {
        const file = String(flags.file ?? '');
        const json = JSON.parse(readFileSync(resolve(file), 'utf-8'));
        const rec = service.importCurve(
          json,
          flags.name ? String(flags.name) : undefined,
        );
        output(
          JSON.stringify(
            { id: rec.id, version: rec.version, hash: rec.hash, domain: service.domain(rec.id) },
            null,
            2,
          ),
          flags.out,
        );
        break;
      }

      case 'list':
        output(JSON.stringify(service.store.listCurves(), null, 2), flags.out);
        break;

      case 'get': {
        const rec = service.get(num(flags.id, 'id'));
        const fmt = String(flags.format ?? 'json');
        output(
          fmt === 'csv' ? curveToCsv(rec.data) : curveToJson(rec.data),
          flags.out,
        );
        break;
      }

      case 'domain':
        output(JSON.stringify(service.domain(num(flags.id, 'id')), null, 2), flags.out);
        break;

      case 'verify':
        output(JSON.stringify(service.verify(num(flags.id, 'id')), null, 2), flags.out);
        break;

      case 'eval':
        output(
          JSON.stringify(service.evaluate(num(flags.id, 'id'), num(flags.u, 'u')), null, 2),
          flags.out,
        );
        break;

      case 'batch': {
        const out = service.batchEvaluate(
          num(flags.id, 'id'),
          numList(flags.us, 'us'),
        );
        const fmt = String(flags.format ?? 'json');
        output(
          fmt === 'csv' ? evalResultsToCsv(out.results) : JSON.stringify(out, null, 2),
          flags.out,
        );
        break;
      }

      case 'tangent':
        output(
          JSON.stringify(
            service.tangent(num(flags.id, 'id'), num(flags.u, 'u')),
            null,
            2,
          ),
          flags.out,
        );
        break;

      case 'refine': {
        const out = service.refine(num(flags.id, 'id'), numList(flags.knots, 'knots'), {
          tolerance: flags.tolerance ? num(flags.tolerance, 'tolerance') : undefined,
          verifySamples: flags.samples ? num(flags.samples, 'samples') : undefined,
        });
        output(JSON.stringify(out, null, 2), flags.out);
        break;
      }

      case 'arclength': {
        const out = service.arcLength(num(flags.id, 'id'), {
          uStart:
            flags['u-start'] !== undefined
              ? num(flags['u-start'], 'u-start')
              : undefined,
          uEnd: flags['u-end'] !== undefined ? num(flags['u-end'], 'u-end') : undefined,
          tolerance: flags.tolerance ? num(flags.tolerance, 'tolerance') : undefined,
          maxSubdivisions: flags['max-subdivisions']
            ? num(flags['max-subdivisions'], 'max-subdivisions')
            : undefined,
        });
        output(JSON.stringify(out, null, 2), flags.out);
        break;
      }

      case 'compare':
        output(
          JSON.stringify(
            service.compare(num(flags.a, 'a'), num(flags.b, 'b')),
            null,
            2,
          ),
          flags.out,
        );
        break;

      case 'reports':
        output(
          JSON.stringify(
            service.store.listReports(
              typeof flags.kind === 'string' ? flags.kind : undefined,
            ),
            null,
            2,
          ),
          flags.out,
        );
        break;

      case 'report': {
        const r = service.store.getReport(num(flags.id, 'id'));
        if (!r) throw new Error('报告不存在');
        output(
          JSON.stringify(
            {
              ...r,
              params: JSON.parse(r.params_json),
              result: JSON.parse(r.result_json),
            },
            null,
            2,
          ),
          flags.out,
        );
        break;
      }

      case 'preset': {
        const name = String(flags.name ?? '');
        const map = {
          'quarter-circle': makeQuarterCircle,
          line: makeLine,
          parabola: makeParabola,
          'repeated-knot': makeRepeatedKnot,
        } as const;
        const fn = map[name as keyof typeof map];
        if (!fn) throw new Error('未知预设 ' + name);
        output(JSON.stringify(fn(), null, 2), flags.out);
        break;
      }

      default:
        console.log(HELP);
        process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error('校验失败 [' + err.field + '] ' + err.message);
    } else {
      console.error('错误: ' + (err as Error).message);
    }
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

main();
