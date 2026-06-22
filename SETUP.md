# Manual setup steps

## Get the site indexed by Google ("Minh's Blog")

Two things were blocking this; both are now handled in code (the old
meta-refresh redirect is gone, replaced by a real landing page, and the Google
verification file is in `static/`). You just need to finish verifying in
Search Console and ask Google to crawl:

1. Go to **[Google Search Console](https://search.google.com/search-console)**.
2. Add a **URL-prefix** property: `https://minh2416294.github.io/`.
3. Choose the **HTML file** verification method, then click **Verify** — the
   verification file (`google5872e006a23c8f8c.html`) already ships in `static/`
   and deploys to the site root, so verification should pass immediately.
4. In Search Console: **Sitemaps → submit `sitemap.xml`**.
5. **URL Inspection** → paste the homepage URL → **Request indexing**.
6. (Optional) **Bing Webmaster Tools** can import everything from Search Console
   in one click.

Indexing takes days to a few weeks — it is not instant.
