import { cleanEnv, str, port, num } from 'envalid';

export const config = cleanEnv(process.env, {
  // Database
  DATABASE_URL: str({
    desc: 'PostgreSQL connection string',
    default: 'postgresql://bigbrother:bigbrother@localhost:5432/bigbrother',
  }),

  // Server
  PORT: port({ default: 3000 }),
  LOG_LEVEL: str({
    choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
    default: 'info',
  }),

  // Docker
  SANDBOX_IMAGE_NAME: str({ default: 'bigbrother-sandbox' }),
  SANDBOX_TIMEOUT_MS: num({ default: 300000, desc: 'Max time for installer execution (ms)' }),

  // Upload
  MAX_UPLOAD_SIZE_MB: num({ default: 500 }),

  // Storage
  ARTIFACT_STORAGE_PATH: str({ default: './storage/artifacts' }),
});
