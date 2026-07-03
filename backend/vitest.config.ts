import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Faqat manba testlari — dist/ dagi kompilyatsiya nusxalarini yig'maslik
    include: ["src/**/*.test.ts"],
  },
});
