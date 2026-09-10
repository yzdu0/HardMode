import { defineConfig } from "vite";

// GitHub Pages serves this project from https://<user>.github.io/HardMode/, so
// asset URLs have to be relative: an absolute "/assets/index.css" resolves
// against the domain root and 404s, which is what left the deployed page with
// no stylesheet and no script. Relative paths also keep the same build working
// at a domain root, behind a custom domain, and opened straight off disk.
export default defineConfig({
  base: "./",

  // Real pages, not one page with routes. Without this the dev server
  // answers every unknown path with index.html, so a broken link to a second
  // page comes back 200 with the wrong page in it and looks like a link that
  // does nothing — which is exactly how "/HillClimb" hid its missing slash.
  appType: "mpa",
  build: {
    rollupOptions: {
      // HillClimb is its own page, served at /HillClimb. It is a directory with
      // an index rather than a bare HillClimb.html because both hosts this
      // build targets answer /HillClimb from it, and because the "../assets/…"
      // vite then writes resolves to the shared bundle from every form of the
      // address — with the trailing slash, without it, and from a subpath on
      // GitHub Pages. A flat HillClimb.html only works on one of them.
      input: {
        index: "index.html",
        HillClimb: "HillClimb/index.html",
        HillClimbWorld: "HillClimb/world/index.html",
        about: "about/index.html",
        contact: "contact/index.html",
      },
    },
  },
});
