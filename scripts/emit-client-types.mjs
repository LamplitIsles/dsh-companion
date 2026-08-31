import { mkdir, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await writeFile("dist/client.d.ts", `import type { Context } from "@deepseek-ai/cordis";\nexport declare const name: "dsh-companion";\nexport declare const inject: readonly string[];\nexport declare function apply(ctx: Context): void;\n`, "utf8");
