import js from '@eslint/js';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.pwa-test/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { window: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
    rules: { eqeqeq: 'error', 'no-var': 'error', 'prefer-const': 'error' },
  },
];
