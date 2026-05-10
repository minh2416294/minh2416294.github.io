# SPEC.md — Personal Blog Website

Single source of truth for the website design. No code here — implementation happens in a follow-up session.

---

## 1. Goal & Audience

**Site's job (one sentence):** A personal portfolio + writing site that shows recruiters and technical peers who I am, what I build, and what I think about — primarily through projects, open-source contributions, posts, and independent research.

**Primary goal:** Portfolio for recruiters and clients. Posts and research support the portfolio by demonstrating depth and ongoing learning.

**Audience (in priority order):**
1. **Recruiters & hiring managers** — need a fast read of "who is this person, what have they done, can they write." About page and Projects must be obvious and skimmable.
2. **Peers in the field** — engineers and researchers who'll dig into posts and research. Care about technical depth and correctness.

**Update cadence:** Monthly. Workflow has to be smooth enough not to deter posting, but doesn't need to be optimized for daily writing.

**Timeline for v1:** 1–2 weeks. Comfortable for a custom-styled SSG site with all six sections.

**Biggest failure fear:** "Site looks unprofessional vs other portfolios." → Implication: spend extra time on About page polish, typography, spacing, and the Projects landing.

**Explicit non-goals for v1:**
- No comments
- No newsletter
- No analytics
- No CMS / admin login UI
- No custom domain (free `*.github.io` is fine)
- No public hosting (localhost only for v1)

---

## 2. Content & Site Structure

### Top-level navigation (in this order)

`About | Projects | Contributions | Posts | Research | Tags`

The site logo (top-left) links back to the About page (which is the homepage).

### Homepage

**About me is the homepage.** Visitors land on a short personal intro, then see latest posts below. Recruiter-friendly: who you are first, then evidence.

### Pages & their purpose

| Path | Purpose | Source |
|---|---|---|
| `/` (About) | Short intro, "currently working on", skills/tech stack, profile photo (circle avatar, top-left), social/contact links, then list of latest posts. | `content/_index.md` |
| `/projects/` | Card grid: project title, 1–2 sentence blurb, links (GitHub, demo). | `content/projects/_index.md` + entries |
| `/contributions/` | Manually curated list of merged open-source PRs/issues, each with repo name, what was contributed, and a link. | `content/contributions/_index.md` |
| `/posts/` | Reverse-chronological list of all blog posts with title, excerpt, date, reading time. | `content/posts/*.md` |
| `/posts/<slug>/` | Individual post page. | `content/posts/<slug>/index.md` (page bundle) |
| `/research/` | Reverse-chronological list of independent research write-ups. Same authoring pipeline as posts; separate section. | `content/research/*.md` |
| `/research/<slug>/` | Individual research page. | `content/research/<slug>/index.md` |
| `/tags/` | Tag cloud listing all tags used across posts and research. | Hugo auto-generated |
| `/tags/<tag>/` | Per-tag listing of posts/research with that tag. | Hugo auto-generated |
| `/404.html` | Custom 404 with link back to home. | `layouts/404.html` |

### URL scheme

- Posts: `/posts/<slug>/`
- Research: `/research/<slug>/`
- Projects: `/projects/` (single page; no per-project URLs in v1)
- Tags: `/tags/<tag>/`

No date in URLs (so old posts don't visually age).

### Drafts

Use Hugo's built-in `draft: true` frontmatter flag. Drafts are excluded from the built site by default. To preview, run `hugo server -D`.

### Multi-language

Single language (English). No i18n setup.

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Site type** | Static site generator (SSG) | All content is markdown. No backend needed. Free hosting on GitHub Pages. |
| **Framework** | **Hugo** | Single Go binary, very fast builds, large theme ecosystem. Same stack as the reference site (Lilian Weng). No npm toolchain to maintain. |
| **Theme** | **PaperMod** (pre-built) with light CSS overrides | Closest match to the reference site's look. Saves days of design work. Customize via `params` in `hugo.toml` plus a small `assets/css/extended/` overlay for color/spacing tweaks. |
| **Styling** | Theme defaults + minor CSS overrides | Neutral grayscale palette. No accent color in v1 (decide later if needed). |
| **Markdown flavor** | Hugo's default (Goldmark, GFM-compatible) | Tables, fenced code, autolinks, task lists. |
| **Code highlighting** | Hugo Chroma (compile-time) | Zero JS. Lilian Weng uses the same approach. |
| **Math** | KaTeX, enabled per-post via `math: true` frontmatter | Required for ML/research content. KaTeX is faster and lighter than MathJax. JS only loads on pages that opt in. |
| **Diagrams** | Mermaid, enabled per-post via `mermaid: true` frontmatter | Useful for system/research diagrams. JS only loads on pages that opt in. |
| **Search** | PaperMod's built-in Fuse.js search (`/search/` page) | Client-side fuzzy search over a JSON index built at compile time. No server. Same approach as the reference site. |
| **JS budget** | Zero JS on most pages. KaTeX/Mermaid/search load only where used. | Aligns with the Lighthouse 95+ target. |
| **Repo structure** | Hugo site at the repo root | Standard layout. The placeholder `my-git-project/` folder will be removed. |

### Dependencies (intentionally small)

- Hugo extended (single binary, pinned version)
- PaperMod theme (vendored as a git submodule or `hugo mod`)
- No npm, no build pipeline beyond Hugo itself

---

## 4. Design Direction

**Visual mood:** Minimalist like the reference site. Whitespace, neutral grayscale, content-first. No decorative effects beyond the theme toggle.

**Typography:** System font stack (`-apple-system`, `Segoe UI`, etc.). Zero web-font load time, looks native everywhere. No display font.

**Light/dark mode:** Light, dark, and follow-system, with a toggle in the header (icon next to the site title — same pattern as the reference site). User preference saved in `localStorage`. Initial mode follows system if no preference is set.

**Accent color:** None in v1. Theme defaults (mostly grayscale with subtle link color from PaperMod). Revisit if the design feels too plain.

**Mobile:** Mobile-first, single-column layout on small screens. Equal priority to desktop — recruiters often skim on phones too.

**Header layout:**
- Left: site title (text logo) + theme toggle icon
- Right: nav (`About | Projects | Contributions | Posts | Research | Tags`)

**About page layout (highest-effort page):**
- **Top-left:** circular avatar (placeholder until image is added)
- **Right of avatar:** name + 1-line tagline + 2–4 sentence intro
- Below: "Currently" section (what I'm working on / interested in)
- Below: "Skills / Tech" section (concise list — overlap with Tags is OK; Tags is for content keywords, Skills is for tools)
- Below: row of social/contact icons (GitHub, Email, LinkedIn, Twitter/X)
- Below: "Latest posts" — last 5 posts with title, date, excerpt

**Post / research page layout:**
- Title, date, reading time, author
- Optional table-of-contents toggle (off by default in v1; opt-in per post if needed later)
- Body content
- Back-to-list link at the bottom

**Projects page:**
- Card grid (2 columns desktop, 1 column mobile)
- Each card: project title, 1–2 sentence description, links (GitHub / demo / blog post if related)

**Contributions page:**
- Grouped by repo or chronological — final structure TBD during build, but expect a flat list of items: `repo · short description of what I did · link to merged PR/issue`

---

## 5. Content Authoring Workflow

- **Storage:** Markdown files in the repo, version-controlled with git. Each post is a "page bundle" — a folder containing `index.md` plus any images for that post.
- **Editor:** Either VS Code or Obsidian, both produce plain markdown. No vendor lock-in.
- **Auth model:** Static site has no login. The "admin" is whoever has push access to the GitHub repo — just me. Visitors can only read. No CMS UI on the site.
- **Image storage:** Inside each post's bundle folder. Referenced by relative path in the markdown.
- **Image optimization:** Hugo's built-in image processing (resize + WebP + responsive `srcset`) at build time. No external tools.

### Frontmatter conventions (for posts and research)

```yaml
title: "Post title"
date: 2026-05-10
draft: false
tags: ["tag-a", "tag-b"]
math: false      # set true to load KaTeX on this page
mermaid: false   # set true to load Mermaid on this page
summary: "Optional 1-line summary used on listing pages and OG cards."
```

### Publishing flow

1. Write markdown locally
2. `hugo server -D` to preview (drafts visible)
3. Set `draft: false` when ready
4. `git commit && git push` — that's "publishing"

---

## 6. Features

| Feature | Status | Notes |
|---|---|---|
| Light / dark / system theme toggle | ✅ v1 | Only "effect" on the site |
| Search (Fuse.js, client-side) | ✅ v1 | `/search/` page, indexes posts + research |
| Tag cloud + per-tag pages | ✅ v1 | Hugo auto-generates per-tag pages |
| Reading time on posts | ✅ v1 | Hugo auto-calculates |
| Code syntax highlighting (Chroma) | ✅ v1 | Compile-time, zero JS |
| KaTeX math (opt-in per page) | ✅ v1 | For research/posts with equations |
| Mermaid diagrams (opt-in per page) | ✅ v1 | For system/flow diagrams |
| Custom 404 page | ✅ v1 | Simple, matches site style |
| RSS / Atom feed | ❌ v1 (deferred) | Hugo can generate for free; not in v1 since not requested |
| Archive page | ❌ v1 (deferred) | Could add later if Posts list becomes long |
| Table of contents on long posts | ❌ v1 (deferred) | Easy to enable per-post via frontmatter later |
| Comments | ❌ v1 (skipped) | None — readers can email |
| Newsletter | ❌ v1 (skipped) | None |
| Analytics | ❌ v1 (skipped) | None |

---

## 7. SEO & Metadata

- **Per-post:** `title`, `summary` (description), canonical URL — auto-generated from frontmatter and Hugo's URL scheme.
- **Open Graph / Twitter cards:** Auto-generated by PaperMod from frontmatter. Default OG image: a single site-wide image (decide image later) or PaperMod's per-post text-on-color generation. No hand-crafted OG images per post in v1.
- **Sitemap:** `sitemap.xml` auto-generated by Hugo.
- **robots.txt:** Default permissive, allow all crawlers.
- **Structured data / JSON-LD:** PaperMod ships with article JSON-LD by default. Leave on.
- **Custom 404:** Yes — links back to home, brief message in site style.

---

## 8. Performance Budget

- **Lighthouse target:** 95+ on all four categories (Performance, Accessibility, Best Practices, SEO) for the homepage and a typical post.
- **JS budget:** Zero JS on the About page. Search/KaTeX/Mermaid load only on pages that need them.
- **Fonts:** System fonts only — zero font loading.
- **Images:** Lazy-loaded, responsive `srcset`, WebP via Hugo image processing.

---

## 9. Hosting & Deployment

### v1 (current)

- **Local only.** Run via `hugo server` on `localhost:1313`.
- No public deployment yet.

### v2 (planned, not in scope for v1)

- **Host:** GitHub Pages (free, integrates with the repo).
- **URL:** `<username>.github.io` subdomain (no custom domain).
- **CI/CD:** GitHub Actions workflow — build with Hugo on push to `main`, deploy to the `gh-pages` branch (or use the official Pages action).
- **HTTPS:** Auto via GitHub Pages.
- **Build secrets:** None expected (no analytics, no CMS, no API keys).

---

## 10. Maintenance Plan

- **Backup:** Git history is the backup. Repo is the canonical store.
- **Dead-link checking:** Manual for v1. Could add a CI step (e.g., Linkinator) later.
- **Dependency updates:**
  - Hugo binary: pinned in CI, update manually when needed.
  - PaperMod theme: pinned via git submodule or `hugo mod` — update manually a few times a year.
  - No npm dependencies → very low maintenance burden.
- **Designed-around risk ("looks unprofessional"):**
  - About page gets extra design polish.
  - Typography spacing reviewed against reference sites before v1 ships.
  - Clean, generous whitespace > clever layouts.

---

## 11. Implementation Order

Suggested order for the build session that follows this spec:

1. **Repo cleanup** — remove placeholder `my-git-project/` and `story.txt`. Add `.gitignore` for Hugo (`public/`, `resources/`, `.hugo_build.lock`).
2. **Hugo skeleton** — `hugo new site .` (in-place), pin Hugo version (e.g., a `.hugo-version` file or a note in README).
3. **Add PaperMod** as a git submodule under `themes/PaperMod`.
4. **`hugo.toml` config** — site title, params for theme toggle, nav menu order (`About | Projects | Contributions | Posts | Research | Tags`), search enabled, social icons.
5. **Section scaffolds** — create `content/_index.md` (About / homepage), `content/projects/_index.md`, `content/contributions/_index.md`, `content/research/_index.md`, plus a `posts/` folder.
6. **About page layout** — custom layout override for the homepage so it shows: avatar (circle, top-left) + intro + currently + skills + social + latest posts.
7. **Projects page layout** — card grid layout override.
8. **Contributions page layout** — list layout override.
9. **First seed content** — one example post (with code block + math + mermaid to verify everything renders), one example project card, one example contribution entry, draft About copy.
10. **CSS overrides** — small tweaks in `assets/css/extended/` for typography/spacing if needed.
11. **404 page** — `layouts/404.html`.
12. **Local verification** — `hugo server`, walk through every page, run Lighthouse on `/` and the example post. Confirm 95+.
13. **README** — short instructions for running locally, writing posts, publishing.

---

## 12. Open Questions

These don't block v1 but should be answered before they matter:

1. **GitHub username** for the eventual `*.github.io` URL — not needed until v2 deploy.
2. **Default OG image** — provide one site-wide image, or accept PaperMod's auto-generated text-on-color cards? Decide before v2 deploy.
3. **Profile photo for About** — placeholder until provided. Format: square image, will be displayed as a circle.
4. **Accent color** — leaving as theme default (grayscale + theme link color). Revisit if the site feels too plain after v1 is up.
5. **Archive page / RSS feed / TOC** — easy to add later if needed; deliberately deferred for a leaner v1.
6. **Per-project pages** — Projects v1 is a single card-grid page. If a project warrants a deep write-up later, it can either become a regular post or get its own `/projects/<slug>/` page.

---

## Handoff

- **Spec location:** `docs/SPEC.md` (this file).
- **Working directory for build:** repo root (`C:\Users\admin\Personal Blog\.claude\worktrees\thirsty-zhukovsky-b143d0`).
- **Next step:** Use the writing/executing-plans skill (or just hand this spec to the build session) to produce a `PLAN.md` with concrete tasks and exact commands.
