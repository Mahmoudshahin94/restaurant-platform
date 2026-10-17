import { defineConfig } from 'prisma/config';

// The location hub's SQLite database (schema generated from the cloud schema).
export default defineConfig({
  schema: 'prisma/hub/schema.prisma',
  migrations: { path: 'prisma/hub/migrations' },
});
