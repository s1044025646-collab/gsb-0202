import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { ArcLengthResult, CurveDef, EvalResult, RefinementResult } from "./types";
import { cloneCurve } from "./refine";

export interface VersionRow {
  id: number;
  curveId: number;
  version: number;
  degree: number;
  dim: number;
  def: CurveDef;
  parentVersionId: number | null;
  note: string;
  createdAt: string;
}

export interface ReportRow {
  id: number;
  versionId: number;
  kind: "batch-eval" | "tangent" | "refinement" | "arc-length" | "compare";
  paramsJson: string;
  resultJson: string;
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, "nurbs.db");
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS curves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        curve_id INTEGER NOT NULL REFERENCES curves(id),
        version INTEGER NOT NULL,
        degree INTEGER NOT NULL,
        dim INTEGER NOT NULL,
        def_json TEXT NOT NULL,
        parent_version_id INTEGER REFERENCES versions(id),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(curve_id, version)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL REFERENCES versions(id),
        kind TEXT NOT NULL,
        params_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  createCurve(def: CurveDef, note = "导入"): VersionRow {
    const tx = this.db.prepare("INSERT INTO curves (name) VALUES (?)");
    const info = tx.run(def.name);
    const curveId = Number(info.lastInsertRowid);
    return this.addVersion(curveId, def, null, note);
  }

  addVersion(
    curveId: number,
    def: CurveDef,
    parentVersionId: number | null,
    note = "",
  ): VersionRow {
    const last = this.db
      .prepare("SELECT COALESCE(MAX(version),0) AS v FROM versions WHERE curve_id=?")
      .get(curveId) as { v: number };
    const version = last.v + 1;
    const dim = def.controlPoints[0].length;
    this.db
      .prepare(
        "INSERT INTO versions (curve_id, version, degree, dim, def_json, parent_version_id, note) VALUES (?,?,?,?,?,?,?)",
      )
      .run(curveId, version, def.degree, dim, JSON.stringify(def), parentVersionId, note);
    return this.getVersion(curveId, version)!;
  }

  getVersion(curveId: number, version: number): VersionRow | null {
    const row = this.db
      .prepare("SELECT * FROM versions WHERE curve_id=? AND version=?")
      .get(curveId, version) as
      | {
          id: number;
          curve_id: number;
          version: number;
          degree: number;
          dim: number;
          def_json: string;
          parent_version_id: number | null;
          note: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      curveId: row.curve_id,
      version: row.version,
      degree: row.degree,
      dim: row.dim,
      def: JSON.parse(row.def_json) as CurveDef,
      parentVersionId: row.parent_version_id,
      note: row.note,
      createdAt: row.created_at,
    };
  }

  listCurves(): { id: number; name: string; latestVersion: number; createdAt: string }[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.name, c.created_at, MAX(v.version) AS latest
         FROM curves c LEFT JOIN versions v ON v.curve_id = c.id
         GROUP BY c.id ORDER BY c.id`,
      )
      .all() as { id: number; name: string; created_at: string; latest: number | null }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      latestVersion: r.latest ?? 0,
      createdAt: r.created_at,
    }));
  }

  listVersions(curveId: number): VersionRow[] {
    const rows = this.db
      .prepare("SELECT id FROM versions WHERE curve_id=? ORDER BY version")
      .all(curveId) as { id: number }[];
    return rows
      .map((r) => this.getVersionById(r.id))
      .filter((x): x is VersionRow => x !== null);
  }

  getVersionById(versionId: number): VersionRow | null {
    const row = this.db.prepare("SELECT * FROM versions WHERE id=?").get(versionId) as
      | {
          id: number;
          curve_id: number;
          version: number;
          degree: number;
          dim: number;
          def_json: string;
          parent_version_id: number | null;
          note: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      curveId: row.curve_id,
      version: row.version,
      degree: row.degree,
      dim: row.dim,
      def: JSON.parse(row.def_json) as CurveDef,
      parentVersionId: row.parent_version_id,
      note: row.note,
      createdAt: row.created_at,
    };
  }

  /**
   * 事务性细化：在单个数据库事务内完成“校验 + 插入新版本 + 写报告”。
   * 任一步失败则 ROLLBACK，绝不留下半个新版本。
   */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  saveReport(
    versionId: number,
    kind: ReportRow["kind"],
    params: unknown,
    result: unknown,
  ): ReportRow {
    const info = this.db
      .prepare("INSERT INTO reports (version_id, kind, params_json, result_json) VALUES (?,?,?,?)")
      .run(versionId, kind, JSON.stringify(params), JSON.stringify(result));
    return this.getReport(Number(info.lastInsertRowid))!;
  }

  getReport(id: number): ReportRow | null {
    const row = this.db.prepare("SELECT * FROM reports WHERE id=?").get(id) as
      | {
          id: number;
          version_id: number;
          kind: ReportRow["kind"];
          params_json: string;
          result_json: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      versionId: row.version_id,
      kind: row.kind,
      paramsJson: row.params_json,
      resultJson: row.result_json,
      createdAt: row.created_at,
    };
  }

  listReports(curveId?: number): ReportRow[] {
    const rows = curveId
      ? (this.db
          .prepare(
            `SELECT r.id FROM reports r JOIN versions v ON r.version_id=v.id
             WHERE v.curve_id=? ORDER BY r.id`,
          )
          .all(curveId) as { id: number }[])
      : (this.db.prepare("SELECT id FROM reports ORDER BY id").all() as { id: number }[]);
    return rows.map((r) => this.getReport(r.id)!).filter(Boolean);
  }

  close() {
    this.db.close();
  }
}

export type FrozenResult = EvalResult[] | RefinementResult | ArcLengthResult;
export { cloneCurve };
