import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";

//import webExtension from "vite-plugin-web-extension";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "inline-content-script",
      closeBundle() {
        try {
          // Inline the types import in content.js
          const contentPath = resolve(__dirname, "dist/content.js");
          let content = readFileSync(contentPath, "utf-8");

          // Find the import statement and extract the imported variable name
          const importMatch = content.match(/import\{([A-Z])\s+as\s+([a-z])\}from"([^"]+)";/);
          if (importMatch) {
            const importedName = importMatch[1]; // e.g., "C"
            const localName = importMatch[2]; // e.g., "a"
            const importPath = importMatch[3];
            const fullImportPath = resolve(__dirname, "dist", importPath);

            // Read the imported file
            const importedContent = readFileSync(fullImportPath, "utf-8");

            // Find which variable is exported as importedName
            // Format: export{S as B,T as C,A as R,G as a};
            const exportPattern = new RegExp(`([A-Z])\\s+as\\s+${importedName}[,}]`);
            const exportMatch = importedContent.match(exportPattern);

            if (exportMatch) {
              const actualVarName = exportMatch[1]; // e.g., "T"

              // Inline the content and replace the actual variable name with local name
              let inlinedContent = importedContent.replace(/export\{[^}]+\};?/, '');
              // Replace both "var T=" and ",T=" patterns
              inlinedContent = inlinedContent.replace(new RegExp(`([,\\s])${actualVarName}=`, 'g'), `$1${localName}=`);
              // Also replace references like (T||{})
              inlinedContent = inlinedContent.replace(new RegExp(`\\(${actualVarName}\\|\\|`, 'g'), `(${localName}||`);

              // Replace the import with the inlined content
              content = content.replace(importMatch[0], inlinedContent);

              writeFileSync(contentPath, content);
              console.log("Inlined imports in content.js");
            }
          }
        } catch (e) {
          console.error("Failed to inline content script:", e);
        }
      },
    },
    {
      name: "post-build",
      closeBundle() {
        try {
          const source = resolve(__dirname, "dist/src/sidebar/index.html");
          const dest = resolve(__dirname, "dist/sidebar.html");
          const srcDir = resolve(__dirname, "dist/src");
          let html = readFileSync(source, "utf-8");

          html = html.replace(/src="\/assets\//g, 'src="./assets/');
          html = html.replace(/href="\/assets\//g, 'href="./assets/');

          writeFileSync(dest, html);
          rmSync(srcDir, { recursive: true, force: true });

          console.log(
            "Moved sidebar.html to dist root and cleaned up src directory"
          );
        } catch (e) {
          console.error("Failed to move sidebar.html:", e);
        }
      },
    },
  ],
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidebar: resolve(__dirname, "src/sidebar/index.html"),
        background: resolve(__dirname, "src/background/background.ts"),
        content: resolve(__dirname, "src/content/content.ts"),
        "page-bootstrap": resolve(__dirname, "src/webmcp/page-bootstrap.ts"),
        "content-bridge": resolve(__dirname, "src/webmcp/content-bridge.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (
            chunkInfo.name === "background" ||
            chunkInfo.name === "content" ||
            chunkInfo.name === "page-bootstrap" ||
            chunkInfo.name === "content-bridge"
          ) {
            return "[name].js";
          }
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
        // Prevent code splitting for content scripts (they must be self-contained)
        manualChunks: (id) => {
          if (
            id.includes("src/content") ||
            id.includes("src/shared") ||
            id.includes("src/webmcp") ||
            id.includes("@mcp-b/webmcp-polyfill") ||
            id.includes("@cfworker/json-schema") ||
            id.includes("@standard-schema/spec")
          ) {
            return undefined;
          }
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
});
