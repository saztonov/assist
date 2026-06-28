import { defineConfig } from 'tsup';

export default defineConfig({
  // index = публичная поверхность; workflows = изолированный бандл, который worker
  // грузит через `workflowsPath` (deterministic, импортирует @temporalio/workflow).
  entry: ['src/index.ts', 'src/workflows.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
});
