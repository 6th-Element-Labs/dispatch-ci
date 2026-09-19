# Dispatch landing page

`index.html` is a single self-contained static page. It deploys to GitHub Pages from `.github/workflows/pages.yml` on every push to `main` that touches `site/`.

To enable hosting once on the public repo: Settings → Pages → Source: **GitHub Actions**.

The Download and GitHub links come from the two constants at the bottom of `index.html`. Point `DOWNLOAD_URL` at a `.dmg` asset once a release exists; until then it opens the latest release page.
