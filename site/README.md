# Dispatch landing page

`index.html` is a single self-contained static page. It is published at https://taikunai.com/dispatch from the TaikunWebsite repo (`dispatch/index.html` there, deployed by its S3 + CloudFront workflow). This copy is the source; when it changes, copy it across and open a PR on TaikunWebsite.

The Download and GitHub links come from the two constants at the bottom of `index.html`. Point `DOWNLOAD_URL` at a `.dmg` asset on GitHub Releases once a release exists; until then it opens the latest release page.
