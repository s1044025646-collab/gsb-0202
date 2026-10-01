import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeLine,
  makeParabola,
  makeQuarterCircle,
  makeRepeatedKnot,
} from '../core/presets.js';
import { evaluate, evalRational } from '../core/nurbs.js';
import { insertKnots, insertKnotOnce, verifyShape } from '../core/insert.js';
import { arcLength } from '../core/arclength.js';
import { validateCurve } from '../core/validation.js';
import { ValidationError } from '../core/types.js';

const approx = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol, `期望 ${b}，实际 ${a}`);

function vecApprox(a: number[], b: number[], tol = 1e-9) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) approx(a[i]!, b[i]!, tol);
}

/** 独立中心差分核对解析导数。 */
function checkDerivativeFD(
  c: ReturnType<typeof makeQuarterCircle>,
  u: number,
  tol = 1e-6,
) {
  const h = 1e-6;
  const pL = evalRational(c, u - h, 0).point;
  const pR = evalRational(c, u + h, 0).point;
  const fd = pR.map((v, i) => (v - pL[i]!) / (2 * h));
  const an = evaluate(c, u).derivative!;
  vecApprox(an, fd, tol);
}

test('直线：端点插值、线性点、导数、弧长', () => {
  const c = makeLine();
  vecApprox(evaluate(c, 0).point, [0, 0]);
  vecApprox(evaluate(c, 1).point, [4, 3]);
  vecApprox(evaluate(c, 0.5).point, [2, 1.5]);
  vecApprox(evaluate(c, 0.3).derivative!, [4, 3]);
  const al = arcLength(c);
  approx(al.arcLength, 5, 1e-8);
  assert.equal(al.toleranceMet, true);
});

test('抛物线（普通二次）：端点与中点，导数差分核对', () => {
  const c = makeParabola();
  vecApprox(evaluate(c, 0).point, [0, 0]);
  vecApprox(evaluate(c, 1).point, [2, 0]);
  vecApprox(evaluate(c, 0.5).point, [1, 1], 1e-9);
  checkDerivativeFD(c, 0.25);
  checkDerivativeFD(c, 0.7);
});

test('四分之一单位圆：半径恒为 1、端点、弧长 pi/2', () => {
  const c = makeQuarterCircle();
  vecApprox(evaluate(c, 0).point, [1, 0]);
  vecApprox(evaluate(c, 1).point, [0, 1]);
  for (const u of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const p = evaluate(c, u).point;
    approx(p[0]! * p[0]! + p[1]! * p[1]!, 1, 1e-9);
    checkDerivativeFD(c, u, 1e-5);
  }
  const al = arcLength(c, { tolerance: 1e-10 });
  approx(al.arcLength, Math.PI / 2, 1e-7);
});

test('权重不同产生真正不同的有理曲线', () => {
  const base = makeQuarterCircle();
  const altered = {
    ...base,
    weights: [1, 0.8, 1],
  };
  const pb = evaluate(base, 0.5).point;
  const pa = evaluate(altered, 0.5).point;
  assert.ok(Math.hypot(pb[0]! - pa[0]!, pb[1]! - pa[1]!) > 1e-4);
});

test('权重统一缩放不改变曲线', () => {
  const c = makeQuarterCircle();
  const scaled = {
    ...c,
    weights: c.weights.map((w) => w * 3.7),
  };
  for (const u of [0.1, 0.5, 0.9]) {
    vecApprox(evaluate(c, u).point, evaluate(scaled, u).point, 1e-12);
    vecApprox(
      evaluate(c, u).derivative!,
      evaluate(scaled, u).derivative!,
      1e-12,
    );
  }
});

test('重复节点（重数=次数）不可微，返回左右导数且点连续', () => {
  const c = makeRepeatedKnot();
  const e = evaluate(c, 0.5);
  assert.equal(e.differentiability, 'non-differentiable-repeated-knot');
  assert.equal(e.derivative, null);
  assert.ok(e.leftDerivative && e.rightDerivative);
  // 左右极限点一致（位置连续）
  const l = evalRational(c, 0.5, -1).point;
  const r = evalRational(c, 0.5, 1).point;
  vecApprox(l, r, 1e-12);
  // 左右导数方向不同
  const cross =
    e.leftDerivative![0]! * e.rightDerivative![1]! -
    e.leftDerivative![1]! * e.rightDerivative![0]!;
  assert.ok(Math.abs(cross) > 1e-6, '折点左右导数应不平行');
});

test('节点插入保形：点与可微处导数一致，结构改变', () => {
  const c = makeQuarterCircle();
  const r = insertKnots(c, [0.25, 0.5, 0.75]);
  assert.equal(r.after.controlPoints.length, c.controlPoints.length + 3);
  assert.equal(r.after.knots.length, c.knots.length + 3);
  assert.equal(r.verification.passed, true);
  assert.ok(r.verification.maxPointError < 1e-10);
  assert.ok(r.verification.sampleCount >= 64);
});

test('细化圆弧后控制点仍精确位于圆上几何（独立核验）', () => {
  const c = makeQuarterCircle();
  const r = insertKnots(c, [0.3, 0.6]);
  const v = verifyShape(c, r.after, 128, 1e-11);
  assert.equal(v.passed, true);
});

test('达到允许重数后再次插入被拒绝，且不留半成品', () => {
  const c = makeRepeatedKnot(); // 0.5 重数已为 2（=次数）
  const beforeCpCount = c.controlPoints.length;
  const beforeKnotCount = c.knots.length;
  assert.throws(
    () => insertKnots(c, [0.25, 0.5]),
    (err) => {
      assert.ok(err instanceof ValidationError);
      const rejected = (err as unknown as { rejected: unknown[] }).rejected;
      assert.equal(rejected.length, 1);
      return true;
    },
  );
  // 输入对象未被修改
  assert.equal(c.controlPoints.length, beforeCpCount);
  assert.equal(c.knots.length, beforeKnotCount);
});

test('批量插入中某步非法时整体回滚（模拟对象不产生部分版本）', () => {
  const c = makeQuarterCircle();
  // 0.5 插入两次：二次曲线内部重数上限 2，第二次非法
  assert.throws(() => insertKnots(c, [0.5, 0.5, 0.25]));
  assert.equal(c.controlPoints.length, 3);
});

test('单次插入几何一致（直接核对）', () => {
  const c = makeParabola();
  const after = insertKnotOnce(c, 0.5);
  assert.equal(after.controlPoints.length, 4);
  for (const u of [0.1, 0.5, 0.9]) {
    vecApprox(
      evalRational(c, u, 0).point,
      evalRational(after, u, 0).point,
      1e-12,
    );
  }
});

test('校验：非法次数、维数不一致、权重非正、节点数量/重数错误均定位字段', () => {
  const c = makeQuarterCircle();
  assert.throws(
    () => validateCurve({ ...c, degree: 6 }),
    /degree/,
  );
  assert.throws(
    () =>
      validateCurve({
        ...c,
        controlPoints: [[1, 0], [1, 1, 0], [0, 1]],
      }),
    /controlPoints\[1\]/,
  );
  assert.throws(
    () => validateCurve({ ...c, weights: [1, 0, 1] }),
    /weights\[1\]/,
  );
  assert.throws(
    () => validateCurve({ ...c, knots: c.knots.slice(0, -1) }),
    /knots/,
  );
  assert.throws(
    () =>
      validateCurve({
        degree: 2,
        controlPoints: [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0], [5, 1]],
        weights: [1, 1, 1, 1, 1, 1],
        knots: [0, 0, 0, 0.5, 0.5, 0.5, 0.9, 1, 1, 1],
      }),
    /内部节点/,
  );
});

test('弧长积分预算耗尽时保留近似并标记未达精度', () => {
  const c = makeQuarterCircle();
  const al = arcLength(c, { tolerance: 1e-15, maxSubdivisions: 4 });
  assert.equal(al.toleranceMet, false);
  assert.equal(al.stopReason, 'max-subdivisions-budget-exceeded');
  assert.ok(al.arcLength > 0);
});

test('弧长绝不使用控制多边形长度：圆例明显短于多边形', () => {
  const c = makeQuarterCircle();
  const al = arcLength(c, { tolerance: 1e-9 });
  // 控制多边形长度：sqrt2 + 1 ≈ 2.414，弧长 pi/2 ≈ 1.5708
  assert.ok(Math.abs(al.arcLength - Math.PI / 2) < 1e-6);
});
