import { EvalResult, NurbsCurveData } from '../core/types.js';

function csvCell(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 求值结果导出为 CSV。 */
export function evalResultsToCsv(results: EvalResult[]): string {
  const dim = results[0]?.point.length ?? 2;
  const header = [
    'u',
    'differentiability',
    ...Array.from({ length: dim }, (_, i) => `point_${'xyz'[i]}`),
    ...Array.from({ length: dim }, (_, i) => `derivative_${'xyz'[i]}`),
    ...Array.from({ length: dim }, (_, i) => `left_derivative_${'xyz'[i]}`),
    ...Array.from({ length: dim }, (_, i) => `right_derivative_${'xyz'[i]}`),
  ];
  const lines = [header.join(',')];
  const pad = (v: number[] | null | undefined): string[] =>
    Array.from({ length: dim }, (_, i) =>
      v && i < v.length ? String(v[i]) : '',
    );
  for (const r of results) {
    lines.push(
      [
        r.u,
        r.differentiability,
        ...r.point.map(String),
        ...pad(r.derivative),
        ...pad(r.leftDerivative),
        ...pad(r.rightDerivative),
      ]
        .map((x) => csvCell(x))
        .join(','),
    );
  }
  return lines.join('\n');
}

/** 曲线结构导出为 JSON。 */
export function curveToJson(c: NurbsCurveData): string {
  return JSON.stringify(c, null, 2);
}

/** 控制点/权重/节点导出为 CSV。 */
export function curveToCsv(c: NurbsCurveData): string {
  const dim = c.controlPoints[0]!.length;
  const lines: string[] = [];
  lines.push(
    [
      'index',
      ...Array.from({ length: dim }, (_, i) => `control_${'xyz'[i]}`),
      'weight',
    ].join(','),
  );
  c.controlPoints.forEach((p, i) => {
    lines.push([i, ...p.map(String), c.weights[i]!].join(','));
  });
  lines.push('');
  lines.push(`degree,${c.degree}`);
  lines.push(`knots,${c.knots.map(csvCell).join(',')}`);
  return lines.join('\n');
}
