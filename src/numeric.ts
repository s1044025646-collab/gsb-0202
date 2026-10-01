/** 数值工具：不依赖任何第三方数学库。 */

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export function arraysEqual(a: number[], b: number[], tol = 0): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tol) return false;
  }
  return true;
}

export function maxAbsDiff(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

export function vectorNorm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

/**
 * 在区间 [a,b] 内生成 n 个与节点向量无关的确定性“独立采样点”。
 * 使用有理数网格 + 黄金比例抖动的确定性序列，且刻意避开给定点集
 * （即原节点向量），保证核验不是只在新增/原有节点处比较。
 */
export function independentSamples(
  a: number,
  b: number,
  n: number,
  exclude: number[],
): number[] {
  if (!(b > a)) return [];
  const excludeSorted = [...new Set(exclude)].sort((x, y) => x - y);
  const golden = 0.6180339887498949;
  const out: number[] = [];
  let i = 0;
  let guard = 0;
  while (out.length < n && guard < n * 200) {
    guard++;
    // 确定性低差异序列（van der Corput 风格混合黄金比例）
    const k = i + 1;
    let h = 0;
    let f = 0.5;
    let kk = k;
    while (kk > 0) {
      h += (kk & 1) * f;
      kk >>= 1;
      f *= 0.5;
    }
    const frac = (h + golden * k) % 1;
    i++;
    const u = a + frac * (b - a);
    if (excludeSorted.some((kv) => Math.abs(kv - u) < 1e-9 * Math.max(1, Math.abs(b - a)))) {
      continue;
    }
    out.push(u);
  }
  return out;
}
