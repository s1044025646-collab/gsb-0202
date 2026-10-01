import { report } from "./helpers";
import { runMathTests } from "./math-tests";
import { runDbTests } from "./db-tests";

console.log("NURBS 后端测试\n");
runMathTests();
runDbTests();
report();
