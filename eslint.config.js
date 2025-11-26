import prettier from "eslint-config-prettier";

export default [
  {
    ignores: ["dist", "node_modules"],
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
    },
    rules: {
      // Prettier acts as ESLint rule
      "prettier/prettier": "error",
    },
  },
  prettier, // disables style rules in ESLint that conflict with Prettier
];
