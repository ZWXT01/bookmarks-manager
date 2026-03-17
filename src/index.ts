import path from 'path';

import fs from 'fs';

import { buildApp } from './app';

function loadDotEnvFileIfPresent(envFilePath: string): void {
  try {
    if (!fs.existsSync(envFilePath)) return;
    const raw = fs.readFileSync(envFilePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!key) continue;
      if (process.env[key] !== undefined) continue;
      let value = trimmed.slice(eq + 1);
      value = value.trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
  }
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT || 8080);
  const envFilePath = path.join(process.cwd(), '.env');
  loadDotEnvFileIfPresent(envFilePath);
  const { app, startBackgroundJobs } = await buildApp({ envFilePath });
  await app.listen({
    port,
    host: '0.0.0.0',
  });

  app.log.info({ port }, 'server started');
  startBackgroundJobs();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
