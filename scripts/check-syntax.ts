/**
 * TypeScript syntax validation using Bun's transpiler.
 * Mirrors the pre-commit check in src/safe-commit.ts.
 * Used by CI and can be run locally: bun scripts/check-syntax.ts
 */
const transpiler = new Bun.Transpiler({ loader: "ts" });
const errors: string[] = [];
let count = 0;

for (const pattern of ["src/**/*.ts", "skills/**/*.ts"]) {
  for await (const file of new Bun.Glob(pattern).scan(".")) {
    count++;
    try {
      const content = await Bun.file(file).text();
      transpiler.transformSync(content);
    } catch (err) {
      errors.push(`${file}: ${err}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Syntax errors in ${errors.length}/${count} files:`);
  errors.forEach((e) => console.error(`  ${e}`));
  process.exit(1);
} else {
  console.log(`${count} TypeScript files pass syntax validation`);
}
