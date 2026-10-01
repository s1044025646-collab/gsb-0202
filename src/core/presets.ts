import { NurbsCurveData } from './types.js';

/** 直线（一次夹持）。 */
export function makeLine(): NurbsCurveData {
  return {
    name: 'line',
    degree: 1,
    controlPoints: [[0, 0], [4, 3]],
    weights: [1, 1],
    knots: [0, 0, 1, 1],
  };
}

/** 普通二次（抛物线弧），权重全 1。 */
export function makeParabola(): NurbsCurveData {
  return {
    name: 'parabola',
    degree: 2,
    controlPoints: [[0, 0], [1, 2], [2, 0]],
    weights: [1, 1, 1],
    knots: [0, 0, 0, 1, 1, 1],
  };
}

/**
 * 四分之一单位圆：第一象限，从 (1,0) 到 (0,1)。
 * 有理二次，中间权重为 1/sqrt(2)。
 */
export function makeQuarterCircle(): NurbsCurveData {
  return {
    name: 'quarter-circle',
    degree: 2,
    controlPoints: [[1, 0], [1, 1], [0, 1]],
    weights: [1, Math.SQRT1_2, 1],
    knots: [0, 0, 0, 1, 1, 1],
  };
}

/** 带重复内部节点的二次曲线（在 u=0.5 重数 2，不可微折点）。 */
export function makeRepeatedKnot(): NurbsCurveData {
  return {
    name: 'repeated-knot',
    degree: 2,
    controlPoints: [[0, 0], [1, 1], [1, -1], [2, 0]],
    weights: [1, 1, 1, 1],
    knots: [0, 0, 0, 0.5, 0.5, 1, 1, 1],
  };
}
