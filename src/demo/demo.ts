/**
 * 端到端演示（使用临时数据目录，不污染正式数据）：
 * 1) 细化四分之一圆弧并比较控制结构、验证几何不变
 * 2) 触发非法插入，展示事务回滚（旧版本仍可读取）
 * 3) 旧报告在“重启”后仍可读取
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Store } from '../storage/db.js';
import { NurbsService } from '../services/nurbsService.js';
import { makeQuarterCircle, makeRepeatedKnot } from '../core/presets.js';
import { ValidationError } from '../core/types.js';

const dir = join(tmpdir(), 'nurbs-demo-' + Date.now());

function hr(title: string): void {
  console.log('\n================ ' + title + ' ================');
}

function main(): void {
  const dbPath = join(dir, 'demo.sqlite');
  let store = new Store(dbPath);
  let svc = new NurbsService(store);

  hr('1. 导入四分之一单位圆并冻结');
  const circle = svc.importCurve(makeQuarterCircle(), 'quarter-circle');
  console.log('curve id=' + circle.id + ' version=' + circle.version);
  console.log('domain =', svc.domain(circle.id));

  hr('2. 弧长（应≈pi/2）与半径核验');
  const al = svc.arcLength(circle.id, { tolerance: 1e-10 });
  console.log('arcLength =', al.result.arcLength, ' pi/2 =', Math.PI / 2);
  console.log('subdivisions =', al.result.subdivisions, ' stopReason =', al.result.stopReason);
  const mid = svc.evaluate(circle.id, 0.5);
  const p = mid.result.point;
  console.log('C(0.5) =', p, ' radius =', Math.hypot(p[0]!, p[1]!));

  hr('3. 节点细化（插入 0.25/0.5/0.75）并比较控制结构');
  const refined = svc.refine(circle.id, [0.25, 0.5, 0.75]);
  console.log('控制点数:', refined.controlPointCountBefore, '->', refined.controlPointCountAfter);
  console.log('保形核验:', {
    passed: refined.verification.passed,
    samples: refined.verification.sampleCount,
    maxPointError: refined.verification.maxPointError,
    maxDerivativeError: refined.verification.maxDerivativeError,
    strategy: refined.verification.strategy,
  });
  const cmp = svc.compare(circle.id, refined.newCurve.id);
  console.log('版本几何等价:', cmp.geometricallyEquivalent);

  hr('4. 非法插入 -> 事务回滚（0.5 已达次数重数）');
  const beforeCount = svc.store.listCurves().length;
  try {
    // 对已含 0.5 的新版本再插 0.5：二次曲线内部重数上限为 2
    svc.refine(refined.newCurve.id, [0.5]);
    console.error('不应成功');
  } catch (err) {
    if (err instanceof ValidationError) {
      console.log('被拒绝，字段:', err.field);
      console.log('原因:', err.message);
    } else {
      throw err;
    }
  }
  const afterCount = svc.store.listCurves().length;
  console.log('曲线版本数量 回滚前=' + beforeCount + ' 回滚后=' + afterCount + '（应相等）');

  hr('5. 不可微点（重复节点重数=次数）左右导数');
  const rk = svc.importCurve(makeRepeatedKnot(), 'repeated-knot');
  const nd = svc.evaluate(rk.id, 0.5);
  console.log('differentiability =', nd.result.differentiability);
  console.log('left  =', nd.result.leftDerivative);
  console.log('right =', nd.result.rightDerivative);

  const reportId = refined.reportId;
  store.close();

  hr('6. 模拟重启：重新打开数据库读取旧报告与冻结曲线');
  store = new Store(dbPath);
  svc = new NurbsService(store);
  const old = svc.store.getReport(reportId)!;
  console.log('旧报告 kind =', old.kind, ' created_at =', old.created_at);
  console.log('旧报告 result =', old.result_json.slice(0, 220) + '...');
  const verify = svc.verify(refined.newCurve.id);
  console.log('冻结哈希复核 =', verify.ok);
  store.close();

  rmSync(dir, { recursive: true, force: true });
  console.log('\n演示完成，临时数据已清理: ' + dir);
}

main();
