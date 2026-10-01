import { Side } from "./types";

/**
 * 查找参数 u 所在的节点区间下标 i（满足 U[i] <= u < U[i+1]，右端点除外）。
 *
 * side = "right"：取右侧区间，即 U[i] <= u < U[i+1]（节点处取右基函数支集）；
 * side = "left" ：取左侧区间，即 U[i] <  u <= U[i+1]（节点处取左基函数支集）。
 *
 * 不使用任何微小位移：重复节点处左右区间通过严格/非严格不等式直接区分，
 * 零长度区间在基函数递推中按 0/0 -> 0 的标准约定处理。
 */
export function findSpan(
  knots: number[],
  p: number,
  u: number,
  side: Side,
): number {
  const n = knots.length - p - 2; // 最后一个控制点下标
  if (side === "right") {
    if (u >= knots[n + 1]) {
      // 右端点：取最后一个非零长度区间
      let i = n;
      while (i > p && knots[i] === knots[i + 1]) i--;
      return i;
    }
    if (u <= knots[p]) return p;
    let lo = p;
    let hi = n + 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (knots[mid] <= u) lo = mid;
      else hi = mid;
    }
    // 跳过起点重复节点（零长度区间）
    while (lo < n && knots[lo] === knots[lo + 1]) lo++;
    return lo;
  }
  // left：取以 u 为右端点的最后一个非零长度区间
  if (u <= knots[p]) {
    let i = p;
    while (i < n && knots[i] === knots[i + 1]) i++;
    return i;
  }
  if (u >= knots[n + 1]) return n;
  let lo = p;
  let hi = n + 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (knots[mid] < u) lo = mid;
    else hi = mid;
  }
  // lo 满足 U[lo] < u <= U[lo+1]；跳过零长度区间
  while (lo > p && knots[lo] === knots[lo + 1]) lo--;
  return lo;
}

export interface BasisTable {
  span: number;
  /** values[k][j]：次数 k 的局部基函数 B^k_j(u)，长度 k+1 */
  values: number[][];
  /** ders[k][j]：B^k_j 对 u 的一阶导数 */
  ders: number[][];
}

/**
 * 自实现 Cox–de Boor 三角递推，同时得到基函数值与一阶导数。
 *
 *   B^k_j(u) = (U[i+j+1]-u)/(U[i+j+1]-U[i+j-k+1]) * B^{k-1}_j
 *            + (u-U[i+j-k])/(U[i+j]-U[i+j-k])       * B^{k-1}_{j-1}
 *
 * 分母为 0（零长度节点区间）时，对应项的系数按约定取 0，不做除法、
 * 也不用 epsilon 平移。导数由对该式逐项求导得到（非有限差分）。
 */
export function basisTable(knots: number[], p: number, u: number, side: Side): BasisTable {
  const i = findSpan(knots, p, u, side);
  const values: number[][] = Array.from({ length: p + 1 }, () => [0]);
  const ders: number[][] = Array.from({ length: p + 1 }, () => [0]);
  values[0] = [1];
  ders[0] = [0];

  for (let k = 1; k <= p; k++) {
    const v: number[] = new Array(k + 1).fill(0);
    const d: number[] = new Array(k + 1).fill(0);
    for (let j = 0; j <= k; j++) {
      // 第一项：来自 B^{k-1}_j
      if (j <= k - 1) {
        const denom = knots[i + j + 1] - knots[i + j - k + 1];
        if (denom !== 0) {
          const alpha = (knots[i + j + 1] - u) / denom;
          v[j] += alpha * values[k - 1][j];
          d[j] += (-1 / denom) * values[k - 1][j] + alpha * ders[k - 1][j];
        }
      }
      // 第二项：来自 B^{k-1}_{j-1}
      if (j >= 1) {
        const denom2 = knots[i + j] - knots[i + j - k];
        if (denom2 !== 0) {
          const beta = (u - knots[i + j - k]) / denom2;
          v[j] += beta * values[k - 1][j - 1];
          d[j] += (1 / denom2) * values[k - 1][j - 1] + beta * ders[k - 1][j - 1];
        }
      }
    }
    values[k] = v;
    ders[k] = d;
  }
  return { span: i, values, ders };
}
