import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import angular from '@angular-eslint/eslint-plugin';
import angularTemplate from '@angular-eslint/eslint-plugin-template';
import angularTemplateParser from '@angular-eslint/template-parser';

export default tseslint.config(
    {
        ignores: [
            'node_modules/**',
            'app/client/build/**',
            '.angular/**',
            'test-results/**',
            'dist/**'
        ]
    },
    {
        files: [
            'app/client/**/*.js',
            'app/client/**/*.cjs',
            'app/client/**/*.mjs',
            'scripts/*.mjs',
            '*.mjs'
        ],
        extends: [js.configs.recommended],
        languageOptions: { globals: { ...globals.browser, ...globals.node, chrome: 'readonly' } },
        rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] }
    },
    {
        files: ['app/client/**/*.ts'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        plugins: { '@angular-eslint': angular },
        rules: {
            ...angular.configs.recommended.rules,
            '@typescript-eslint/consistent-type-imports': 'error'
        }
    },
    {
        files: ['app/client/**/*.component.html'],
        languageOptions: { parser: angularTemplateParser },
        plugins: { '@angular-eslint/template': angularTemplate },
        rules: angularTemplate.configs.recommended.rules
    }
);
