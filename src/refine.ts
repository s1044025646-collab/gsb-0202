import { basisTable } from "./basis";
import { evalSide, evaluate, toHomogeneous } from "./eval";
import { independentSamples, maxAbsDiff } from "./numeric";
import {
  CurveDef,
  RefinementResult,
  ShapeVerification,
  StructureComparison,
  ValidationError,
} from "./types";
import { parameterDomain } from "./validate";

/** 单点插入前的合法性检查（不产生半成品） */
export function checkInsert(curve: CurveDef, u: number): ValidationError | null {
  const [umin, umax] = parameterDomain(curve.knots);
  if (!Number.isFinite(u)) return { field: "u", message: "插入节点必须是有限数", value: u };
  if (u <= umin || u >= umax) {
    return {
      field: "u",
      message: `只能在开参数区间 (${umin}, ${umax}) 内插入节点`,
      value: u,
    };
  }
  let mult = 0;
  for (const k of curve.knots) if (k === u) mult++;
  if (mult >= curve.degree) {
    return {
      field: "u",
      message: `节点 ${u} 当前重数为 ${mult}，已达允许上限（次数 ${curve.degree}），拒绝再次插入`,
      value: u,
    };
  }
  return null;
}

/**
 * 单节点插入（Piegl & Tiller Algorithm A5.1 的直接版本）。
 * 返回新的曲线定义（控制点、权重、节点向量），几何与参数化不变。
 */
export function insertKnot(curve: CurveDef, u: number): CurveDef {
  const err = checkInsert(curve, u);
  if (err) throw new Error(`${err.field}: ${err.message}`);

  const p = curve.degree;
  const Pw = toHomogeneous(curve); // 齐次控制点
  const U = curve.knots;
  const n = Pw.length - 1;
  // s = u 的现有重数；span i：U[i] <= u < U[i+1]（跳过零长度区间）
  let s = 0;
  for (const kv of U) if (kv === u) s++;
  let i = p;
  for (let j = p; j <= n; j++) {
    if (U[j] <= u && u < U[j + 1] && U[j] !== U[j + 1]) i = j;
  }

  // 新控制点 Q：索引 0..i-p 不变；i-s+1..n+1 来自旧 i-s+1..n；
  // 中间 i-p+1..i-s 由 alpha 插值生成。
  const Qw: number[][] = new Array(n + 2);
  for (let j = 0; j <= i - p; j++) Qw[j] = Pw[j].slice();
  for (let j = i - s; j <= n; j++) Qw[j + 1] = Pw[j].slice();
  for (let j = 1; j <= p - s; j++) {
    const idx = i - p + j;
    const denom = U[i + j] - U[i - p + j];
    const alpha = (u - U[i - p + j]) / denom;
    Qw[idx] = Pw[idx].map(
      (a, d) => alpha * a + (1 - alpha) * Pw[idx - 1][d],
    );
  }

  // 新节点向量：U[0..i] + u + U[i+1..end]
  const Ubar: number[] = new Array(U.length + 1);
  for (let j = 0; j <= i; j++) Ubar[j] = U[j];
  Ubar[i + 1] = u;
  for (let j = i + 1; j < U.length; j++) Ubar[j + 1] = U[j];

  const hdim = Pw[0].length;
  const newCp: number[][] = [];
  const newW: number[] = [];
  for (const q of Qw) {
    const w = q[hdim - 1];
    newW.push(w);
    newCp.push(q.slice(0, hdim - 1).map((x) => x / w));
  }

  return {
    name: curve.name,
    degree: p,
    controlPoints: newCp,
    weights: newW,
    knots: Ubar,
  };
}

/**
 * 批量插入。先逐步预演校验所有插入，任一步非法则整体拒绝
 * （不留下半个新版本）；全部合法后一次性产出最终曲线。
 */
export function insertKnots(curve: CurveDef, us: number[]): {
  curve: CurveDef;
  inserted: number[];
  error: ValidationError | null;
  failedStep: number;
} {
  let work = cloneCurve(curve);
  const inserted: number[] = [];
  for (let step = 0; step < us.length; step++) {
    const u = us[step];
    const err = checkInsert(work, u);
    if (err) {
      return { curve, inserted, error: err, failedStep: step };
    }
    work = insertKnot(work, u);
    inserted.push(u);
  }
  return { curve: work, inserted, error: null, failedStep: -1 };
}

export function cloneCurve(c: CurveDef): CurveDef {
  return {
    name: c.name,
    degree: c.degree,
    controlPoints: c.controlPoints.map((p) => p.slice()),
    weights: c.weights.slice(),
    knots: c.knots.slice(),
  };
}

/**
 * 保形核验：在【独立采样点】（刻意避开两条曲线的全部节点）上
 * 比较点与（可微处的）导数。绝不只比较新增节点处的值。
 */
export function verifyShape(
  before: CurveDef,
  after: CurveDef,
  sampleCount = 64,
  pointTol = 1e-9,
  derivativeTol = 1e-7,
): ShapeVerification {
  const [a, b] = parameterDomain(before.knots);
  const excluded = [...new Set([...before.knots, ...after.knots])];
  const samples = independentSamples(a, b, sampleCount, excluded);
  let maxPointError = 0;
  let maxDerivativeError = 0;
  let worstPointSampleU = samples[0] ?? a;
  let worstDerivativeSampleU = samples[0] ?? a;
  let nonDiff = 0;

  for (const u of samples) {
    // 采样点被构造为非节点，故两条曲线在该点均可微
    const s1 = evalSide(before, u, "right");
    const s2 = evalSide(after, u, "right");
    const pe = maxAbsDiff(s1.point, s2.point);
    const de = maxAbsDiff(s1.derivative, s2.derivative);
    if (pe > maxPointError) {
      maxPointError = pe;
      worstPointSampleU = u;
    }
    if (de > maxDerivativeError) {
      maxDerivativeError = de;
      worstDerivativeSampleU = u;
    }
    const e1 = evaluate(before, u);
    if (e1.differentiability !== "differentiable" && e1.differentiability !== "derivative-exists") {
      nonDiff++;
    }
  }
  return {
    sampleCount: samples.length,
    samplesExcludeKnots: true,
    maxPointError,
    maxDerivativeError,
    worstPointSampleU,
    worstDerivativeSampleU,
    nonDifferentiableSampleCount: nonDiff,
    passed: maxPointError <= pointTol && maxDerivativeError <= derivativeTol,
    pointTolerance: pointTol,
    derivativeTolerance: derivativeTol,
  };
}

export function buildComparison(
  before: CurveDef,
  after: CurveDef,
  inserted: number[],
): StructureComparison {
  return {
    before: {
      degree: before.degree,
      controlPointCount: before.controlPoints.length,
      weights: before.weights.slice(),
      knots: before.knots.slice(),
      controlPoints: before.controlPoints.map((p) => p.slice()),
    },
    after: {
      degree: after.degree,
      controlPointCount: after.controlPoints.length,
      weights: after.weights.slice(),
      knots: after.knots.slice(),
      controlPoints: after.controlPoints.map((p) => p.slice()),
    },
    insertedKnots: inserted.slice(),
    knotInvariant: true,
    degreeInvariant: before.degree === after.degree,
  };
}

/** 完整的细化流程（供服务层调用）：批量插入 + 核验 */
export function refine(
  before: CurveDef,
  us: number[],
): { result?: RefinementResult; error?: ValidationError; failedStep?: number } {
  const { curve: after, inserted, error, failedStep } = insertKnots(before, us);
  if (error) return { error, failedStep };
  const verification = verifyShape(before, after);
  return {
    result: {
      newVersion: 0,
      comparison: buildComparison(before, after, inserted),
      verification,
    },
  };
}

/** 仅供核验使用的基函数和（分区一致性自检） */
export function basisPartitionCheck(curve: CurveDef, u: number): number {
  const t = basisTable(curve.knots, curve.degree, u, "right");
  return t.values[curve.degree].reduce((s, x) => s + x, 0);
}
