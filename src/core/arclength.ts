import { ArcLengthResult, NurbsCurveData } from './types.js';
import { paramDomain } from './validation.js';
import { evalRational } from './nurbs.js';

/** |C'(u)|，不可微节点处允许单侧（积分按连续弧长处理，但会记录停止原因）。 */
function speed(c: NurbsCurveData, u: number, side: -1 | 0 | 1): number {
  const r = evalRational(c, u, side);
  let s = 0;
  for (const x of r.derivative) s += x * x;
  return Math.sqrt(s);
}

/** 收集内部重数等于次数的不可微节点。 */
function nonDiffKnots(c: NurbsCurveData): number[] {
  const { uMin, uMax } = paramDomain(c);
  const out: number[] = [];
  for (let i = c.degree + 1; i < c.knots.length - (c.degree + 1); ) {
    const u = c.knots[i]!;
    let m = 1;
    while (c.knots[i + m] === u) m++;
    if (m >= c.degree && u > uMin && u < uMax) out.push(u);
    i += m;
  }
  return out;
}

function simpson(
  c: NurbsCurveData,
  a: number,
  b: number,
  fa: number,
  fm: number,
  fb: number,
): number {
  return ((b - a) / 6) * (fa + 4 * fm + fb);
}

/**
 * 自适应弧长积分（自适应 Simpson）。
 * - tolerance：绝对误差容差。
 * - maxSubdivisions：细分预算；超预算时保留近似值并标记未达精度。
 * - 不把控制多边形长度当弧长；始终对 |C'(u)| 积分。
 */
export function arcLength(
  c: NurbsCurveData,
  opts: {
    uStart?: number;
    uEnd?: number;
    tolerance?: number;
    maxSubdivisions?: number;
  } = {},
): ArcLengthResult {
  const { uMin, uMax } = paramDomain(c);
  const uStart = opts.uStart ?? uMin;
  const uEnd = opts.uEnd ?? uMax;
  const tolerance = opts.tolerance ?? 1e-7;
  const maxSubdivisions = opts.maxSubdivisions ?? 100_000;

  if (!(uStart >= uMin && uEnd <= uMax && uStart < uEnd)) {
    throw new RangeError(
      `积分区间非法：需要 ${uMin} <= uStart < uEnd <= ${uMax}，收到 ${uStart}, ${uEnd}`,
    );
  }

  // 不可微节点作为强制分割边界，避免在折点上跨区间 Simpson。
  const cuts = nonDiffKnots(c).filter((u) => u > uStart && u < uEnd);
  const bounds = [uStart, ...cuts, uEnd];
  let crossedNonDiff = cuts.length > 0;

  let total = 0;
  let leaves = 0;
  let evals = 0;
  let budgetExceeded = false;

  const f = (u: number, side: -1 | 0 | 1 = 0): number => {
    evals++;
    return speed(c, u, side);
  };

  for (let seg = 0; seg < bounds.length - 1; seg++) {
    const a = bounds[seg]!;
    const b = bounds[seg + 1]!;
    // 端点侧别：若邻接不可微节点，用相应单侧导数。
    const fa = f(a, seg === 0 ? 0 : 1);
    const fb = f(b, seg === bounds.length - 2 ? 0 : -1);
    const fm = f((a + b) / 2);
    const whole = simpson(c, a, b, fa, fm, fb);

    type Frame = {
      a: number; b: number; fa: number; fm: number; fb: number; whole: number;
      tol: number; depth: number;
    };
    const stack: Frame[] = [
      { a, b, fa, fm, fb, whole, tol: tolerance / (bounds.length - 1), depth: 0 },
    ];

    while (stack.length > 0) {
      const fr = stack.pop()!;
      const m = (fr.a + fr.b) / 2;
      const flm = f((fr.a + m) / 2);
      const frm = f((m + fr.b) / 2);
      const left = simpson(c, fr.a, m, fr.fa, flm, fr.fm);
      const right = simpson(c, m, fr.b, fr.fm, frm, fr.fb);
      const delta = left + right - fr.whole;
      if (leaves >= maxSubdivisions) {
        // 预算耗尽：直接累加当前最佳近似（含细分项）。
        total += left + right;
        budgetExceeded = true;
        leaves++;
        continue;
      }
      if (Math.abs(delta) <= 15 * fr.tol || fr.depth >= 40) {
        total += left + right + delta / 15;
        leaves++;
      } else {
        stack.push({
          a: fr.a, b: m, fa: fr.fa, fm: flm, fb: fr.fm, whole: left,
          tol: fr.tol / 2, depth: fr.depth + 1,
        });
        stack.push({
          a: m, b: fr.b, fa: fr.fm, fm: frm, fb: fr.fb, whole: right,
          tol: fr.tol / 2, depth: fr.depth + 1,
        });
      }
    }
  }

  const stopReason = budgetExceeded
    ? 'max-subdivisions-budget-exceeded'
    : crossedNonDiff
      ? 'non-differentiable-knot-crossed'
      : 'tolerance-met';

  return {
    uStart,
    uEnd,
    arcLength: total,
    tolerance,
    subdivisions: leaves,
    evaluations: evals,
    stopReason,
    toleranceMet: !budgetExceeded,
  };
}
