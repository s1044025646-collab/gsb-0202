import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ArcLengthResult,
  EvalResult,
  InsertionResult,
  NurbsCurveData,
} from '../core/types.js';
import { validateCurve } from '../core/validation.js';

/** 对曲线定义计算内容哈希，用于冻结后复核。 */
export function curveHash(c: NurbsCurveData): string {
  const canonical = JSON.stringify({
    degree: c.degree,
    controlPoints: c.controlPoints,
    weights: c.weights,
    knots: c.knots,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface CurveRecord {
  id: number;
  name: string | null;
  version: number;
  parent_id: number | null;
  data: NurbsCurveData;
  hash: string;
  created_at: string;
}

export interface ReportRecord {
  id: number;
  curve_id: number | null;
  kind: 'eval' | 'batch-eval' | 'insert' | 'arclength' | 'compare';
  params_json: string;
  result_json: string;
  created_at: string;
}

export class Store {
  db: DatabaseSync;

  constructor(dbPath: string) {
    const abs = resolve(dbPath);
    mkdirSync(dirname(abs), { recursive: true });
    this.db = new DatabaseSync(abs);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS curves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        version INTEGER NOT NULL,
        parent_id INTEGER REFERENCES curves(id),
        data_json TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        curve_id INTEGER REFERENCES curves(id),
        kind TEXT NOT NULL,
        params_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /** 导入（冻结）一条曲线，version=1。 */
  insertCurve(
    data: unknown,
    name?: string,
  ): CurveRecord {
    const valid = validateCurve(data);
    return this.doInsert(valid, name ?? valid.name ?? null, null);
  }

  /** 基于父曲线冻结新版本（节点细化产物）。事务内完成。 */
  insertVersion(
    parentId: number,
    data: NurbsCurveData,
  ): CurveRecord {
    const parent = this.getCurve(parentId);
    if (!parent) throw new Error(`父曲线 id=${parentId} 不存在`);
    const valid = validateCurve(data);
    return this.doInsert(valid, parent.name, parent.id);
  }

  private doInsert(
    valid: NurbsCurveData,
    name: string | null,
    parentId: number | null,
  ): CurveRecord {
    const hash = curveHash(valid);
    const version =
      parentId === null
        ? 1
        : ((this.db
            .prepare('SELECT COALESCE(MAX(version),0)+1 AS v FROM curves WHERE parent_id = ? OR id = ?')
            .get(parentId, parentId) as { v: number }).v);
    const info = this.db
      .prepare(
        `INSERT INTO curves (name, version, parent_id, data_json, hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(name, version, parentId, JSON.stringify(valid), hash);
    return this.getCurve(Number(info.lastInsertRowid))!;
  }

  getCurve(id: number): CurveRecord | null {
    const row = this.db
      .prepare('SELECT * FROM curves WHERE id = ?')
      .get(id) as
      | {
          id: number; name: string | null; version: number;
          parent_id: number | null; data_json: string; hash: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      parent_id: row.parent_id,
      data: JSON.parse(row.data_json) as NurbsCurveData,
      hash: row.hash,
      created_at: row.created_at,
    };
  }

  listCurves(): CurveRecord[] {
    const rows = this.db
      .prepare('SELECT id FROM curves ORDER BY id')
      .all() as { id: number }[];
    return rows.map((r) => this.getCurve(r.id)!).filter(Boolean);
  }

  /** 复核：当前存储内容哈希是否与冻结时一致。 */
  verifyHash(id: number): { ok: boolean; stored: string; current: string } {
    const rec = this.getCurve(id);
    if (!rec) throw new Error(`曲线 id=${id} 不存在`);
    return {
      ok: rec.hash === curveHash(rec.data),
      stored: rec.hash,
      current: curveHash(rec.data),
    };
  }

  saveReport(
    curveId: number | null,
    kind: ReportRecord['kind'],
    params: unknown,
    result: unknown,
  ): number {
    const cid: number | null = curveId;
    const info = this.db
      .prepare(
        `INSERT INTO reports (curve_id, kind, params_json, result_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        cid,
        kind,
        JSON.stringify(params),
        JSON.stringify(result),
      );
    return Number(info.lastInsertRowid);
  }

  getReport(id: number): ReportRecord | null {
    const row = this.db
      .prepare('SELECT * FROM reports WHERE id = ?')
      .get(id) as
      | {
          id: number; curve_id: number | null; kind: ReportRecord['kind'];
          params_json: string; result_json: string; created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      curve_id: row.curve_id,
      kind: row.kind,
      params_json: row.params_json,
      result_json: row.result_json,
      created_at: row.created_at,
    };
  }

 listReports(kind?: string): ReportRecord[] {
    const rows = kind
      ? (this.db
          .prepare('SELECT id FROM reports WHERE kind = ? ORDER BY id')
          .all(kind) as { id: number }[])
      : (this.db
          .prepare('SELECT id FROM reports ORDER BY id')
          .all() as { id: number }[]);
    return rows.map((r) => this.getReport(r.id)!).filter(Boolean);
  }

  close(): void {
    this.db.close();
  }
}

export type { EvalResult, InsertionResult, ArcLengthResult };
