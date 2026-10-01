import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../db";
import { NurbsService, ServiceError } from "../service";
import { arcLength } from "../arclength";
import { evaluate } from "../eval";
import { quarterCircle, validCurve, assert, approx, vectorApprox } from "./helpers";

export function runDbTests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nurbs-test-"));
  const dbPath = path.join(dir, "nurbs.db");

  console.log("== 10. 持久化：冻结版本与重启复核 ==");
  let store = new Store(dir);
  let svc = new NurbsService(store);
  const imported = svc.importCurve(quarterCircle());
  const curveId = imported.curveId;
  const ev1 = svc.batchEvaluate(curveId, [0, 0.5, 1]);
  const reportId = ev1.reportId!;
  const al = svc.arcLength(curveId, { tolerance: 1e-9 });
  const alLen = al.arcLength;

  // 细化产生版本 2
  const ref = svc.refine(curveId, [0.25, 0.5, 0.75]);
  assert(ref.newVersion === 2, "细化产生新版本号 2");
  assert(ref.result.verification.passed, "细化保形核验通过并随报告冻结");

  // 非法插入事务回滚：版本数不增加
  const beforeVersions = svc.listVersions(curveId).length;
  let rolledBack = false;
  try {
    // 0.75 在上一步已插入一次（当前重数 1，degree 2），再插一次到重数 2 合法，第三次非法
    svc.refine(curveId, [0.75, 0.75]);
  } catch (e) {
    rolledBack = e instanceof ServiceError;
  }
  assert(rolledBack, "非法批量细化抛出服务错误");
  const afterVersions = svc.listVersions(curveId).length;
  assert(afterVersions === beforeVersions, "事务回滚后版本数量不变（无半个新版本）");

  store.close();

  // 重启：重新打开同一数据文件
  const store2 = new Store(dir);
  const svc2 = new NurbsService(store2);
  const curves = svc2.listCurves();
  assert(curves.some((c) => c.id === curveId && c.latestVersion === 2), "重启后曲线与版本仍存在");

  const oldReport = svc2.getReport(reportId);
  assert(oldReport.kind === "batch-eval", "可读取重启前的旧求值报告");
  const frozenResults = oldReport.result as ReturnType<typeof evaluate>[];
  const live = frozenResults.map((r) => {
    const e = evaluate(
      svc2.requireVersion(curveId, 1).def,
      r.u,
    );
    return vectorApprox(e.point, r.point, 1e-12);
  });
  assert(live.every(Boolean), "按原版本复核：冻结结果与重新求值完全一致");

  const v2 = svc2.requireVersion(curveId, 2);
  assert(v2.def.knots.length === 9, "版本 2 节点向量长度正确（6+3）");
  assert(v2.def.controlPoints.length === 6, "版本 2 有 6 个控制点");

  // 弧长报告复核
  const reAl = arcLength(v2.def, { tolerance: 1e-9 });
  assert(approx(reAl.arcLength, alLen, 1e-8), "细化前后弧长一致");
  assert(approx(reAl.arcLength, Math.PI / 2, 1e-7), "持久化圆弧长度仍为 π/2");

  // JSON/CSV 导出
  const jsonOut = svc2.exportCurve(curveId, 2, "json");
  const parsed = JSON.parse(jsonOut);
  assert(parsed.controlPoints.length === 6, "JSON 导出包含新版本控制点");
  const csv = svc2.exportCurve(curveId, 2, "csv");
  assert(csv.startsWith("index,x,y,weight,knot"), "CSV 导出表头正确");

  // 非法导入（经服务层）
  let rejected = false;
  try {
    svc2.importCurve({ name: "x", degree: 2, controlPoints: [[0]], weights: [1], knots: [] });
  } catch (e) {
    rejected = e instanceof ServiceError && Array.isArray((e as ServiceError).fields);
  }
  assert(rejected, "非法导入被拒绝且携带字段级错误");

  store2.close();
  assert(fs.existsSync(dbPath), `SQLite 文件位于项目数据目录: ${dbPath}`);

  // 预算耗尽的弧长：保留近似值并明确未达标
  console.log("== 11. 弧长积分预算 ==");
  const c3 = validCurve({
    name: "wiggly",
    degree: 3,
    controlPoints: [
      [0, 0],
      [0.1, 0.3],
      [0.2, -0.3],
      [0.3, 0.3],
      [0.4, -0.3],
      [0.5, 0.3],
      [0.6, 0],
      [0.7, 0.2],
    ],
    weights: [1, 1, 1, 1, 1, 1, 1, 1],
    knots: [0, 0, 0, 0, 0.2, 0.4, 0.6, 0.8, 1, 1, 1, 1],
  });
  const tight = arcLength(c3, { tolerance: 1e-15, maxSubdivisions: 3 });
  assert(tight.stopReason === "budget-exhausted", "极小预算下报告 budget-exhausted");
  assert(tight.toleranceAchieved === false, "明确标记未达到精度要求");
  assert(tight.arcLength > 0, "预算耗尽时仍保留近似弧长");
  const normal = arcLength(c3, { tolerance: 1e-10 });
  assert(normal.toleranceAchieved === true, "正常预算下达到容差");
  assert(approx(tight.arcLength, normal.arcLength, 1e-2), "预算近似值接近收敛值");
}
