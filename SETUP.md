# Manual setup steps

These are the platform actions that can't be done in code. Do them after this
branch is merged and deployed.

## 1. Rename the GitHub account & Pages repo → `tranbinhminh`

The `github.io` subdomain is bound to your **username**, so the code change
(`baseURL`) only takes effect once the account itself is renamed.

1. **Settings → Account → Change username** → `tranbinhminh`.
2. Rename the Pages repo `minh2416294.github.io` → **`tranbinhminh.github.io`**
   (repo **Settings → General → Rename**).
3. Push any commit to `main` to trigger the Actions deploy.
4. **Old links don't auto-redirect.** GitHub Pages is the one exception to
   GitHub's auto-redirects. Update your username links on:
   - LinkedIn, X, GitHub profile
   - Anywhere you've shared `minh2416294.github.io`

> Your email stays `minh2416294@gmail.com` (unchanged on purpose).

## 2. Get the site indexed by Google ("Minh's Blog" / "tranbinhminh")

Two things were blocking this; the homepage fix is already in code. You still
need to verify ownership and ask Google to crawl:

1. Go to **[Google Search Console](https://search.google.com/search-console)**.
2. Add a **URL-prefix** property: `https://tranbinhminh.github.io/`.
3. Choose the **HTML file** verification method. Google gives you a file like
   `google1234abcd.html`. **Drop that file into `static/`** in this repo, commit,
   and let it deploy. Then click **Verify**.
   *(Alternative: the HTML-tag method — paste the meta tag and I'll add it to the
   head. The file method is simpler for a static site.)*
4. In Search Console: **Sitemaps → submit `sitemap.xml`**.
5. **URL Inspection** → paste the homepage URL → **Request indexing**.
6. (Optional) **Bing Webmaster Tools** can import everything from Search Console
   in one click.

Indexing takes days to a few weeks — it is not instant.

## 3. Activate the newsletter (Buttondown)

The "Get new posts by email" box at the bottom of every post is wired to
Buttondown but needs your account handle:

1. Create a free account at **[buttondown.com](https://buttondown.com)**
   (free tier covers your first ~100 subscribers).
2. Your username is the part after `buttondown.com/` in your dashboard URL.
3. In **`hugo.toml`**, set:
   ```toml
   [params.newsletter]
     buttondown = "your-username"
   ```
4. Commit + deploy. The box's submit button activates automatically.
   (Until then it renders disabled, so no broken form ships.)

To send a new post to subscribers, write it as an email in Buttondown (or
connect Buttondown's RSS-to-email automation to your site's `/index.xml` feed).
