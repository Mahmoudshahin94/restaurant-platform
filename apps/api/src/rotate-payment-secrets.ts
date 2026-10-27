import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PaymentSecretsService, loadConfig } from '@pos/server';
import { createApp } from './bootstrap';

/**
 * Payment secret key rotation (ADR 0024): re-encrypts every provider secret sealed with an older
 * master key under the newest version of `PAYMENT_SECRETS_KEY`. Run it after adding the new key
 * version (and restarting the API with it); afterwards the old versions can be removed.
 *
 *   pnpm --filter @pos/api payment-secrets:rotate
 */
async function main(): Promise<void> {
  const envFile = resolve(__dirname, '../../../.env');
  if (process.env.NODE_ENV !== 'production' && existsSync(envFile)) process.loadEnvFile(envFile);

  const app = await createApp(loadConfig());
  try {
    const result = await app.get(PaymentSecretsService).rotateAll();
    console.log(
      `Payment secrets: ${result.rotated} re-encrypted under key version ${result.currentVersion}` +
        (result.failed > 0 ? `, ${result.failed} could not be opened (see the log)` : ''),
    );
    process.exitCode = result.failed > 0 ? 1 : 0;
  } finally {
    await app.close();
  }
}

void main();
