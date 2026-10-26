import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  // .claude/ holds local Claude Code state, including worktrees (full copies of this repo).
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '.claude/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'previews/**/*.ts'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'test/**/*.{ts,mjs}',
      'scripts/**/*.mjs',
      'previews/**/*.mjs',
      'codex-plugin/scripts/**/*.mjs',
      '*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      // Unused values are usually mistakes; a leading underscore marks the intentional ones.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
