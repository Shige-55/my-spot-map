import js from '@eslint/js';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.pwa-test/**', '.wrangler/**', '.secrets/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { window: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly',
        Request: 'readonly', Response: 'readonly', Headers: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly' },
    },
    rules: { eqeqeq: 'error', 'no-var': 'error', 'prefer-const': 'error' },
  },
];
