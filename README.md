# Minh's Blog

Personal portfolio + writing site for Tran Binh Minh — projects, posts, research, and open-source contributions. Built as a static site so it stays simple, fast, and version-controlled.

## Stack

- [Hugo](https://gohugo.io) (static site generator) — extended build, version pinned in [`.hugo-version`](.hugo-version).
- [PaperMod](https://github.com/adityatelange/hugo-PaperMod) theme — vendored as a git submodule under `themes/PaperMod`.
- KaTeX (per-page) for math, Mermaid (per-page) for diagrams, Fuse.js (built-in) for client-side search.
- See [`docs/SPEC.md`](docs/SPEC.md) and [`docs/PLAN.md`](docs/PLAN.md) for the design and implementation history.

## Run locally

```bash
git clone --recurse-submodules <repo-url>
cd <repo>
hugo server -D          # -D includes drafts
```

Then open <http://localhost:1313/>.

If you cloned without `--recurse-submodules`, fetch the theme:

```bash
git submodule update --init --recursive
```

## Write a post

```bash
hugo new posts/<slug>/index.md
```

Edit the generated file:

- Set `draft: false` when ready to publish.
- Set `tags: ["..."]`, write a one-line `summary`.
- Set `math: true` to load KaTeX on this page only.
- Set `mermaid: true` to load Mermaid on this page only.

Save — Hugo's live reload picks it up.

## Section conventions

- **`content/posts/<slug>/index.md`** — blog posts (page bundles; drop images alongside the markdown).
- **`content/research/<slug>/index.md`** — independent research write-ups (same shape as posts).
- **`content/projects/_index.md`** — edit the `projects` array in frontmatter to add/edit project cards.
- **`content/contributions/_index.md`** — edit the `contributions` array to add open-source PRs/issues.
- **`content/_index.md`** — About page copy (intro, Currently, Skills).

## Build static site

```bash
hugo --gc --minify
```

Output goes to `public/`. That folder is gitignored.

## Hugo version

The pinned version lives in [`.hugo-version`](.hugo-version). Hugo is generally backward-compatible, but if you hit a build error, install that version (or a later patch with the same minor) from the [Hugo releases page](https://github.com/gohugoio/hugo/releases) — make sure to grab the **extended** build.

## Replace the avatar

Drop a square image at `static/images/avatar.png`. The About page renders it as a circle automatically. If the file is missing, a gray placeholder shows in its place.
