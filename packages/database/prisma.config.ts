import { defineConfig } from 'prisma/config';

// Environment variables come from the repo-root .env via dotenv-cli in package.json scripts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed.ts',
  },
});
