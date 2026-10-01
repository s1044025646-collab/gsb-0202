import { arcLength } from "../arclength";
import { basisTable } from "../basis";
import { evalSide, evaluate, tangent, toHomogeneous } from "../eval";
import { insertKnot, insertKnots, verifyShape } from "../refine";
import { validateCurveDef } from "../validate";
import {
  assert,
  approx,
  lineCurve,
  quarterCircle,
  repeatedKnotCurve,
  validCurve,
  vectorApprox,
} from "./helpers";

/** 独立中心差分检查导数（h 不用于产品代码，仅用于测试交叉验证） */
function fdDerivative(curve: ReturnType<typeof validCurve>, u: number, h = 1e-6) {
  const lo = curve.knots[0];
  const hi = curve.knots[curve.knots.length - 1];
  const a = evalSide(curve, Math.max(lo + 1e-12, u - h), "right").point;
  const b = evalSide(curve, Math.min(hi - 1e-12, u + h), "right").point;
  return b.map((x, i) => (x - a[i]) / (2 * h));
}

export function runMathTests() {
  console.log("== 1. 直线 ==");
  {
    const c = lineCurve();
    const p0 = evaluate(c, 0);
    assert(vectorApprox(p0.point, [0, 0], 1e-12), "直线左端点插值 (0,0)");
    assert(p0.differentiability === "right-only", "左端点仅右导数");
    const p1 = evaluate(c, 1);
    assert(vectorApprox(p1.point, [5, 1], 1e-12), "直线右端点插值 (5,1)");
    assert(p1.differentiability === "left-only", "右端点仅左导数");
    // 第一段 u in [0,0.4)：P0 -> P1
    const mid = evaluate(c, 0.2);
    assert(vectorApprox(mid.point, [1, 0.5], 1e-12), "直线段内点正确");
    assert(vectorApprox(mid.derivative!, [5, 2.5], 1e-9), "直线段导数 = 控制边/节点距");
  }

  console.log("== 2. 普通二次曲线 + 差分导数 ==");
  {
    const c = validCurve({
      name: "quad",
      degree: 2,
      controlPoints: [
        [0, 0],
        [1, 3],
        [4, 2],
      ],
      weights: [1, 1, 1],
      knots: [0, 0, 0, 1, 1, 1],
    });
    for (const u of [0.13, 0.5, 0.83]) {
      const e = evaluate(c, u);
      const fd = fdDerivative(c, u);
      assert(vectorApprox(e.derivative!, fd, 1e-5), `二次曲线 u=${u} 导数与中心差分一致`);
    }
  }

  console.log("== 3. 四分之一单位圆 ==");
  {
    const c = quarterCircle();
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const e = evaluate(c, u);
      const r = Math.hypot(e.point[0], e.point[1]);
      assert(approx(r, 1, 1e-9), `圆弧 u=${u} 位于单位圆上 (r=${r.toFixed(10)})`);
      if (u > 0 && u < 1) {
        const fd = fdDerivative(c, u);
        assert(vectorApprox(e.derivative!, fd, 1e-5), `圆弧 u=${u} 导数通过差分检查`);
        // 切向垂直于径向
        const dot = e.point[0] * e.derivative![0] + e.point[1] * e.derivative![1];
        assert(approx(dot, 0, 1e-8), `圆弧 u=${u} 切向与径向正交`);
      }
    }
    assert(vectorApprox(evaluate(c, 0).point, [1, 0], 1e-12), "圆弧起点 (1,0)");
    assert(vectorApprox(evaluate(c, 1).point, [0, 1], 1e-12), "圆弧终点 (0,1)");

    const al = arcLength(c, { tolerance: 1e-10 });
    assert(approx(al.arcLength, Math.PI / 2, 1e-7), `圆弧长度 = π/2（实际 ${al.arcLength}）`);
    assert(al.stopReason === "tolerance-met", "圆弧积分达到容差并正常停止");
  }

  console.log("== 4. 权重真正影响几何 ==");
  {
    const c1 = quarterCircle();
    const c2 = validCurve({
      ...c1,
      name: "different-weight",
      weights: [1, 2.5, 1],
    });
    const e1 = evaluate(c1, 0.5).point;
    const e2 = evaluate(c2, 0.5).point;
    assert(!vectorApprox(e1, e2, 1e-3), "不同权重产生真正不同的曲线点");

    // 权重统一缩放不改变结果
    const c3 = validCurve({
      ...c1,
      name: "scaled-weight",
      weights: c1.weights.map((w) => w * 7.3),
    });
    for (const u of [0.1, 0.5, 0.9]) {
      assert(
        vectorApprox(evaluate(c1, u).point, evaluate(c3, u).point, 1e-12),
        `权重统一缩放 u=${u} 不改变曲线点`,
      );
      assert(
        vectorApprox(evaluate(c1, u).derivative!, evaluate(c3, u).derivative!, 1e-10),
        `权重统一缩放 u=${u} 不改变导数`,
      );
    }
  }

  console.log("== 5. 重复节点与不可微 ==");
  {
    const c = repeatedKnotCurve();
    const e = evaluate(c, 0.5);
    assert(
      e.differentiability === "non-differentiable",
      "重数 2 的三次节点处标记为不可微",
    );
    assert(e.derivative === null, "不可微时 derivative 为 null");
    assert(e.sideDerivatives.left !== null && e.sideDerivatives.right !== null, "给出左右导数");
    assert(
      !vectorApprox(e.sideDerivatives.left!, e.sideDerivatives.right!, 1e-8),
      "左右导数确实不同",
    );
    assert(vectorApprox(evalSide(c, 0.5, "left").point, evalSide(c, 0.5, "right").point, 1e-12),
      "不可微点处曲线点本身连续");

    // 简单内部节点（重数1）处可微：二次曲线 4 控制点 + 1 个内部节点
    const c2 = validCurve({
      name: "quad-knot",
      degree: 2,
      controlPoints: [
        [0, 0],
        [1, 3],
        [3, 3],
        [4, 0],
      ],
      weights: [1, 1.2, 0.8, 1],
      knots: [0, 0, 0, 0.4, 1, 1, 1],
    });
    const e2 = evaluate(c2, 0.4);
    assert(e2.differentiability === "derivative-exists" || e2.differentiability === "differentiable",
      "重数 1 的内部节点处导数存在");
    assert(vectorApprox(e2.sideDerivatives.left!, e2.sideDerivatives.right!, 1e-9),
      "重数 1 节点处左右导数相等");

    const t = tangent(c, 0.5, "left");
    assert(Math.abs(Math.hypot(...t.tangent) - 1) < 1e-12, "切向为单位向量");
  }

  console.log("== 6. 节点插入保形（含重复节点） ==");
  {
    for (const [name, c, us] of [
      ["圆弧", quarterCircle(), [0.25, 0.5, 0.75]],
      ["重复节点曲线", repeatedKnotCurve(), [0.25, 0.75]],
    ] as const) {
      const { curve: after, inserted, error } = insertKnots(c, [...us]);
      assert(!error && inserted.length === us.length, `${name}: 批量插入成功`);
      const v = verifyShape(c, after);
      assert(v.passed, `${name}: 独立采样点保形核验通过 (点误差 ${v.maxPointError.toExponential(2)}, 导数误差 ${v.maxDerivativeError.toExponential(2)})`);
      assert(after.controlPoints.length === c.controlPoints.length + us.length,
        `${name}: 控制点数 = 原数 + 插入数`);
      // 单次插入等价于批量
      let step = c;
      for (const u of us) step = insertKnot(step, u);
      assert(JSON.stringify(step.knots) === JSON.stringify(after.knots),
        `${name}: 单步与批量插入节点向量一致`);
    }

    // 达到重数上限再插入被拒绝（0.5 当前重数 3 = degree）
    const c = repeatedKnotCurve();
    const atMax = insertKnots(c, [0.5]);
    assert(atMax.error !== null, "重数 3 = degree 3：插入立即被拒绝");
    const over = insertKnots(c, [0.25, 0.5]);
    assert(over.error !== null && over.failedStep === 1, "批量第二步非法被拒绝并定位步骤");
    assert(JSON.stringify(over.curve.knots) === JSON.stringify(c.knots),
      "被拒绝的批量插入不改变原曲线（无半成品）");

    // 端点插入拒绝
    const end = insertKnots(quarterCircle(), [0]);
    assert(end.error !== null, "在端点插入节点被拒绝");
  }

  console.log("== 7. 基函数分区统一性（零长度区间规则） ==");
  {
    const c = repeatedKnotCurve();
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const t = basisTable(c.knots, c.degree, u, "right");
      const sum = t.values[c.degree].reduce((s, x) => s + x, 0);
      assert(approx(sum, 1, 1e-12), `u=${u} 基函数之和为 1（含重复节点，实际 ${sum}）`);
    }
  }

  console.log("== 8. 校验错误定位字段 ==");
  {
    const bad = validateCurveDef({
      name: "",
      degree: 7,
      controlPoints: [[0, 0], [1, 1, 0]],
      weights: [1, -2],
      knots: [0, 0, 1, 1],
    });
    const fields = bad.errors!.map((e) => e.field);
    for (const f of ["name", "degree", "controlPoints[1]", "weights[1]", "knots"]) {
      assert(fields.includes(f), `非法数据定位到字段 ${f}（实际: ${fields.join(", ")}）`);
    }
  }

  console.log("== 9. 三维有理曲线 ==");
  {
    const c = validCurve({
      name: "cubic3d",
      degree: 3,
      controlPoints: [
        [0, 0, 0],
        [1, 2, 1],
        [2, 2, 3],
        [4, 0, 2],
        [5, 1, 0],
      ],
      weights: [1, 1.5, 0.5, 2, 1],
      knots: [0, 0, 0, 0, 0.6, 1, 1, 1, 1],
    });
    const e = evaluate(c, 0.4);
    assert(e.point.length === 3, "三维点有三个分量");
    const fd = fdDerivative(c, 0.4);
    assert(vectorApprox(e.derivative!, fd, 1e-5), "三维曲线导数通过差分检查");
    const { curve: after } = insertKnots(c, [0.3]);
    assert(verifyShape(c, after).passed, "三维曲线节点插入保形");
  }

  void toHomogeneous;
}
