# Lyrics search

Substring search over lyrics scattered across Notion pages/databases. No AI,
no database — a script flattens your Notion text into one JSON file, and a
static page searches it in the browser with plain substring matching (so
`"nyasa"` finds `"vinyasa"`).

## How it works

- `sync.js` walks every page/database ID listed in `config.json`, recursively
  follows nested sub-pages and child databases, and writes all the text to
  `public/search-index.json`.
- `public/index.html` is a single static page that loads that JSON and
  filters it client-side with `.includes()` as you type.
- `.github/workflows/sync.yml` runs `sync.js` on a schedule and deploys
  `public/` to GitHub Pages — so the index stays fresh automatically and the
  search page is just a URL you open on Mac, Windows, or iPhone.

It intentionally does **not** use Notion's `/v1/search` to discover your
pages — Notion's own docs say that endpoint isn't guaranteed to return
everything. Instead, you explicitly share a handful of top-level
pages/databases with the integration, and sharing cascades automatically to
everything nested underneath — which `sync.js` then walks.

## One-time setup

### 1. Create a Notion integration

1. Go to https://www.notion.so/my-integrations → **New integration** →
   internal integration, any workspace/name.
2. Copy the **secret token** (starts with `ntn_` or `secret_`).

### 2. Share your lyrics pages with it

For each **top-level** page or database that contains lyrics (or has lyric
pages nested under it): open it in Notion → `•••` menu (top right) →
**Connections** → add your integration.

You only need to do this for top-level items — every page nested underneath
is automatically accessible too.

### 3. Find the IDs to put in `config.json`

```bash
npm install
NOTION_TOKEN=ntn_your_token_here npm run list-shared
```

This prints every page/database currently shared with the integration, e.g.:

```
type      id                                    url                                title
page      1a2b3c4d-...                          https://notion.so/...             Songs
database  5e6f7a8b-...                          https://notion.so/...             Lyric Drafts
```

Copy the relevant `id` values into `config.json`:

```json
{
  "pages": ["1a2b3c4d-..."],
  "databases": ["5e6f7a8b-..."]
}
```

(`/v1/search` can lag or occasionally miss things — double check the list
against your Notion sidebar before trusting it's complete.)

### 4. Test the sync locally

```bash
NOTION_TOKEN=ntn_your_token_here npm run sync
```

This writes `public/search-index.json`. Open `public/index.html` directly in
a browser to try searching (or run `npx serve public` for a proper local
server, since some browsers block `fetch()` on `file://` URLs).

### 5. Push to GitHub and enable Pages

```bash
git add -A
git commit -m "Set up Notion lyrics search"
gh repo create notion-lyrics-search --private --source=. --push
```

Then in the repo on GitHub:

1. **Settings → Secrets and variables → Actions** → New repository secret:
   `NOTION_TOKEN` = your integration token.
2. **Settings → Pages** → Source: **GitHub Actions**.
3. **Actions** tab → run the "Sync Notion lyrics index" workflow once
   manually to confirm it works, then it'll run automatically every 30
   minutes from then on.

Your search page will be live at the URL GitHub Pages shows you
(`https://<you>.github.io/notion-lyrics-search/`).

### 6. Lock it down (recommended)

These are your lyrics — plain GitHub Pages URLs are publicly reachable by
anyone who has the link. Pick one:

- **Cloudflare Access (free)**: put the Pages URL behind Cloudflare and add
  an Access policy restricting it to your email — no code changes needed.
- **GitHub Pro** ($4/mo): private repos on Pro can restrict the Pages site
  itself to people with repo access.
- Skip this if you're comfortable relying on the URL being unguessable/
  unlisted (not real security, just obscurity).

## Ongoing maintenance

- If you create a **new top-level** page for lyrics (not nested under
  something already shared), share it with the integration once — nested
  pages under it then sync automatically.
- Everything else is automatic. Check the **Actions** tab occasionally if a
  run ever fails (usually a token or API-version issue).
