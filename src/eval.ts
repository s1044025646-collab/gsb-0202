import { basisTable } from "./basis";
import { maxAbsDiff } from "./numeric";
import {
  CurveDef,
  Differentiability,
  EvalResult,
  Side,
} from "./types";
import { parameterDomain } from "./validate";

/** 齐次控制点 Pw_i = (w_i * x, w_i * y[, w_i * z], w_i) */
export function toHomogeneous(curve: CurveDef): number[][] {
  const dim = curve.controlPoints[0].length;
  return curve.controlPoints.map((pt, i) => {
    const w = curve.weights[i];
    const h = pt.map((c) => c * w);
    h.push(w);
    void dim;
    return h;
  });
}

interface HomEval {
  point: number[]; // 齐次曲线 Aw(u)
  derivative: number[]; // Aw'(u)
  span: number;
  w: number; // 分母 w(u) = Aw 末分量
}

function evalHomogeneous(curve: CurveDef, Pw: number[][], u: number, side: Side): HomEval {
  const { degree: p, knots } = curve;
  const table = basisTable(knots, p, u, side);
  const i = table.span;
  const N = table.values[p];
  const dN = table.ders[p];
  const hdim = Pw[0].length;
  const point = new Array(hdim).fill(0);
  const derivative = new Array(hdim).fill(0);
  for (let j = 0; j <= p; j++) {
    const cp = Pw[i - p + j];
    for (let d = 0; d < hdim; d++) {
      point[d] += N[j] * cp[d];
      derivative[d] += dN[j] * cp[d];
    }
  }
  return { point, derivative, span: i, w: point[hdim - 1] };
}

/** 有理除法：C = Aw / w，C' = (Aw'*w - Aw*w') / w^2 */
function rationalize(h: HomEval): { point: number[]; derivative: number[] } {
  const hdim = h.point.length;
  const w = h.w;
  const point = h.point.slice(0, hdim - 1).map((x) => x / w);
  const wp = h.derivative[hdim - 1];
  const derivative = h.point
    .slice(0, hdim - 1)
    .map((aw, d) => (h.derivative[d] * w - aw * wp) / (w * w));
  return { point, derivative };
}

/** 单侧求值（点 + 单侧导数），不做任何平移 */
export function evalSide(curve: CurveDef, u: number, side: Side) {
  const Pw = toHomogeneous(curve);
  const h = evalHomogeneous(curve, Pw, u, side);
  return rationalize(h);
}

function isKnot(knots: number[], u: number): boolean {
  return knots.some((k) => k === u);
}

/**
 * 完整求值。
 *
 * 规则（不使用固定微小位移）：
 *  - 左端点：只给右导数（differentiability = right-only）；
 *  - 右端点：只给左导数（left-only）；
 *  - 内部参数：直接在该参数（节点处取右支集）与左极限（取左支集）
 *    分别精确求值。两侧导数相等则可微，否则标记 non-differentiable
 *    并同时给出左右导数。
 */
export function evaluate(curve: CurveDef, u: number): EvalResult {
  const [umin, umax] = parameterDomain(curve.knots);
  if (!Number.isFinite(u) || u < umin || u > umax) {
    throw new Error(`参数 u=${u} 超出有效区间 [${umin}, ${umax}]`);
  }

  const Pw = toHomogeneous(curve);

  if (u === umin && umin !== umax) {
    const h = evalHomogeneous(curve, Pw, u, "right");
    const r = rationalize(h);
    return {
      curveId: 0,
      version: 0,
      u,
      point: r.point,
      derivative: r.derivative,
      differentiability: "right-only",
      sideDerivatives: { left: null, right: r.derivative },
      basisSpan: h.span,
      weightDenominator: h.w,
    };
  }
  if (u === umax) {
    const h = evalHomogeneous(curve, Pw, u, "left");
    const r = rationalize(h);
    return {
      curveId: 0,
      version: 0,
      u,
      point: r.point,
      derivative: r.derivative,
      differentiability: "left-only",
      sideDerivatives: { left: r.derivative, right: null },
      basisSpan: h.span,
      weightDenominator: h.w,
    };
  }

  const hR = evalHomogeneous(curve, Pw, u, "right");
  const rR = rationalize(hR);
  const atNode = isKnot(curve.knots, u);

  if (!atNode) {
    return {
      curveId: 0,
      version: 0,
      u,
      point: rR.point,
      derivative: rR.derivative,
      differentiability: "differentiable",
      sideDerivatives: { left: rR.derivative, right: rR.derivative },
      basisSpan: hR.span,
      weightDenominator: hR.w,
    };
  }

  // 内部节点：比较左右两侧（点必须一致；比较导数）
  const hL = evalHomogeneous(curve, Pw, u, "left");
  const rL = rationalize(hL);
  const TOL = 1e-10;
  const pointJump = maxAbsDiff(rL.point, rR.point);
  const derDiff = maxAbsDiff(rL.derivative, rR.derivative);
  const scale = Math.max(1, ...rL.derivative.map(Math.abs), ...rR.derivative.map(Math.abs));

  let status: Differentiability;
  let derivative: number[] | null;
  if (pointJump > TOL) {
    status = "non-differentiable";
    derivative = null;
  } else if (derDiff <= TOL * scale) {
    // C^1（重数 1 时一般如此）
    status = "derivative-exists";
    derivative = rR.derivative;
  } else {
    // 重数达到 p 时曲线可能出现尖角
    status = "non-differentiable";
    derivative = null;
  }

  return {
    curveId: 0,
    version: 0,
    u,
    point: rR.point,
    derivative,
    differentiability: status,
    sideDerivatives: { left: rL.derivative, right: rR.derivative },
    basisSpan: hR.span,
    weightDenominator: hR.w,
  };
}

/** 切向（单位化导数）；不可微时按指定侧返回 */
export function tangent(curve: CurveDef, u: number, side: Side = "right") {
  const ev = evaluate(curve, u);
  let d = ev.derivative;
  if (!d) {
    d = side === "left" ? ev.sideDerivatives.left : ev.sideDerivatives.right;
  }
  if (!d) throw new Error("该参数处不存在导数");
  const norm = Math.sqrt(d.reduce((s, x) => s + x * x, 0));
  if (norm === 0) {
    // 零速点：尝试另一侧；仍为零则报告
    const other = side === "left" ? ev.sideDerivatives.right : ev.sideDerivatives.left;
    const on = other ? Math.sqrt(other.reduce((s, x) => s + x * x, 0)) : 0;
    if (on === 0) throw new Error("切向未定义：导数为零向量");
    d = other!;
    return { point: ev.point, tangent: d.map((x) => x / on), zeroSpeed: true, differentiability: ev.differentiability };
  }
  return {
    point: ev.point,
    tangent: d.map((x) => x / norm),
    zeroSpeed: false,
    differentiability: ev.differentiability,
  };
}
