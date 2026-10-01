import {
  InsertionResult,
  NurbsCurveData,
  ShapeVerification,
  ValidationError,
  Vec,
} from './types.js';
import { knotMultiplicity, paramDomain } from './validation.js';
import { KNOT_EPS, evalRational } from './nurbs.js';

/**
 * 在允许重数内插入单个内部节点（Böhm 算法），返回新曲线。
 * 不改变几何形状与参数化。调用前需保证插入合法。
 */
export function insertKnotOnce(c: NurbsCurveData, u: number): NurbsCurveData {
  const p = c.degree;
  const knots = c.knots;
  const n = c.controlPoints.length - 1;

  // 定位 k：满足 knots[k] <= u < knots[k+1] 的最后一个下标。
  let k = p;
  for (let i = p; i <= n; i++) {
    if (u >= knots[i]! - KNOT_EPS && u < knots[i + 1]! - KNOT_EPS) k = i;
  }
  // 已有重数 s
  const s = knotMultiplicity(knots, u);

  const newKnots = [
    ...knots.slice(0, k + 1),
    u,
    ...knots.slice(k + 1),
  ];

  const dim = c.controlPoints[0]!.length;
  const toHom = (cp: Vec, w: number): Vec => {
    const h = new Array<number>(dim + 1);
    for (let j = 0; j < dim; j++) h[j] = cp[j]! * w;
    h[dim] = w;
    return h;
  };
  const fromHom = (h: Vec): { cp: Vec; w: number } => {
    const w = h[dim]!;
    const cp = new Array<number>(dim);
    for (let j = 0; j < dim; j++) cp[j] = h[j]! / w;
    return { cp, w };
  };

  // 齐次控制点
  const Pw = c.controlPoints.map((cp, i) => toHom(cp, c.weights[i]!));
  const Qw: Vec[] = new Array<Vec>(n + 2);

  // 不参与重算的两端
  for (let i = 0; i <= k - p; i++) Qw[i] = Pw[i]!.slice();
  for (let i = k - s; i <= n; i++) Qw[i + 1] = Pw[i]!.slice();

  for (let j = 1; j <= p - s - 1; j++) {
    const idx = k - p + j;
    const alpha =
      (u - knots[idx]!) / (knots[idx + p - j + 1]! - knots[idx]!);
    const a = Pw[idx]!;
    const b = Pw[idx + 1]!;
    const mix = new Array<number>(dim + 1);
    for (let d = 0; d <= dim; d++) mix[d] = (1 - alpha) * a[d]! + alpha * b[d]!;
    Qw[idx + 1] = mix;
  }

  const newControl: Vec[] = [];
  const newWeights: number[] = [];
  for (const h of Qw) {
    const { cp, w } = fromHom(h);
    newControl.push(cp);
    newWeights.push(w);
  }

  return {
    name: c.name,
    degree: p,
    controlPoints: newControl,
    weights: newWeights,
    knots: newKnots,
  };
}

/** 校验单个待插节点是否合法（区间 + 重数）。 */
export function checkInsertable(c: NurbsCurveData, u: number): string | null {
  const { uMin, uMax } = paramDomain(c);
  if (typeof u !== 'number' || !Number.isFinite(u)) return '节点必须是有限数字';
  if (u <= uMin + KNOT_EPS || u >= uMax - KNOT_EPS) {
    return `节点 ${u} 必须严格位于内部开区间 (${uMin}, ${uMax})，不能插入端点`;
  }
  const mult = knotMultiplicity(c.knots, u);
  if (mult >= c.degree) {
    return `节点 ${u} 当前重数 ${mult} 已达到允许上限（次数 ${c.degree}），不能再插入`;
  }
  return null;
}

/**
 * 批量插入节点（事务语义）。
 * 任一步非法则整体拒绝，不产生半成品版本。
 */
export function insertKnots(
  curve: NurbsCurveData,
  knotsToInsert: number[],
  options: { verifySamples?: number; tolerance?: number } = {},
): InsertionResult {
  const before = cloneCurve(curve);
  // 预检：对“最终”重数进行判定，保证批量顺序不影响合法性结论。
  const finalKnots = [...curve.knots];
  const rejected: { knot: number; reason: string }[] = [];

  // 先在模拟节点向量上顺序检查
  const sim = cloneCurve(curve);
  const applied: number[] = [];
  for (let i = 0; i < knotsToInsert.length; i++) {
    const u = knotsToInsert[i]!;
    const reason = checkInsertable(sim, u);
    if (reason) {
      rejected.push({ knot: u, reason });
    } else {
      const next = insertKnotOnce(sim, u);
      sim.knots = next.knots;
      sim.controlPoints = next.controlPoints;
      sim.weights = next.weights;
      applied.push(u);
    }
  }
  void finalKnots;

  if (rejected.length > 0) {
    const err = new ValidationError(
      'knotsToInsert',
      `存在 ${rejected.length} 个非法插入，整个批量操作已回滚，未生成新版本。首个原因：${rejected[0]!.reason}`,
    );
    (err as unknown as { rejected: unknown }).rejected = rejected;
    throw err;
  }

  const verification = verifyShape(
    before,
    sim,
    options.verifySamples ?? 64,
    options.tolerance ?? 1e-9,
  );

  return {
    before,
    after: sim,
    insertedKnots: applied,
    verification,
  };
}

function cloneCurve(c: NurbsCurveData): NurbsCurveData {
  return {
    name: c.name,
    degree: c.degree,
    controlPoints: c.controlPoints.map((p) => p.slice()),
    weights: c.weights.slice(),
    knots: c.knots.slice(),
  };
}

/**
 * 在独立采样点核验两条曲线几何与参数化一致。
 * 关键点：采样点故意避开所有被插入节点（否则只比较节点处是不够的）。
 */
export function verifyShape(
  a: NurbsCurveData,
  b: NurbsCurveData,
  sampleCount: number,
  tolerance: number,
): ShapeVerification {
  const { uMin, uMax } = paramDomain(a);
  const avoid = new Set<string>();
  // b 相比 a 新增的内部节点都要避开
  const bSorted = [...b.knots].sort((x, y) => x - y);
  for (const k of bSorted) {
    if (k > uMin + KNOT_EPS && k < uMax - KNOT_EPS) avoid.add(k.toFixed(12));
  }

  // 黄金比例错位采样，再剔除落在被插节点上的点
  const phi = 0.6180339887498949;
  const us: number[] = [];
  let attempts = 0;
  while (us.length < sampleCount && attempts < sampleCount * 20) {
    const t = ((us.length + 1) * phi) % 1;
    const u = uMin + t * (uMax - uMin);
    attempts++;
    if (!avoid.has(u.toFixed(12))) us.push(u);
  }
  // 兜底：均匀补充
  let gi = 1;
  while (us.length < sampleCount) {
    const u = uMin + (gi / (sampleCount + 1)) * (uMax - uMin);
    gi++;
    if (!avoid.has(u.toFixed(12))) us.push(u);
  }

  let maxPointError = 0;
  let maxDerivativeError = 0;
  let worstU = us[0]!;
  for (const u of us) {
    // 两侧导数都比较（存在不可微点时取同侧）
    for (const side of [-1, 1] as const) {
      const ra = evalRational(a, u, side);
      const rb = evalRational(b, u, side);
      const pe = vecDist(ra.point, rb.point);
      const de = vecDist(ra.derivative, rb.derivative);
      if (pe > maxPointError) {
        maxPointError = pe;
        worstU = u;
      }
      if (de > maxDerivativeError) maxDerivativeError = de;
    }
  }

  const passed =
    maxPointError <= tolerance && maxDerivativeError <= tolerance * 1e2;
  return {
    sampleCount: us.length,
    strategy:
      '黄金比例错位独立采样，显式避开所有被插入节点；同时比较左右单侧导数',
    maxPointError,
    maxDerivativeError,
    worstU,
    passed,
    tolerance,
  };
}

function vecDist(a: Vec, b: Vec): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}
