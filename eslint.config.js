import globals from "globals";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: ["dist", "node_modules"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      sourceType: "module",
    },
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    rules: {
      "no-console": "warn",
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  prettier, // disables style rules in ESLint that conflict with Prettier
];
