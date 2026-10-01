# NURBS 曲线求值与保形节点细化后端

纯后端离线计算服务，实现二维/三维**有理 B 样条（NURBS）曲线**的求值、切向、
节点插入细化、自适应弧长积分与版本管理。提供 **HTTP JSON API** 与 **CLI**，
使用 **TypeScript + Node.js（内置 `node:sqlite`）**，无任何第三方 NURBS 库、
无曲面/CAD/绘图/实体建模功能。

在 Windows 本地直接运行，**不依赖 Docker、WSL、付费服务或外部在线 API**。

## 功能范围

- 次数 **1–5** 的**夹持（clamped）**曲线：端点节点重数恰为 `p+1`，内部节点重数不超过 `p`。
- 控制点 **2 维或 3 维**（维数必须一致），权重严格为正，节点非递减。
- 校验错误定位到**具体字段**，如 `knots[7]`、`weights[3]`、`controlPoints[2][1]`。
- 自实现 **Cox–de Boor 基函数三角递推**与一阶导数；通过齐次控制点 `Pw=(wP, w)` 正确处理权重。
- 求值返回**曲线点、一阶导数、可微性状态**。
- **单节点 / 批量节点插入**：几何与参数化不变，返回结构对照与保形误差核验。
- **自适应 Simpson 弧长积分**：记录容差、细分次数、求值次数、估计误差与停止原因。
- SQLite **冻结曲线版本与计算报告**，重启后可按原版本复核。

## 数学约定（重要）

- 有效参数区间：`[U[0], U[m-1]]`（夹持时通常为 `[0,1]`，但不强制归一化）。
- **端点**：左端点只给右导数（`right-only`），右端点只给左导数（`left-only`）。
- **内部节点**：在节点处分别对**右支集**和**左支集**精确求值。
  - 左右导数相等 → `derivative-exists`（可微，给出统一导数）；
  - 左右导数不等 → `non-differentiable`，`derivative` 为 `null`，同时给出左右导数；
  - 全程使用严格/非严格不等式区分左右，**不使用固定微小位移（epsilon）掩盖问题**。
- **零长度节点区间**：基函数递推中分母为 0 的项按标准约定系数取 0，不做除法、不平移。
  基函数分区统一性 `ΣN=1` 已在重复节点上测试。
- 权重是**真实几何参数**：不同权重产生不同曲线；权重统一缩放不改变点与导数（已测试）。

## 节点插入

基于齐次控制点的 B 样条插入公式（Piegl–Tiller 单节点插入的直接实现），
正确处理插入点已存在（重数 `s>0`）的情形。

- 只能在开区间 `(U[0], U[m-1])` 内插入；插入端点一律拒绝。
- 节点重数达到 `p` 后再次插入拒绝（插入后内部重数不得超过 `p`）。
- 批量插入先**逐步预演**，任一步非法整体拒绝；持久化时在**单个 SQLite 事务**内完成，
  失败即 `ROLLBACK`，**绝不留下半个新版本**。
- **保形核验在独立采样点上执行**：采样点由确定性低差异序列生成，
  并**刻意避开插入前后的全部节点**，比较曲线点与可微处一阶导数；
  不是只比较新增节点处的值。

## 弧长积分

`L = ∫ |C'(u)| du`，自适应 Simpson + Richardson 误差估计：

- 以内部节点为初始分段，零长度区间自动跳过；
- 收敛标准 `|S_L+S_R-S|/15 ≤ 局部容差`；
- 达到细分预算仍未收敛：保留当前近似值，`stopReason="budget-exhausted"`、
  `toleranceAchieved=false`；
- 不使用控制多边形长度代替曲线弧长。

## 环境要求

- Node.js **≥ 22.5**（内置 `node:sqlite`；开发与验证使用 Node v25.5）。
- Windows 自带 PowerShell / cmd 即可。

## 构建、测试、启动、演示

```bat
npm install
npm run build
npm test
npm run demo
npm start
```

- `npm run build`：TypeScript 编译到 `dist/`。
- `npm test`：运行 84 项断言（直线、二次曲线、四分之一单位圆、重复节点/不可微点、
  三维曲线、节点插入保形、权重不变性、差分导数检查、SQLite 版本/事务/重启复核、积分预算）。
- `npm run demo`：端到端脚本，演示圆弧细化、结构对照、几何核验、
  非法插入事务回滚、重启后读取旧报告。
- `npm start`：启动 HTTP 服务。

配置（环境变量）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` 或 `NURBS_PORT` | `3000` | HTTP 端口 |
| `NURBS_DATA_DIR` | `./data` | SQLite 数据目录（项目内，自动创建） |

启动示例（PowerShell）：

```powershell
$env:PORT="3210"; $env:NURBS_DATA_DIR="$PWD\data"; npm start
```

## HTTP API

所有请求/响应均为 JSON（导出接口除外）。非法曲线返回 `422` 与字段级错误数组。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/api/constants` | 次数范围、控制点上限 |
| GET  | `/api/curves` | 曲线列表 |
| POST | `/api/curves` | 导入曲线（冻结为 v1） |
| GET  | `/api/curves/:id?version=N` | 元数据（有效参数区间、节点、权重…） |
| GET  | `/api/curves/:id/versions` | 版本列表 |
| POST | `/api/curves/:id/evaluate` | 批量求值，body `{us:[...]}` 或 `{u}` |
| POST | `/api/curves/:id/tangent` | 切向，body `{u, side}` |
| POST | `/api/curves/:id/refine` | 节点细化，body `{knots:[...]}`（事务） |
| POST | `/api/curves/:id/arc-length` | 弧长，body `{tolerance,maxSubdivisions,rangeStart,rangeEnd}` |
| POST | `/api/curves/:id/compare` | 版本比较，body `{v1,v2}` |
| GET  | `/api/curves/:id/export?format=json|csv&version=N` | JSON / CSV 导出 |
| GET  | `/api/reports?curveId=` | 报告列表 |
| GET  | `/api/reports/:id` | 读取冻结的历史报告 |

导入 body 示例：见 `examples/quarter-circle.json`。

```powershell
Invoke-RestMethod http://localhost:3000/api/curves -Method Post -ContentType 'application/json' -InFile examples/quarter-circle.json
```

## CLI

```bat
node dist/cli.js help
node dist/cli.js import examples/quarter-circle.json
node dist/cli.js list
node dist/cli.js meta 1
node dist/cli.js eval 1 0,0.25,0.5,1
node dist/cli.js tangent 1 0.5
node dist/cli.js refine 1 0.25,0.5,0.75
node dist/cli.js arclength 1 --tol 1e-9
node dist/cli.js compare 1 1 2
node dist/cli.js reports
node dist/cli.js report 1
node dist/cli.js export 1 2 json > curve-v2.json
node dist/cli.js export 1 2 csv  > curve-v2.csv
```

Windows 冒烟脚本：`scripts\smoke-cli.cmd`。

## 目录结构

```
src/
  types.ts       数据结构与常量
  numeric.ts     数值工具与独立采样点生成
  validate.ts    字段级校验、参数区间、节点重数
  basis.ts       Cox–de Boor 基函数与一阶导数、span（左右侧）
  eval.ts        齐次坐标有理求值、可微性判定、切向
  refine.ts      节点插入、批量事务预演、独立采样保形核验
  arclength.ts   自适应 Simpson 弧长
  db.ts          SQLite 版本与报告存储（事务）
  service.ts     业务编排
  server.ts      HTTP API
  cli.ts         CLI
  demo.ts        端到端演示
  test/          测试
examples/        示例曲线 JSON
scripts/         Windows 冒烟脚本
```

## 合理假设与限制

- 仅实现曲线（不含曲面、CAD 文件解析、绘图、实体建模）。
- 节点向量支持任意非递减参数区间，不强制 `[0,1]`。
- 不可微判定采用约 `1e-10` 的相对容差比较左右导数（比较的是两侧解析值，非差分）；
  基函数本身不使用 epsilon 平移。
- 弧长在节点处取右速度（单点选择不影响积分结果）。
- `node:sqlite` 在当前 Node 版本标记为实验性，已用 `--no-warnings` 抑制提示；
  数据文件为标准 SQLite，可用其它 SQLite 工具打开。
