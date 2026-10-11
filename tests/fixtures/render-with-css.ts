import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Test-only SSR bundling: imported CSS is emitted and returned to the browser,
// rather than ignored by a Node extension hook or replaced with an empty mock.
export async function renderWithCss<T>(entry: URL): Promise<{
  previews: Record<string, T>;
  css: string;
  cssFiles: string[];
}> {
  const requireHere = createRequire(import.meta.url);
  const requireTsx = createRequire(requireHere.resolve("tsx"));
  const requireWeb = createRequire(
    new URL("../../apps/web/package.json", import.meta.url),
  );
  const build = requireTsx("esbuild").build as (
    options: Record<string, unknown>,
  ) => Promise<{
    metafile: {
      inputs: Record<string, unknown>;
      outputs: Record<string, unknown>;
    };
  }>;
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const outputRoot = resolve(root, ".local/e2e-ssr");
  await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(join(outputRoot, "fixture-"));
  try {
    const outfile = join(output, "render.cjs");
    const result = await build({
      absWorkingDir: root,
      stdin: {
        contents: [
          'import "./apps/web/app/style.css";',
          'import "./apps/web/app/product.css";',
          'import "./apps/web/app/brand.css";',
          "export { renderPreviews } from " +
            JSON.stringify(
              "./" + relative(root, fileURLToPath(entry)).replaceAll("\\", "/"),
            ) +
            ";",
        ].join("\n"),
        resolveDir: root,
        sourcefile: "fixture-entry.ts",
        loader: "ts",
      },
      outfile,
      bundle: true,
      platform: "node",
      format: "cjs",
      packages: "external",
      jsx: "automatic",
      alias: {
        react: dirname(requireWeb.resolve("react/package.json")),
        "react-dom": dirname(requireWeb.resolve("react-dom/package.json")),
      },
      metafile: true,
      logLevel: "silent",
    });
    const cssFiles = Object.keys(result.metafile.inputs).filter((file) =>
      file.endsWith(".css"),
    );
    const cssOutputs = Object.keys(result.metafile.outputs).filter((file) =>
      file.endsWith(".css"),
    );
    if (cssFiles.length && !cssOutputs.length)
      throw new Error("FIXTURE_CSS_NOT_EMITTED");
    const css = (
      await Promise.all(
        cssOutputs.map((file) => readFile(resolve(root, file), "utf8")),
      )
    ).join("\n");
    const rendered = requireHere(outfile) as {
      renderPreviews: () => Record<string, T> | Promise<Record<string, T>>;
    };
    const previews = await rendered.renderPreviews();
    delete requireHere.cache[requireHere.resolve(outfile)];
    return { previews, css, cssFiles };
  } finally {
    await removeFixtureOutput(outputRoot, output);
  }
}

async function removeFixtureOutput(outputRoot: string, output: string) {
  const target = resolve(output);
  if (
    !target.startsWith(outputRoot + sep) ||
    dirname(target) !== outputRoot ||
    !basename(target).startsWith("fixture-")
  )
    throw new Error("UNEXPECTED_FIXTURE_OUTPUT");
  await rm(target, { recursive: true, force: true });
}
