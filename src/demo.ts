import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "./db";
import { NurbsService, ServiceError } from "./service";

function heading(s: string) {
  console.log("\n" + "=".repeat(72));
  console.log(s);
  console.log("=".repeat(72));
}

function main() {
  const dir = path.join(process.cwd(), "data-demo");
  fs.rmSync(dir, { recursive: true, force: true });
  const store = new Store(dir);
  const svc = new NurbsService(store);

  heading("常量与限制");
  console.log(svc.constants());

  heading("1) 导入四分之一单位圆（有理二次，权重 [1, √2/2, 1]）");
  const imp = svc.importCurve({
    name: "quarter-circle",
    degree: 2,
    controlPoints: [
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    weights: [1, Math.SQRT1_2, 1],
    knots: [0, 0, 0, 1, 1, 1],
  });
  const curveId = imp.curveId;
  console.log(`curveId=${curveId}, version=${imp.version}`);
  console.log("有效参数区间:", svc.metadata(curveId).parameterDomain);

  heading("2) 批量求值：端点插值、单位圆半径、切向正交性");
  const batch = svc.batchEvaluate(curveId, [0, 0.25, 0.5, 0.75, 1]);
  for (const r of batch.results) {
    const radius = Math.hypot(r.point[0], r.point[1]);
    const d = r.derivative
      ? `(${r.derivative.map((x) => x.toFixed(6)).join(", ")})`
      : `左(${r.sideDerivatives.left?.map((x) => x.toFixed(4)).join(",")}) 右(${r.sideDerivatives.right?.map((x) => x.toFixed(4)).join(",")})`;
    console.log(
      `u=${r.u.toFixed(2)}  点=(${r.point.map((x) => x.toFixed(8)).join(", ")})  r=${radius.toFixed(10)}  [${r.differentiability}]  导数=${d}`,
    );
  }

  heading("3) 自适应弧长（应为 π/2 ≈ 1.5707963268）");
  const al = svc.arcLength(curveId, { tolerance: 1e-10 });
  console.log({
    arcLength: al.arcLength,
    piOver2: Math.PI / 2,
    tolerance: al.tolerance,
    subdivisions: al.subdivisions,
    evaluations: al.evaluations,
    estimatedError: al.estimatedError,
    stopReason: al.stopReason,
    toleranceAchieved: al.toleranceAchieved,
  });

  heading("4) 节点细化：在 0.25/0.5/0.75 插入节点（事务）");
  const ref = svc.refine(curveId, [0.25, 0.5, 0.75]);
  const { before, after, insertedKnots } = ref.result.comparison;
  const v = ref.result.verification;
  console.log("插入节点:", insertedKnots);
  console.log("细化前: 控制点数 =", before.controlPointCount, " 节点数 =", before.knots.length);
  console.log("  权重:", before.weights.map((x) => x.toFixed(6)).join(", "));
  console.log("  节点:", before.knots.join(", "));
  console.log("细化后: 控制点数 =", after.controlPointCount, " 节点数 =", after.knots.length);
  console.log("  权重:", after.weights.map((x) => x.toFixed(6)).join(", "));
  console.log("  节点:", after.knots.join(", "));
  console.log("保形核验（独立采样点，非节点）:", {
    采样数: v.sampleCount,
    避开节点: v.samplesExcludeKnots,
    最大点误差: v.maxPointError,
    最大导数误差: v.maxDerivativeError,
    通过: v.passed,
  });

  heading("5) 版本比较 v1 vs v2（几何不变）");
  const cmp = svc.compareVersions(curveId, 1, 2);
  console.log(`v${cmp.versions[0]} 控制点数 ${cmp.comparison.before.controlPointCount} -> v${cmp.versions[1]} ${cmp.comparison.after.controlPointCount}`);
  console.log("几何保形核验通过:", cmp.verification.passed,
    " 最大点误差:", cmp.verification.maxPointError,
    " 最大导数误差:", cmp.verification.maxDerivativeError);

  heading("6) 非法插入：0.5 重数已达上限（degree=2），事务回滚演示");
  console.log("尝试在 v2 连续插入 [0.5, 0.5]（第二次非法）...");
  try {
    svc.refine(curveId, [0.5, 0.5]);
    console.log("错误：应当被拒绝！");
  } catch (e) {
    if (e instanceof ServiceError) {
      console.log("已拒绝，HTTP 状态:", e.status);
      console.log("错误信息:", e.message);
      console.log("字段定位:", JSON.stringify(e.fields, null, 2));
    }
  }
  const versionsAfter = svc.listVersions(curveId);
  console.log("回滚后版本列表（仍只有 v1/v2，无 v3）:",
    versionsAfter.map((x) => x.version).join(", "));

  heading("7) 旧报告读取（模拟重启后复核）");
  store.close();
  const store2 = new Store(dir);
  const svc2 = new NurbsService(store2);
  const oldReport = svc2.getReport(batch.reportId!);
  console.log("报告 #", oldReport.id, " 类型:", oldReport.kind, " 生成于:", oldReport.createdAt);
  const frozenList = oldReport.result as any[];
  console.log("冻结的首个结果:", JSON.stringify(frozenList[0], null, 2));
  console.log("列出全部报告:", svc2.listReports(curveId).map((r) => `#${r.id}(${r.kind})`).join(" "));
  store2.close();

  heading("完成");
  console.log("演示数据库目录:", dir);
}

main();
