import { loadConfig } from './config.js';
import { createApp } from './http.js';
import { NurbsService } from '../services/nurbsService.js';
import { Store } from '../storage/db.js';

const config = loadConfig();
const store = new Store(config.dbPath);
const service = new NurbsService(store);
const server = createApp(service);

server.listen(config.port, () => {
  console.log(`[nurbs] HTTP 服务已启动`);
  console.log(`[nurbs] 端口: ${config.port}`);
  console.log(`[nurbs] 数据目录: ${config.dataDir}`);
  console.log(`[nurbs] 数据库: ${config.dbPath}`);
});

const shutdown = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
