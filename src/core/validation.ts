import { LIMITS, NurbsCurveData, ValidationError, Vec } from './types.js';

const EPS = 1e-12;

/** 统计节点值 u 在节点向量中的重数（利用非递减性质）。 */
export function knotMultiplicity(knots: number[], u: number): number {
  let m = 0;
  for (const k of knots) {
    if (Math.abs(k - u) <= EPS) m++;
    else if (k > u + EPS) break;
  }
  return m;
}

/**
 * 全面校验一条夹持 NURBS 曲线，所有错误都定位到具体字段。
 * 返回归一化（去引用）后的曲线数据。
 */
export function validateCurve(input: unknown): NurbsCurveData {
  if (typeof input !== 'object' || input === null) {
    throw new ValidationError('curve', '必须是对象');
  }
  const obj = input as Record<string, unknown>;

  const degree = obj.degree;
  if (typeof degree !== 'number' || !Number.isFinite(degree)) {
    throw new ValidationError('degree', '必须是有限数字');
  }
  if (!Number.isInteger(degree)) {
    throw new ValidationError('degree', '必须是整数');
  }
  if (degree < LIMITS.MIN_DEGREE || degree > LIMITS.MAX_DEGREE) {
    throw new ValidationError(
      'degree',
      `次数必须在 ${LIMITS.MIN_DEGREE}..${LIMITS.MAX_DEGREE} 之间，收到 ${degree}`,
    );
  }

  const cps = obj.controlPoints;
  if (!Array.isArray(cps)) {
    throw new ValidationError('controlPoints', '必须是数组');
  }
  if (cps.length < degree + 1) {
    throw new ValidationError(
      'controlPoints',
      `至少需要 degree+1 = ${degree + 1} 个控制点，收到 ${cps.length}`,
    );
  }
  if (cps.length > LIMITS.MAX_CONTROL_POINTS) {
    throw new ValidationError(
      'controlPoints',
      `控制点数量超过上限 ${LIMITS.MAX_CONTROL_POINTS}`,
    );
  }

  let dim = 0;
  const normPoints: Vec[] = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (!Array.isArray(cp)) {
      throw new ValidationError(`controlPoints[${i}]`, '必须是坐标数组');
    }
    if (cp.length !== 2 && cp.length !== 3) {
      throw new ValidationError(
        `controlPoints[${i}]`,
        `维数必须为 2 或 3，收到 ${cp.length}`,
      );
    }
    if (i === 0) {
      dim = cp.length;
    } else if (cp.length !== dim) {
      throw new ValidationError(
        `controlPoints[${i}]`,
        `维数 ${cp.length} 与首点维数 ${dim} 不一致`,
      );
    }
    const row: Vec = [];
    for (let j = 0; j < cp.length; j++) {
      const v = cp[j];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new ValidationError(
          `controlPoints[${i}][${j}]`,
          '坐标必须是有限数字',
        );
      }
      row.push(v);
    }
    normPoints.push(row);
  }

  const weights = obj.weights;
  if (!Array.isArray(weights)) {
    throw new ValidationError('weights', '必须是数组');
  }
  if (weights.length !== cps.length) {
    throw new ValidationError(
      'weights',
      `权重数量 ${weights.length} 必须等于控制点数量 ${cps.length}`,
    );
  }
  const normWeights: number[] = [];
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (typeof w !== 'number' || !Number.isFinite(w)) {
      throw new ValidationError(`weights[${i}]`, '必须是有限数字');
    }
    if (w <= 0) {
      throw new ValidationError(
        `weights[${i}]`,
        `权重必须严格为正，收到 ${w}`,
      );
    }
    normWeights.push(w);
  }

  const knots = obj.knots;
  if (!Array.isArray(knots)) {
    throw new ValidationError('knots', '必须是数组');
  }
 const expectedKnotCount = cps.length + degree + 1;
  if (knots.length !== expectedKnotCount) {
    throw new ValidationError(
      'knots',
      `节点数量必须为 控制点数+次数+1 = ${expectedKnotCount}，收到 ${knots.length}`,
    );
  }
  const normKnots: number[] = [];
  for (let i = 0; i < knots.length; i++) {
    const k = knots[i];
    if (typeof k !== 'number' || !Number.isFinite(k)) {
      throw new ValidationError(`knots[${i}]`, '节点必须是有限数字');
    }
    normKnots.push(k);
  }
  for (let i = 1; i < normKnots.length; i++) {
    if (normKnots[i]! < normKnots[i - 1]!) {
      throw new ValidationError(
        `knots[${i}]`,
        `节点向量必须非递减：knots[${i - 1}]=${normKnots[i - 1]} > knots[${i}]=${normKnots[i]}`,
      );
    }
  }

  const uMin = normKnots[0]!;
  const uMax = normKnots[normKnots.length - 1]!;
  if (uMax <= uMin) {
    throw new ValidationError(
      'knots',
      `参数区间退化：首节点 ${uMin} >= 末节点 ${uMax}`,
    );
  }

  // 夹持：端点节点重数必须恰好为 p+1。
  const startMult = knotMultiplicity(normKnots, uMin);
  if (startMult !== degree + 1) {
    throw new ValidationError(
      'knots',
      `夹持曲线首端点节点重数必须为 degree+1=${degree + 1}，实际 ${startMult}`,
    );
  }
  const endMult = knotMultiplicity(normKnots, uMax);
  if (endMult !== degree + 1) {
    throw new ValidationError(
      'knots',
      `夹持曲线末端点节点重数必须为 degree+1=${degree + 1}，实际 ${endMult}`,
    );
  }

  // 内部节点重数不超过 p。
  let i = degree + 1;
  const end = normKnots.length - (degree + 1);
  while (i < end) {
    const u = normKnots[i]!;
    let m = 1;
    while (i + m < end && normKnots[i + m] === u) m++;
    if (m > degree) {
      throw new ValidationError(
        'knots',
        `内部节点 ${u} 重数 ${m} 超过允许的次数 ${degree}`,
      );
    }
    i += m;
  }

  const name =
    typeof obj.name === 'string' ? obj.name : undefined;

  return {
    name,
    degree,
    controlPoints: normPoints,
    weights: normWeights,
    knots: normKnots,
  };
}

/** 有效参数区间 [uMin, uMax]。 */
export function paramDomain(c: NurbsCurveData): { uMin: number; uMax: number } {
  return {
    uMin: c.knots[0]!,
    uMax: c.knots[c.knots.length - 1]!,
  };
}
