import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * The only rule this config enforces is `react-hooks/rules-of-hooks`, and it is
 * here because a single violation blanked the live site.
 *
 * A `useCallback` was added below four early returns in `Shell` — the loading,
 * signed-out and onboarding paths. Nothing caught it:
 *
 *   - tsc passes. It is valid TypeScript.
 *   - The smoke tests render signed-out only, and that path returns before the
 *     hook, so the hook counts still matched.
 *   - The build passes. It is a runtime error, not a compile error.
 *
 * The moment a real player signed in, the signed-in path called 17 hooks where
 * the previous render called 16, React threw "Rendered more hooks than during
 * the previous render", and the page went blank with only the background left.
 *
 * `exhaustive-deps` is deliberately a warning, not an error: the codebase has
 * pre-existing ones, and failing the build on them would make the gate noisy
 * enough to ignore — which is how the error above would have been missed again.
 */
export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
