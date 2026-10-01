/**
 * NURBS 后端核心类型定义。
 */

/** 二维或三维点 / 向量。 */
export type Vec = number[];

/** 带字段定位的校验错误。 */
export class ValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/** 一条有理 B 样条曲线的完整定义。 */
export interface NurbsCurveData {
  /** 曲线名称（可选）。 */
  name?: string;
  /** 次数 p，允许 1..5。 */
  degree: number;
  /**
   * 控制点，长度为 n+1；每个点为二维或三维数组。
   * 所有控制点维数必须一致。 */
  controlPoints: Vec[];
  /** 权重，长度为 n+1，每个值必须严格为正。 */
  weights: number[];
  /**
   * 非递减节点向量，长度为 (n+1)+(p+1)。
   * 夹持曲线：前 p+1 个与后 p+1 个分别等于端点值。
   */
  knots: number[];
}

/** 求值结果：点与一阶导数信息。 */
export interface EvalResult {
  /** 求值参数。 */
  u: number;
  /** 曲线点 C(u)。 */
  point: Vec;
  /**
   * 一阶导数。可微时存在；内部重复节点重数等于次数时不可微，为 null。
   * 端点处取单侧导数（左端点右导、右端点左导）。
   */
  derivative: Vec | null;
  /** 可微性状态。 */
  differentiability:
    | 'differentiable'
    | 'left-endpoint-right-derivative'
    | 'right-endpoint-left-derivative'
    | 'non-differentiable-repeated-knot';
  /** 不可微或显式请求时，提供左、右单侧导数。 */
  leftDerivative?: Vec;
  /** 不可微或显式请求时，提供左、右单侧导数。 */
  rightDerivative?: Vec;
}

/** 节点插入结果。 */
export interface InsertionResult {
  before: NurbsCurveData;
  after: NurbsCurveData;
  /** 实际插入的节点序列（顺序即应用顺序）。 */
  insertedKnots: number[];
  /** 被拒绝的插入（达到允许重数或超出区间），若存在则整个操作回滚。 */
  rejected?: { knot: number; reason: string }[];
  /** 独立采样点上的保形误差核验。 */
  verification: ShapeVerification;
}

/** 独立采样点上的保形核验。 */
export interface ShapeVerification {
  /** 采样点数。 */
  sampleCount: number;
  /** 采样策略：排除被插入节点本身的独立参数。 */
  strategy: string;
  /** 最大位置误差（欧氏范数）。 */
  maxPointError: number;
  /** 最大可微处导数误差。 */
  maxDerivativeError: number;
  /** 发生最大误差处的参数。 */
  worstU: number;
  /** 是否一致（误差 <= 容差）。 */
  passed: boolean;
  tolerance: number;
}

/** 自适应弧长积分结果。 */
export interface ArcLengthResult {
  /** 积分区间。 */
  uStart: number;
  uEnd: number;
  arcLength: number;
  /** 误差容差（绝对，单位与坐标一致）。 */
  tolerance: number;
  /** 实际细分数量（叶子区间数）。 */
  subdivisions: number;
  /** 被积函数求值次数。 */
  evaluations: number;
  /** 停止原因。 */
  stopReason:
    | 'tolerance-met'
    | 'max-subdivisions-budget-exceeded'
    | 'non-differentiable-knot-crossed';
  /** 是否达到要求精度。 */
  toleranceMet: boolean;
}

/** 公开常量。 */
export const LIMITS = {
  MIN_DEGREE: 1,
  MAX_DEGREE: 5,
  /** 控制点数量上限（n+1）。 */
  MAX_CONTROL_POINTS: 10_000,
} as const;
