import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  dataDir: string;
  dbPath: string;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? process.env.NURBS_PORT ?? 3000);
  const dataDir = resolve(
    process.env.NURBS_DATA_DIR ?? resolve(process.cwd(), 'data'),
  );
  return {
    port: Number.isFinite(port) ? port : 3000,
    dataDir,
    dbPath: resolve(dataDir, 'nurbs.sqlite'),
  };
}
