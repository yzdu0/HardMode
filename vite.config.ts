import { defineConfig } from "vite";

// GitHub Pages serves this project from https://<user>.github.io/HardMode/, so
// asset URLs have to be relative: an absolute "/assets/index.css" resolves
// against the domain root and 404s, which is what left the deployed page with
// no stylesheet and no script. Relative paths also keep the same build working
// at a domain root, behind a custom domain, and opened straight off disk.
export default defineConfig({
  base: "./",

  // Two real pages, not one page with routes. Without this the dev server
  // answers every unknown path with index.html, so a broken link to a second
  // page comes back 200 with the wrong page in it and looks like a link that
  // does nothing — which is exactly how "/hillclimb" hid its missing slash.
  appType: "mpa",
  build: {
    rollupOptions: {
      // Hillclimb is its own page, served at /hillclimb. It is a directory with
      // an index rather than a bare hillclimb.html because both hosts this
      // build targets answer /hillclimb from it, and because the "../assets/…"
      // vite then writes resolves to the shared bundle from every form of the
      // address — with the trailing slash, without it, and from a subpath on
      // GitHub Pages. A flat hillclimb.html only works on one of them.
      input: {
        index: "index.html",
        hillclimb: "hillclimb/index.html",
        hillclimbWorld: "hillclimb/world/index.html",
      },
    },
  },
});
