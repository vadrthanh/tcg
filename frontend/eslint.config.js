import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // eslint-plugin-react-hooks v7 flags every setState reached from an effect,
      // including the standard "fetch on mount → setState in .then()" pattern that
      // all of our data pages use (reads hit the backend/RPC inside effects). Until
      // we adopt a query layer (e.g. TanStack Query) that owns fetch state outside
      // effects, this is downgraded to a warning so it stays visible without
      // failing CI. TODO: migrate data fetching to a query hook, then restore error.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
