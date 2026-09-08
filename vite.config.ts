import { defineConfig } from "vite";

// GitHub Pages serves this project from https://<user>.github.io/HardMode/, so
// asset URLs have to be relative: an absolute "/assets/index.css" resolves
// against the domain root and 404s, which is what left the deployed page with
// no stylesheet and no script. Relative paths also keep the same build working
// at a domain root, behind a custom domain, and opened straight off disk.
export default defineConfig({
  base: "./",
});
