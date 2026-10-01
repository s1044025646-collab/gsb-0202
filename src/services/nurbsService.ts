import {
  ArcLengthResult,
  EvalResult,
  NurbsCurveData,
} from '../core/types.js';
import { validateCurve, paramDomain } from '../core/validation.js';
import { evaluate, tangent } from '../core/nurbs.js';
import { insertKnots, verifyShape } from '../core/insert.js';
import { arcLength } from '../core/arclength.js';
import { Store, CurveRecord } from '../storage/db.js';

export interface InsertResponse {
  reportId: number;
  parent: { id: number; version: number };
  newCurve: { id: number; version: number };
  insertedKnots: number[];
  controlPointCountBefore: number;
  controlPointCountAfter: number;
  verification: ReturnType<typeof insertKnots>['verification'];
}

export class NurbsService {
  constructor(readonly store: Store) {}

  importCurve(data: unknown, name?: string): CurveRecord {
    return this.store.insertCurve(data, name);
  }

  get(id: number): CurveRecord {
    const r = this.store.getCurve(id);
    if (!r) throw new Error(`曲线 id=${id} 不存在`);
    return r;
  }

  domain(id: number) {
    const rec = this.get(id);
    return {
      curveId: rec.id,
      version: rec.version,
      hash: rec.hash,
      degree: rec.data.degree,
      dimension: rec.data.controlPoints[0]!.length,
      controlPointCount: rec.data.controlPoints.length,
      ...paramDomain(rec.data),
    };
  }

  evaluate(id: number, u: number): { reportId: number; result: EvalResult } {
    const rec = this.get(id);
    const result = evaluate(rec.data, u);
    const reportId = this.store.saveReport(rec.id, 'eval', { u }, result);
    return { reportId, result };
  }

  batchEvaluate(
    id: number,
    us: number[],
  ): { reportId: number; results: EvalResult[] } {
    const rec = this.get(id);
    if (!Array.isArray(us) || us.length === 0) {
      throw new Error('参数列表 us 必须是非空数组');
    }
    const results = us.map((u) => evaluate(rec.data, u));
    const reportId = this.store.saveReport(
      rec.id,
      'batch-eval',
      { us },
      { results },
    );
    return { reportId, results };
  }

  tangent(id: number, u: number) {
    const rec = this.get(id);
    const result = tangent(rec.data, u);
    const reportId = this.store.saveReport(rec.id, 'eval', { u, tangent: true }, result);
    return { reportId, result };
  }

  /**
   * 节点细化：校验 + 插入在同一逻辑流程，
   * 仅当核验通过才冻结新版本；任何非法插入都抛错且不写新版本。
   */
  refine(
    id: number,
    knotsToInsert: number[],
    opts: { verifySamples?: number; tolerance?: number } = {},
  ): InsertResponse {
    const parent = this.get(id);
    const result = insertKnots(parent.data, knotsToInsert, opts);
    if (!result.verification.passed) {
      throw new Error(
        `保形核验失败：maxPointError=${result.verification.maxPointError}`,
      );
    }
    const newRec = this.store.insertVersion(parent.id, result.after);
    const reportId = this.store.saveReport(
      newRec.id,
      'insert',
      { parentId: parent.id, insertedKnots: result.insertedKnots },
      {
        insertedKnots: result.insertedKnots,
        before: {
          controlPointCount: result.before.controlPoints.length,
          knotCount: result.before.knots.length,
        },
        after: {
          controlPointCount: result.after.controlPoints.length,
          knotCount: result.after.knots.length,
        },
        verification: result.verification,
      },
    );
    return {
      reportId,
      parent: { id: parent.id, version: parent.version },
      newCurve: { id: newRec.id, version: newRec.version },
      insertedKnots: result.insertedKnots,
      controlPointCountBefore: result.before.controlPoints.length,
      controlPointCountAfter: result.after.controlPoints.length,
      verification: result.verification,
    };
  }

  arcLength(
    id: number,
    opts: {
      uStart?: number;
      uEnd?: number;
      tolerance?: number;
      maxSubdivisions?: number;
    } = {},
  ): { reportId: number; result: ArcLengthResult } {
    const rec = this.get(id);
    const result = arcLength(rec.data, opts);
    const reportId = this.store.saveReport(
      rec.id,
      'arclength',
      opts,
      result,
    );
    return { reportId, result };
  }

  /** 比较两个版本的结构与几何。 */
  compare(idA: number, idB: number) {
    const a = this.get(idA);
    const b = this.get(idB);
    // 直接复用独立采样核验（不插入），比较几何一致性
    const verification = verifyShape(a.data, b.data, 64, 1e-9);
    const payload = {
      a: {
        id: a.id,
        version: a.version,
        degree: a.data.degree,
        controlPointCount: a.data.controlPoints.length,
        knotCount: a.data.knots.length,
        hash: a.hash,
      },
      b: {
        id: b.id,
        version: b.version,
        degree: b.data.degree,
        controlPointCount: b.data.controlPoints.length,
        knotCount: b.data.knots.length,
        hash: b.hash,
      },
      geometricallyEquivalent: verification.passed,
      verification,
    };
    const reportId = this.store.saveReport(b.id, 'compare', { idA, idB }, payload);
    return { reportId, ...payload };
  }

  verify(id: number) {
    return this.store.verifyHash(id);
  }

  /** 仅做不落库的试算（供非法插入回滚演示使用）。 */
  tryRefineDryRun(data: NurbsCurveData, knotsToInsert: number[]) {
    return insertKnots(validateCurve(data), knotsToInsert);
  }
}
