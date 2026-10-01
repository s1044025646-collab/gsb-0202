import { evalSide } from "./eval";
import { vectorNorm } from "./numeric";
import { ArcLengthResult, CurveDef } from "./types";
import { parameterDomain } from "./validate";

/** 速度 |C'(u)|；节点处取右导数（积分测度意义下单点选择不影响结果） */
function speed(curve: CurveDef, u: number, side: "left" | "right" = "right"): number {
  const s = evalSide(curve, u, side);
  return vectorNorm(s.derivative);
}

function simpson(curve: CurveDef, a: number, b: number, fa: number, fm: number, fb: number): number {
  return ((b - a) / 6) * (fa + 4 * fm + fb);
}

export interface ArcLengthOptions {
  tolerance?: number;
  maxSubdivisions?: number;
  rangeStart?: number;
  rangeEnd?: number;
}

/**
 * 自适应 Simpson 弧长积分。
 *
 *  - 以相邻内部节点为初始分段（重复节点/零长度区间长度为 0，自动跳过）；
 *  - |S(a,m)+S(m,b) - S(a,b)| / 15 <= 局部容差 时收敛；
 *  - 达到细分预算仍未收敛：保留当前近似值，stopReason=budget-exhausted，
 *    toleranceAchieved=false（绝不用控制多边形长度冒充弧长）。
 */
export function arcLength(curve: CurveDef, opts: ArcLengthOptions = {}): ArcLengthResult {
  const tolerance = opts.tolerance ?? 1e-8;
  const maxSubdivisions = opts.maxSubdivisions ?? 10000;
  const [umin, umax] = parameterDomain(curve.knots);
  const a = opts.rangeStart ?? umin;
  const b = opts.rangeEnd ?? umax;

  const base: ArcLengthResult = {
    curveId: 0,
    version: 0,
    rangeStart: a,
    rangeEnd: b,
    arcLength: 0,
    tolerance,
    subdivisions: 0,
    evaluations: 0,
    stopReason: "tolerance-met",
    toleranceAchieved: true,
    estimatedError: 0,
  };
  if (!(b > a)) {
    return { ...base, stopReason: "degenerate", estimatedError: 0 };
  }

  // 初始分段：按内部节点切分
  const interiorKnots = [...new Set(curve.knots.filter((k) => k > a && k < b))].sort(
    (x, y) => x - y,
  );
  const breaks = [a, ...interiorKnots, b];
  const totalLen = b - a;

  let total = 0;
  let totalError = 0;
  let subdivisions = 0;
  let evaluations = 0;
  let budgetExhausted = false;

  interface Seg {
    a: number;
    b: number;
    fa: number;
    fm: number;
    fb: number;
    whole: number;
    tol: number;
  }

  const f = (u: number, side: "left" | "right" = "right") => {
    evaluations++;
    return speed(curve, u, side);
  };

  const stack: Seg[] = [];
  for (let i = 0; i < breaks.length - 1; i++) {
    const sa = breaks[i];
    const sb = breaks[i + 1];
    if (!(sb > sa)) continue;
    const fa = f(sa, "right");
    const fb = f(sb, "left");
    const fm = f((sa + sb) / 2);
    const whole = simpson(curve, sa, sb, fa, fm, fb);
    stack.push({ a: sa, b: sb, fa, fm, fb, whole, tol: tolerance * ((sb - sa) / totalLen) });
  }

  while (stack.length) {
    const seg = stack.pop()!;
    const m = (seg.a + seg.b) / 2;
    const lm = (seg.a + m) / 2;
    const rm = (m + seg.b) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simpson(curve, seg.a, m, seg.fa, flm, seg.fm);
    const right = simpson(curve, m, seg.b, seg.fm, frm, seg.fb);
    const delta = left + right - seg.whole;
    const err = Math.abs(delta) / 15;

    if (err <= seg.tol || subdivisions >= maxSubdivisions) {
      // 收敛，或预算耗尽：保留更精细的近似 + Richardson 修正
      total += left + right + delta / 15;
      totalError += err;
      if (subdivisions >= maxSubdivisions && err > seg.tol) {
        budgetExhausted = true;
      }
    } else {
      subdivisions++;
      const childTol = seg.tol / 2;
      stack.push({ a: seg.a, b: m, fa: seg.fa, fm: flm, fb: seg.fm, whole: left, tol: childTol });
      stack.push({ a: m, b: seg.b, fa: seg.fm, fm: frm, fb: seg.fb, whole: right, tol: childTol });
    }
  }

  return {
    ...base,
    arcLength: total,
    subdivisions,
    evaluations,
    stopReason: budgetExhausted ? "budget-exhausted" : "tolerance-met",
    toleranceAchieved: !budgetExhausted,
    estimatedError: totalError,
  };
}
