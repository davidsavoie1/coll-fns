import prettier from "eslint-config-prettier";

export default [
  {
    ignores: ["dist", "node_modules"],
    parserOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
    },
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
    },
    rules: {
      "no-console": "warn",
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  prettier, // disables style rules in ESLint that conflict with Prettier
];
