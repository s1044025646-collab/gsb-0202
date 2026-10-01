import { arcLength, ArcLengthOptions } from "./arclength";
import { Store, VersionRow } from "./db";
import { evaluate } from "./eval";
import { tangent } from "./eval";
import {
  basisPartitionCheck,
  buildComparison,
  cloneCurve,
  insertKnots,
  verifyShape,
} from "./refine";
import {
  ArcLengthResult,
  CurveDef,
  EvalResult,
  MAX_CONTROL_POINTS,
  MAX_DEGREE,
  MIN_DEGREE,
  RefinementResult,
  ValidationError,
} from "./types";
import { validateCurveDef, parameterDomain } from "./validate";

export class ServiceError extends Error {
  status: number;
  fields?: ValidationError[];
  constructor(message: string, status = 400, fields?: ValidationError[]) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export class NurbsService {
  constructor(private store: Store) {}

 constants() {
    return {
      minDegree: MIN_DEGREE,
      maxDegree: MAX_DEGREE,
      maxControlPoints: MAX_CONTROL_POINTS,
    };
  }

  importCurve(input: unknown): VersionRow {
    const v = validateCurveDef(input);
    if (!v.ok || !v.value) {
      throw new ServiceError("曲线定义非法", 422, v.errors);
    }
    return this.store.createCurve(v.value);
  }

  requireVersion(curveId: number, version?: number): VersionRow {
    const ver =
      version === undefined
        ? this.store.listVersions(curveId).at(-1)
        : this.store.getVersion(curveId, version);
    if (!ver) throw new ServiceError(`曲线/版本不存在: curveId=${curveId} version=${version ?? "latest"}`, 404);
    return ver;
  }

  metadata(curveId: number, version?: number) {
    const ver = this.requireVersion(curveId, version);
    const [umin, umax] = parameterDomain(ver.def.knots);
    return {
      curveId,
      version: ver.version,
      degree: ver.def.degree,
      dimension: ver.def.controlPoints[0].length,
      controlPointCount: ver.def.controlPoints.length,
      parameterDomain: { min: umin, max: umax },
      maxControlPoints: MAX_CONTROL_POINTS,
      weights: ver.def.weights,
      knots: ver.def.knots,
      controlPoints: ver.def.controlPoints,
      basisPartitionSample: basisPartitionCheck(ver.def, (umin + umax) / 2),
      note: ver.note,
      createdAt: ver.createdAt,
    };
  }

  batchEvaluate(curveId: number, us: number[], version?: number, save = true) {
    const ver = this.requireVersion(curveId, version);
    const results: EvalResult[] = us.map((u) => {
      const r = evaluate(ver.def, u);
      r.curveId = curveId;
      r.version = ver.version;
      return r;
    });
    let reportId: number | null = null;
    if (save) {
      const rep = this.store.saveReport(ver.id, "batch-eval", { us, version: ver.version }, results);
      reportId = rep.id;
    }
    return { curveId, version: ver.version, reportId, results };
  }

  tangentQuery(curveId: number, u: number, side: "left" | "right" = "right", version?: number) {
    const ver = this.requireVersion(curveId, version);
    const result = tangent(ver.def, u, side);
    const rep = this.store.saveReport(ver.id, "tangent", { u, side, version: ver.version }, result);
    return { curveId, version: ver.version, reportId: rep.id, ...result };
  }

  /**
   * 事务性节点细化：预演 -> 事务内插入新版本 + 核验 + 写报告。
   * 预演非法或事务失败都不会产生新版本。
   */
  refine(curveId: number, us: number[], version?: number): {
    newVersion: number;
    reportId: number;
    result: RefinementResult;
  } {
    const ver = this.requireVersion(curveId, version);
    // 预演（事务外），尽早拒绝
    const attempt = insertKnots(ver.def, us);
    if (attempt.error) {
      throw new ServiceError(
        `节点插入在第 ${attempt.failedStep} 步被拒绝：${attempt.error.message}`,
        422,
        [attempt.error],
      );
    }
    const before = cloneCurve(ver.def);
    const after = attempt.curve;
    return this.store.transaction(() => {
      const newVer = this.store.addVersion(curveId, after, ver.id, `节点细化: ${JSON.stringify(us)}`);
      const verification = verifyShape(before, after);
      const result: RefinementResult = {
        newVersion: newVer.version,
        comparison: buildComparison(before, after, attempt.inserted),
        verification,
      };
      const rep = this.store.saveReport(newVer.id, "refinement", { us, fromVersion: ver.version }, result);
      return { newVersion: newVer.version, reportId: rep.id, result };
    });
  }

  arcLength(curveId: number, options: ArcLengthOptions & { version?: number } = {}) {
    const { version, ...opts } = options;
    const ver = this.requireVersion(curveId, version);
    const result: ArcLengthResult = arcLength(ver.def, opts);
    result.curveId = curveId;
    result.version = ver.version;
    const rep = this.store.saveReport(
      ver.id,
      "arc-length",
      { ...opts, version: ver.version },
      result,
    );
    return { reportId: rep.id, ...result };
  }

  compareVersions(curveId: number, v1: number, v2: number) {
    const a = this.requireVersion(curveId, v1);
    const b = this.requireVersion(curveId, v2);
    const verification = verifyShape(a.def, b.def);
    const payload = {
      curveId,
      versions: [v1, v2],
      comparison: buildComparison(a.def, b.def, []),
      verification,
    };
    const rep = this.store.saveReport(b.id, "compare", { v1, v2 }, payload);
    return { reportId: rep.id, ...payload };
  }

  getReport(id: number) {
    const r = this.store.getReport(id);
    if (!r) throw new ServiceError(`报告不存在: ${id}`, 404);
    return {
      id: r.id,
      versionId: r.versionId,
      kind: r.kind,
      params: JSON.parse(r.paramsJson),
      result: JSON.parse(r.resultJson),
      createdAt: r.createdAt,
    };
  }

  listCurves() {
    return this.store.listCurves();
  }

  listVersions(curveId: number) {
    return this.store.listVersions(curveId).map((v) => ({
      version: v.version,
      degree: v.degree,
      dimension: v.dim,
      controlPointCount: v.def.controlPoints.length,
      parentVersionId: v.parentVersionId,
      note: v.note,
      createdAt: v.createdAt,
    }));
  }

  listReports(curveId?: number) {
    return this.store.listReports(curveId).map((r) => ({
      id: r.id,
      versionId: r.versionId,
      kind: r.kind,
      createdAt: r.createdAt,
    }));
  }

  exportCurve(curveId: number, version: number | undefined, format: "json" | "csv"): string {
    const ver = this.requireVersion(curveId, version);
    const def: CurveDef = ver.def;
    if (format === "json") {
      return JSON.stringify(
        {
          curveId,
          version: ver.version,
          degree: def.degree,
          dimension: def.controlPoints[0].length,
          parameterDomain: parameterDomain(def.knots),
          controlPoints: def.controlPoints,
          weights: def.weights,
          knots: def.knots,
        },
        null,
        2,
      );
    }
    const dim = def.controlPoints[0].length;
    const header =
      dim === 2
        ? "index,x,y,weight,knot"
        : "index,x,y,z,weight,knot";
    const lines = [header];
    const n = Math.max(def.controlPoints.length, def.knots.length);
    for (let i = 0; i < n; i++) {
      const cp = def.controlPoints[i] ?? [];
      const w = def.weights[i] ?? "";
      const k = def.knots[i] ?? "";
      const coords = dim === 2
        ? [cp[0] ?? "", cp[1] ?? ""]
        : [cp[0] ?? "", cp[1] ?? "", cp[2] ?? ""];
      lines.push([i, ...coords, w, k].join(","));
    }
    return lines.join("\n");
  }
}
