import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        mammoth: "readonly",
        XLSX: "readonly",
        JSZip: "readonly",
        docx: "readonly",
        MathJax: "readonly",
        supabase: "readonly",
        ElementSDK: "readonly",
        DataSDK: "readonly",
        tailwind: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
      "no-redeclare": "error"
    }
  }
];
