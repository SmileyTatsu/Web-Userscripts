// Shared by every project in this repo. ESLint searches upward for this file.
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import userscripts from 'eslint-plugin-userscripts';

const gmGlobals = Object.fromEntries(
  [
    'GM',
    'GM_info',
    'GM_getValue',
    'GM_setValue',
    'GM_deleteValue',
    'GM_listValues',
    'GM_addValueChangeListener',
    'GM_removeValueChangeListener',
    'GM_addStyle',
    'GM_addElement',
    'GM_getResourceText',
    'GM_getResourceURL',
    'GM_xmlhttpRequest',
    'GM_download',
    'GM_openInTab',
    'GM_notification',
    'GM_setClipboard',
    'GM_registerMenuCommand',
    'GM_unregisterMenuCommand',
    'GM_log',
    'unsafeWindow',
  ].map((name) => [name, 'readonly']),
);

export default [
  { ignores: ['node_modules/', 'dist/', 'pnpm-lock.yaml'] },

  js.configs.recommended,

  // Userscripts and browser-side code: IIFE + 'use strict', no modules.
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser, ...gmGlobals },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // correctness
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-shadow': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-throw-literal': 'error',
      'no-prototype-builtins': 'error',
      'no-return-assign': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unreachable-loop': 'error',
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
      'require-atomic-updates': 'off',
      // consistency
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
      'no-useless-concat': 'error',
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'no-nested-ternary': 'error',
      'prefer-arrow-callback': 'error',
      curly: ['error', 'multi-line'],
      'dot-notation': 'error',
      // size/complexity (warnings so legacy code can be cleaned gradually)
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],
      // intentionally off: sequential awaits and [tag] logging are normal here
      'no-await-in-loop': 'off',
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Metadata block checks, only for the actual userscripts.
  {
    files: ['**/*.user.js'],
    plugins: { userscripts: { rules: userscripts.rules } },
    settings: { userscriptVersions: { violentmonkey: '*', tampermonkey: '*', greasemonkey: '*' } },
    rules: {
      ...userscripts.configs.recommended.rules,
      'userscripts/filename-user': ['error', 'always'],
      'userscripts/require-name': 'error',
      'userscripts/require-version': 'error',
      'userscripts/require-description': 'error',
    },
  },

  // Node-side config files in the repo root.
  {
    files: ['*.config.js'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },

  // Must stay last: turns off every rule that would fight Prettier.
  prettier,
];
