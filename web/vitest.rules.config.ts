import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/services/firestore.rules.spec.ts'], fileParallelism: false, reporters: process.env.CI ? ['default', 'github-actions'] : ['default'], testTimeout: 15000, hookTimeout: 30000 } });
