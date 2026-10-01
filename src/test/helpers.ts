import { CurveDef } from "../types";
import { validateCurveDef } from "../validate";

export let passed = 0;
export let failed = 0;
const failures: string[] = [];

export function assert(cond: boolean, message: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

export function approx(a: number, b: number, tol = 1e-9): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

export function vectorApprox(a: number[], b: number[], tol = 1e-9): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => approx(x, b[i], tol));
}

export function report() {
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) {
    for (const f of failures) console.error(` - ${f}`);
    process.exitCode = 1;
  }
}

export function validCurve(def: unknown): CurveDef {
  const r = validateCurveDef(def);
  if (!r.ok) {
    throw new Error("测试夹具曲线校验失败: " + JSON.stringify(r.errors, null, 2));
  }
  return r.value!;
}

/** 有理二次：四分之一单位圆，节点 [0,0,0,1,1,1] */
export function quarterCircle(): CurveDef {
  const w = Math.SQRT1_2;
  return validCurve({
    name: "quarter-circle",
    degree: 2,
    controlPoints: [
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    weights: [1, w, 1],
    knots: [0, 0, 0, 1, 1, 1],
  });
}

/** 直线（一次夹持 B 样条） */
export function lineCurve(): CurveDef {
  return validCurve({
    name: "line",
    degree: 1,
    controlPoints: [
      [0, 0],
      [2, 1],
      [5, 1],
    ],
    weights: [1, 1, 1],
    knots: [0, 0, 0.4, 1, 1],
  });
}

/** 三次曲线，含内部重复节点（重数 2，出现不可微尖角） */
export function repeatedKnotCurve(): CurveDef {
  return validCurve({
    name: "repeated-knot",
    degree: 3,
    controlPoints: [
      [0, 0],
      [1, 2],
      [2, 0],
      [3, 2],
      [4, 0],
      [5, 2],
      [6, 0],
    ],
    weights: [1, 1, 2, 1, 1, 1, 2],
    knots: [0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1, 1],
  });
}
