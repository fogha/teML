// eslint.config.js — flat config. TypeScript sources under src/tests/scripts use
// typescript-eslint's "recommended" (non-type-checked) ruleset; plain .mjs
// examples/scripts get the base JS "recommended" ruleset. Prettier owns
// formatting, so eslint-config-prettier disables any ESLint rule that would
// conflict with it.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".sea/**",
      "coverage/**",
      ".vitest/**",
      "node_modules/**",
      "fixtures/**",
      "tests/teml/snapshots/**",
      "tests/**/__snapshots__/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // A terminal-markup library legitimately matches raw control/escape
    // bytes (ANSI sequences, sanitization of C0 control codes) throughout —
    // that's the domain, not an accident this rule should flag.
    rules: { "no-control-regex": "off" },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-unused-vars": "off",
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  prettier,
);
