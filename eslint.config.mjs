import js from '@eslint/js';
import pluginSecurity from 'eslint-plugin-security';
import pluginNoUnsanitized from 'eslint-plugin-no-unsanitized';
import globals from 'globals';

export default [
  // 1. Base Recommended Config
  js.configs.recommended,

  // 2. Global Ignores
  {
    ignores: [
      'node_modules/**',
      'native_host/bin/**',
      'scratch/**',
      '.agents/**',
      'coverage/**',
      '**/*.min.js'
    ]
  },

  // 3. Core JavaScript Rules (Strict Quality & Async Safety)
  {
    plugins: {
      security: pluginSecurity,
      'no-unsanitized': pluginNoUnsanitized
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.webextensions,
        chrome: 'readonly'
      }
    },
    rules: {
      // Security Rules (Lapis 2)
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-require': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'off', // Algorithmic signature deciphering regexes
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'off', // Native host spawns yt-dlp intentionally
      'security/detect-object-injection': 'off', // Too many false positives on maps/arrays
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'off', // Content script SVG icon injections

      // General Code Hygiene & Bug Prevention (Lapis 1 & 3)
      'no-control-regex': 'off', // Intentional Win32 control character sanitization (\x00-\x1F, \x7F-\x9F)
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-undef': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-caller': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-debugger': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-extra-boolean-cast': 'error',
      'no-self-assign': 'error',
      'no-unreachable': 'error',
      'valid-typeof': 'error',
      eqeqeq: ['warn', 'smart'],
      curly: 'off'
    }
  },

  // 4. Content Scripts & Popup (Browser Context)
  {
    files: ['content/**/*.js', 'popup/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: 'readonly'
      }
    }
  },

  // 5. Background Service Worker (Worker Context)
  {
    files: ['background/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.serviceworker,
        ...globals.webextensions,
        chrome: 'readonly'
      }
    }
  },

  // 6. Native Messaging Host (Node.js Context)
  {
    files: ['native_host/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.node,
        Buffer: 'readonly',
        process: 'readonly',
        __dirname: 'readonly'
      }
    }
  },

  // 7. Test Files & Harnesses (Node.js Context with Mock Assertions)
  {
    files: ['test_*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': 'off',
      'security/detect-unsafe-regex': 'off',
      'security/detect-non-literal-regexp': 'off',
      'no-unsanitized/property': 'off'
    }
  }
];
