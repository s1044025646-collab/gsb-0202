import {
  CurveDef,
  MAX_CONTROL_POINTS,
  MAX_DEGREE,
  MIN_DEGREE,
  ValidationError,
} from "./types";
import { isFiniteNumber } from "./numeric";

/**
 * 校验曲线定义。错误必须定位到具体字段路径，例如
 * knots[7]、weights[3]、controlPoints[2][1]。
 */
export function validateCurveDef(input: unknown): {
  ok: boolean;
  errors: ValidationError[];
  value?: CurveDef;
} {
  const errors: ValidationError[] = [];
  if (typeof input !== "object" || input === null) {
    return {
      ok: false,
      errors: [{ field: "(root)", message: "必须是对象" }],
    };
  }
  const obj = input as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name : "";

  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    errors.push({ field: "name", message: "名称必须是非空字符串", value: obj.name });
  }

  // ---- 次数 ----
  const degree = obj.degree;
  if (!isFiniteNumber(degree) || !Number.isInteger(degree)) {
    errors.push({ field: "degree", message: "次数必须是整数", value: degree });
  } else if (degree < MIN_DEGREE || degree > MAX_DEGREE) {
    errors.push({
      field: "degree",
      message: `次数必须在 ${MIN_DEGREE} 到 ${MAX_DEGREE} 之间（夹持曲线）`,
      value: degree,
    });
  }

  // ---- 控制点 ----
  let dim = 0;
  const cps = obj.controlPoints;
  if (!Array.isArray(cps)) {
    errors.push({ field: "controlPoints", message: "控制点必须是数组", value: cps });
  } else {
    if (cps.length === 0) {
      errors.push({ field: "controlPoints", message: "至少需要一个控制点" });
    }
    if (cps.length > MAX_CONTROL_POINTS) {
      errors.push({
        field: "controlPoints",
        message: `控制点数量超过上限 ${MAX_CONTROL_POINTS}`,
        value: cps.length,
      });
    }
    for (let i = 0; i < cps.length; i++) {
      const p = cps[i];
      if (!Array.isArray(p)) {
        errors.push({
          field: `controlPoints[${i}]`,
          message: "控制点必须是坐标数组",
          value: p,
        });
        continue;
      }
      if (p.length !== 2 && p.length !== 3) {
        errors.push({
          field: `controlPoints[${i}]`,
          message: `控制点维数必须为 2 或 3，实际为 ${p.length}`,
          value: p.length,
        });
        continue;
      }
      for (let j = 0; j < p.length; j++) {
        if (!isFiniteNumber(p[j])) {
          errors.push({
            field: `controlPoints[${i}][${j}]`,
            message: "坐标必须是有限数",
            value: p[j],
          });
        }
      }
      if (p.length === 2 || p.length === 3) {
        if (dim === 0) dim = p.length;
        else if (dim !== p.length) {
          errors.push({
            field: `controlPoints[${i}]`,
            message: `控制点维数不一致：首个点为 ${dim} 维，此点为 ${p.length} 维`,
            value: p.length,
          });
        }
      }
    }
  }

  // ---- 权重 ----
  const weights = obj.weights;
  if (!Array.isArray(weights)) {
    errors.push({ field: "weights", message: "权重必须是数组", value: weights });
  } else {
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i];
      if (!isFiniteNumber(w)) {
        errors.push({
          field: `weights[${i}]`,
          message: "权重必须是有限数",
          value: w,
        });
      } else if (!(w > 0)) {
        errors.push({
          field: `weights[${i}]`,
          message: "权重必须严格为正数",
          value: w,
        });
      }
    }
    if (
      Array.isArray(cps) &&
      weights.length !== cps.length &&
      cps.length > 0
    ) {
      errors.push({
        field: "weights",
        message: `权重数量(${weights.length})必须等于控制点数量(${cps.length})`,
        value: weights.length,
      });
    }
  }

  // ---- 节点向量 ----
  const knots = obj.knots;
  const nCp = Array.isArray(cps) ? cps.length : 0;
  const p = isFiniteNumber(degree) ? (degree as number) : 0;
  const expectedKnots = nCp + p + 1;
  if (!Array.isArray(knots)) {
    errors.push({ field: "knots", message: "节点向量必须是数组", value: knots });
  } else {
    for (let i = 0; i < knots.length; i++) {
      if (!isFiniteNumber(knots[i])) {
        errors.push({
          field: `knots[${i}]`,
          message: "节点必须是有限数",
          value: knots[i],
        });
      }
    }
    if (knots.length !== expectedKnots && expectedKnots > 1 && p >= MIN_DEGREE) {
      errors.push({
        field: "knots",
        message: `节点数量必须为 控制点数 + 次数 + 1 = ${expectedKnots}，实际为 ${knots.length}`,
        value: knots.length,
      });
    }
    for (let i = 1; i < knots.length; i++) {
      if (isFiniteNumber(knots[i - 1]) && isFiniteNumber(knots[i]) && knots[i] < knots[i - 1]) {
        errors.push({
          field: `knots[${i}]`,
          message: `节点向量必须非递减：knots[${i - 1}]=${knots[i - 1]} > knots[${i}]=${knots[i]}`,
          value: knots[i],
        });
      }
    }
    if (knots.length >= 2 && isFiniteNumber(knots[0]) && isFiniteNumber(knots[knots.length - 1])) {
      if (!(knots[knots.length - 1] > knots[0])) {
        errors.push({
          field: "knots",
          message: "参数区间长度必须为正（首节点必须严格小于末节点）",
        });
      }
      if (p >= MIN_DEGREE) {
        // 端点重数必须恰好为 p+1（夹持曲线）
        const startVal = knots[0];
        let startMult = 1;
        while (startMult < knots.length && knots[startMult] === startVal) startMult++;
        if (startMult !== p + 1) {
          errors.push({
            field: "knots",
            message: `夹持曲线首节点重数必须为 次数+1 = ${p + 1}，实际为 ${startMult}`,
            value: startMult,
          });
        }
        const endVal = knots[knots.length - 1];
        let endMult = 1;
        let idx = knots.length - 2;
        while (idx >= 0 && knots[idx] === endVal) {
          endMult++;
          idx--;
        }
        if (endMult !== p + 1) {
          errors.push({
            field: "knots",
            message: `夹持曲线末节点重数必须为 次数+1 = ${p + 1}，实际为 ${endMult}`,
            value: endMult,
          });
        }
        // 内部节点重数不超过 p（跳过首末端点重数段）
        let runStart = startMult;
        const interiorEnd = knots.length - endMult;
        while (runStart < interiorEnd) {
          let runEnd = runStart + 1;
          while (runEnd < interiorEnd && knots[runEnd] === knots[runStart]) runEnd++;
          const mult = runEnd - runStart;
          if (mult > p) {
            errors.push({
              field: `knots[${runStart}]`,
              message: `内部节点 ${knots[runStart]} 重数为 ${mult}，超过次数上限 ${p}`,
              value: mult,
            });
          }
          runStart = runEnd;
        }
      }
    }
  }

  if (!errors.length) {
    const value: CurveDef = {
      name: name.trim(),
      degree: p,
      controlPoints: (cps as number[][]).map((q) => q.slice()),
      weights: (weights as number[]).slice(),
      knots: (knots as number[]).slice(),
    };
    return { ok: true, errors: [], value };
  }
  return { ok: false, errors };
}

/** 返回有效参数区间 [u_min, u_max] */
export function parameterDomain(knots: number[]): [number, number] {
  return [knots[0], knots[knots.length - 1]];
}

/** 某内部节点当前重数 */
export function knotMultiplicity(knots: number[], u: number): number {
  let m = 0;
  for (const k of knots) if (k === u) m++;
  return m;
}
