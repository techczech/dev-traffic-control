import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          include: ['src/main/**/__tests__/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
        test: {
          name: 'renderer',
          include: ['src/renderer/src/**/__tests__/**/*.test.{ts,tsx}'],
          environment: 'jsdom'
        }
      }
    ]
  }
})
