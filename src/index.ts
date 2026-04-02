import path from 'path';

import { buildApp, loadDotEnvFileIfPresent } from './app';

async function main(): Promise<void> {
  const envFilePath = process.env.ENV_FILE_PATH
    ? path.resolve(process.env.ENV_FILE_PATH)
    : path.join(process.cwd(), '.env');

  loadDotEnvFileIfPresent(envFilePath);

  const port = Number(process.env.PORT || 8080);
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
