/**
 * NURBS 曲线核心数据结构。
 *
 * 曲线为夹持（clamped）B 样条曲线：
 *   C(u) = Σ N_i,p(u) * w_i * P_i / Σ N_i,p(u) * w_i
 * 通过齐次控制点 Pw_i = (w_i*P_i, w_i) 求值。
 */

export const MIN_DEGREE = 1;
export const MAX_DEGREE = 5;
export const MAX_CONTROL_POINTS = 1000;

/** 二维或三维控制点点位 */
export type Point2D = [number, number];
export type Point3D = [number, number, number];
export type Point = Point2D | Point3D;

/** 一条被冻结的 NURBS 曲线定义 */
export interface CurveDef {
  /** 曲线名称 */
  name: string;
  /** 次数 p，范围 1..5 */
  degree: number;
  /** 控制点，维数必须全部为 2 或全部为 3 */
  controlPoints: number[][];
  /** 权重，长度与控制点一致，必须全部为正数 */
  weights: number[];
  /** 非递减节点向量，长度 = 控制点数 + 次数 + 1 */
  knots: number[];
}

/** 齐次控制点 (w*x, w*y[, w*z], w) */
export type HomPoint = number[];

/** 单侧方向：左导数 / 右导数 */
export type Side = "left" | "right";

/** 可微性判定结果 */
export type Differentiability =
  | "differentiable"
  | "left-only"
  | "right-only"
  | "non-differentiable"
  | "derivative-exists";

/** 单次求值结果 */
export interface EvalResult {
  curveId: number;
  version: number;
  u: number;
  point: number[];
  /** 导数（可微时为实际导数；不可微时为 null，使用 sideDerivatives） */
  derivative: number[] | null;
  differentiability: Differentiability;
  sideDerivatives: {
    left: number[] | null;
    right: number[] | null;
  };
  basisSpan: number;
  weightDenominator: number;
}

/** 结构对照（节点插入前后） */
export interface StructureComparison {
  before: {
    degree: number;
    controlPointCount: number;
    weights: number[];
    knots: number[];
    controlPoints: number[][];
  };
  after: {
    degree: number;
    controlPointCount: number;
    weights: number[];
    knots: number[];
    controlPoints: number[][];
  };
  insertedKnots: number[];
  knotInvariant: boolean;
  degreeInvariant: boolean;
}

/** 保形误差核验（独立采样点） */
export interface ShapeVerification {
  sampleCount: number;
  samplesExcludeKnots: boolean;
  maxPointError: number;
  maxDerivativeError: number;
  worstPointSampleU: number;
  worstDerivativeSampleU: number;
  nonDifferentiableSampleCount: number;
  passed: boolean;
  pointTolerance: number;
  derivativeTolerance: number;
}

/** 节点插入结果 */
export interface RefinementResult {
  newVersion: number;
  comparison: StructureComparison;
  verification: ShapeVerification;
}

/** 弧长积分结果 */
export interface ArcLengthResult {
  curveId: number;
  version: number;
  rangeStart: number;
  rangeEnd: number;
  arcLength: number;
  tolerance: number;
  subdivisions: number;
  evaluations: number;
  stopReason:
    | "tolerance-met"
    | "budget-exhausted"
    | "degenerate";
  toleranceAchieved: boolean;
  estimatedError: number;
}

/** 带字段定位的校验错误 */
export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}
