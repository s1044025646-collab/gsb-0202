import { EvalResult, NurbsCurveData, Vec } from './types.js';
import { knotMultiplicity, paramDomain } from './validation.js';

export const KNOT_EPS = 1e-12;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= KNOT_EPS;
}

/**
 * 找到满足 knots[i] <= u < knots[i+1] 的下标 i。
 * 右端点 u == uMax 时返回最后一个非退化区间起点。
 */
export function findSpan(c: NurbsCurveData, u: number): number {
  const { degree: p, knots } = c;
  const n = c.controlPoints.length - 1; // 最后一个控制点下标
  const uMax = knots[knots.length - 1]!;
  if (u >= uMax) return n; // 右端点
  // 二分
  let low = p;
  let high = n + 1;
  let mid = Math.floor((low + high) / 2);
  while (u < knots[mid]! || u >= knots[mid + 1]!) {
    if (u < knots[mid]!) high = mid;
    else low = mid;
    mid = Math.floor((low + high) / 2);
    if (high - low <= 1) {
      mid = low;
      break;
    }
  }
  return mid;
}

/**
 * 非零 B 样条基函数值 N_{i-p,p} ... N_{i,p}（Cox–de Boor 递推）。
 * 返回长度 p+1 的数组，键为相对偏移 0..p。
 */
export function basisFunctions(
  knots: number[],
  span: number,
  u: number,
  p: number,
): number[] {
  const N = new Array<number>(p + 1).fill(0);
  N[0] = 1;
  const left = new Array<number>(p + 1).fill(0);
  const right = new Array<number>(p + 1).fill(0);
  for (let j = 1; j <= p; j++) {
    left[j] = u - knots[span + 1 - j]!;
    right[j] = knots[span + j]! - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const temp = N[r]! / (right[r + 1]! + left[j - r]!);
      N[r] = saved + right[r + 1]! * temp;
      saved = left[j - r]! * temp;
    }
    N[j] = saved;
  }
  return N;
}

/** 向量运算辅助。 */
function zeros(dim: number): Vec {
  return new Array<number>(dim).fill(0);
}
function scaleAdd(acc: Vec, s: number, v: Vec): void {
  for (let k = 0; k < acc.length; k++) acc[k]! += s * v[k]!;
}

/**
 * 齐次坐标下的加权控制点 Pw_i = (w_i*x_i, w_i*y_i, [w_i*z_i], w_i)。
 */
function homogeneousPoints(c: NurbsCurveData): Vec[] {
  const dim = c.controlPoints[0]!.length;
  return c.controlPoints.map((p, i) => {
    const w = c.weights[i]!;
    const h = zeros(dim + 1);
    for (let k = 0; k < dim; k++) h[k] = w * p[k]!;
    h[dim] = w;
    return h;
  });
}

/**
 * 非有理 de Boor 算法，同时返回多项式曲线值 A(u) 与一阶导数 A'(u)。
 * 用于齐次坐标曲线 A，维度任意。
 * u 视为“趋近方向”：side=-1 表示从左侧趋近，+1 从右侧，0 表示常规内部值。
 */
function deBoorWithDerivative(
  degree: number,
  ctrl: Vec[],
  knots: number[],
  span: number,
  u: number,
): { point: Vec; derivative: Vec } {
  const p = degree;
  // 参与运算的控制点下标 span-p .. span
  const dim = ctrl[0]!.length;
  const d: Vec[] = [];
  for (let j = 0; j <= p; j++) {
    d[j] = (ctrl[span - p + j] ?? zeros(dim)).map((x) => x);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const idx = span - p + j;
      const kLeft = knots[idx + p - r + 1]!;
      const kRight = knots[idx]!;
      let alpha: number;
      const den = kLeft - kRight;
      if (den === 0) {
        // 零长度节点区间：对应控制点在该层不再随参数变化，
        // 按 de Boor 约定 alpha 取 0（结果唯一，与从哪一侧趋近无关于该层）。
        alpha = 0;
      } else {
        alpha = (u - kRight) / den;
      }
      const dj = d[j]!;
      const dm = d[j - 1]!;
      for (let k = 0; k < dim; k++) {
        dj[k] = (1 - alpha) * dm[k]! + alpha * dj[k]!;
      }
    }
  }
  const point = d[p]!;

  // 一阶导数：对降阶一次的控制多边形做 de Boor（阶数 p-1）。
  const Qfull: Vec[] = new Array<Vec>(ctrl.length);
  for (let j = 1; j <= p; j++) {
    const idx = span - p + j;
    const den = knots[idx + p]! - knots[idx]!;
    const q = zeros(dim);
    if (den === 0) {
      // 零长度区间：无有效差分；用零向量占位（见下方可微性判定，
      // 真正不可微时该结果不会作为可微导数对外暴露）。
      Q[j - 1] = q;
      continue;
    }
    const factor = p / den;
    for (let k = 0; k < dim; k++) {
      q[k] = factor * (ctrl[idx]![k]! - ctrl[idx - 1]![k]!);
    }
    Qfull[idx] = q;
  }
  for (let j = 1; j <= p; j++) {
    const idx = span - p + j;
    if (!Qfull[idx]) Qfull[idx] = zeros(dim);
  }
  let derivative: Vec;
  if (p === 1) {
    derivative = Qfull[span]!;
  } else {
    // 在阶数 p-1 上做 de Boor，使用同一 span 的算法。
    derivative = deBoorPointOnly(degree - 1, Qfull, knots, span, u);
  }
  return { point: point.map((x) => x), derivative };
}

/** 任意阶 de Boor 只求点（供导数降阶复用）。 */
function deBoorPointOnly(
  degree: number,
  ctrl: Vec[],
  knots: number[],
  span: number,
  u: number,
): Vec {
  const p = degree;
  const dim = ctrl[0]!.length;
  const d: Vec[] = [];
  for (let j = 0; j <= p; j++) {
    d[j] = ctrl[span - p + j]!.map((x) => x);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const idx = span - p + j;
      const den = knots[idx + p - r + 1]! - knots[idx]!;
      let alpha = 0;
      if (den !== 0) alpha = (u - knots[idx]!) / den;
      for (let k = 0; k < dim; k++) {
        d[j]![k] = (1 - alpha) * d[j - 1]![k]! + alpha * d[j]![k]!;
      }
    }
  }
  return d[p]!.map((x) => x);
}

export type Side = -1 | 0 | 1;

/**
 * 在指定趋近侧求值有理曲线。
 * 返回欧氏点 C(u) 与一阶导数 C'(u)（该侧极限）。
 */
export function evalRational(
  c: NurbsCurveData,
  uIn: number,
  side: Side = 0,
): { point: Vec; derivative: Vec } {
  const { uMin, uMax } = paramDomain(c);
  let u = uIn;
  // 端点对齐
  if (near(u, uMin)) u = uMin;
  if (near(u, uMax)) u = uMax;
  if (u < uMin - KNOT_EPS || u > uMax + KNOT_EPS) {
    throw new RangeError(`参数 ${uIn} 超出有效区间 [${uMin}, ${uMax}]`);
  }
  // 单侧趋近：在重节点处选择非退化区间中的 span。
  const span = findSpanSide(c, u, side);
  const Pw = homogeneousPoints(c);
  const { point: Aw, derivative: dAw } = deBoorWithDerivative(
    c.degree,
    Pw,
    c.knots,
    span,
    u,
  );
  const dim = c.controlPoints[0]!.length;
  const w = Aw[dim]!;
  const point: Vec = zeros(dim);
  for (let k = 0; k < dim; k++) point[k] = Aw[k]! / w;
  // C'(u) = (A'(u) - C(u) * w'(u)) / w
  const dw = dAw[dim]!;
  const derivative: Vec = zeros(dim);
  for (let k = 0; k < dim; k++) {
    derivative[k] = (dAw[k]! - point[k]! * dw) / w;
  }
  return { point, derivative };
}

/**
 * 与 findSpan 相同，但在 u 恰好落在内部节点上时按趋近方向选择 span：
 * side=+1（右侧）取该节点开始的区间，side=-1（左侧）取其结束的区间。
 */
function findSpanSide(c: NurbsCurveData, u: number, side: Side): number {
  const { degree: p, knots } = c;
  const n = c.controlPoints.length - 1;
  const uMax = knots[knots.length - 1]!;
  const uMin = knots[0]!;
  if (u >= uMax) return n;
  if (u <= uMin) return p;
  if (side === 0) return findSpan(c, u);
  if (side === 1) {
    // 找到第一个 knots[i] == u 且 knots[i+1] > u 的 i
    for (let i = p; i <= n; i++) {
      if (near(knots[i]!, u) && knots[i + 1]! > u + KNOT_EPS) return i;
      if (knots[i]! > u + KNOT_EPS) break;
    }
    return findSpan(c, u);
  } else {
    // 左侧：knots[i] < u 且 knots[i+1] == u
    for (let i = n; i >= p; i--) {
      if (near(knots[i + 1]!, u) && knots[i]! < u - KNOT_EPS) return i;
    }
    return findSpan(c, u);
  }
}

/**
 * 判断 u 是否为不可微点。
 * 规则：内部节点重数等于次数 p 时，曲线在该点 C1 不连续（不可微），
 * 返回左右导数；否则（含内部无节点、重数<p）可微。
 */
export function evaluate(c: NurbsCurveData, uIn: number): EvalResult {
  const { uMin, uMax } = paramDomain(c);
  const u = Math.min(Math.max(uIn, uMin), uMax);

  if (near(u, uMin)) {
    const r = evalRational(c, uMin, 1);
    return {
      u: uMin,
      point: r.point,
      derivative: r.derivative,
      differentiability: 'left-endpoint-right-derivative',
      rightDerivative: r.derivative,
    };
  }
  if (near(u, uMax)) {
    const l = evalRational(c, uMax, -1);
    return {
      u: uMax,
      point: l.point,
      derivative: l.derivative,
      differentiability: 'right-endpoint-left-derivative',
      leftDerivative: l.derivative,
    };
  }

  const mult = knotMultiplicity(c.knots, u);
  const isInternalKnot = mult > 0 && u > uMin + KNOT_EPS && u < uMax - KNOT_EPS;
  if (isInternalKnot && mult >= c.degree) {
    const left = evalRational(c, u, -1);
    const right = evalRational(c, u, 1);
    return {
      u,
      point: left.point,
      derivative: null,
      differentiability: 'non-differentiable-repeated-knot',
      leftDerivative: left.derivative,
      rightDerivative: right.derivative,
    };
  }

  const r = evalRational(c, u, 0);
  return {
    u,
    point: r.point,
    derivative: r.derivative,
    differentiability: 'differentiable',
  };
}

/** 单位切向（可微时），不可微返回 null。 */
export function tangent(c: NurbsCurveData, u: number): {
  u: number;
  point: Vec;
  tangent: Vec | null;
  differentiability: EvalResult['differentiability'];
  leftTangent?: Vec;
  rightTangent?: Vec;
} {
  const e = evaluate(c, u);
  const norm = (v: Vec): Vec => {
    let s = 0;
    for (const x of v) s += x * x;
    s = Math.sqrt(s);
    if (s === 0) return v.map(() => 0);
    return v.map((x) => x / s);
  };
  return {
    u: e.u,
    point: e.point,
    tangent: e.derivative ? norm(e.derivative) : null,
    differentiability: e.differentiability,
    leftTangent: e.leftDerivative ? norm(e.leftDerivative) : undefined,
    rightTangent: e.rightDerivative ? norm(e.rightDerivative) : undefined,
  };
}
