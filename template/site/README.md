# site/

The studio's site. `npm run build` makes every page from the studio (its games, music, videos and posts);
anything here wins. The whole list is in `node_modules/@homie-rocks/studio/site/SITE.md`.

| Put it in | What it does |
| --- | --- |
| `theme.json` | The look: `bg`, `fg`, `accent`, `glow` colours, `display` and `text` fonts (`fonts` loads a file from `public/`), `radius`, `mark` (a logo). Or `palette`: neon, dock, gold, acid, ember, orchid, tide, candy. |
| `theme.css` | Extra CSS on every page (restyle anything, the "Made with Homie" footer included). |
| `partials/<name>.html` | A piece of every page: `head`, `header`, `footer`, `home` (a band on Home), `game` (a band on every game's landing), `game-<id>` (on one game's), `post`. |
| `pages/<path>/index.html` | A whole page at `/<path>/`, instead of the generated one (`pages/<id>/index.html` replaces a game's landing) or beside them (`pages/about/index.html`). It may borrow `<!-- homie:style -->`, `<!-- homie:header -->`, `<!-- homie:footer -->`, `<!-- homie:script -->`, and `<!-- homie:schema -->` in its `<head>` (the page's structured data for search engines). A Home of your own (`pages/index.html`) takes the generated hero with `<!-- homie:home-hero -->` (the featured game) or `<!-- homie:home-hero <id> -->` (that game); a game's own hero files are served at `/games/<id>/_landing/<file>` (`wide.jpg`, `tall.jpg`, `wide.mp4`, `tall.mp4`) if a page of yours needs one by address (`/api/games` says each exactly, in `landing.hero`). |
| `public/` | Files served as they are, at the same path (`public/fonts/x.woff2` is `/fonts/x.woff2`). A `robots.txt`, `sitemap.xml` or `llms.txt` here replaces the one the site makes. |

`src/worker.mjs` and `migrations/` are the Worker (its config is `wrangler.jsonc`, at the studio's root); `dist/` is the build (not committed).
