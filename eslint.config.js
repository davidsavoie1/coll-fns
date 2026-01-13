import globals from "globals";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      sourceType: "module",
    },
  },
  {
    files: ["src/**/*.js"],
    rules: {
      "no-console": "warn",
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    ignores: ["dist", "node_modules"],
  },
  prettier, // disables style rules in ESLint that conflict with Prettier
];
