import { readFile } from 'node:fs/promises';
import { html } from 'hono/html';

type Entry = { file: string; css?: string[] };

export async function loadShell() {
  const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8')) as Record<string, Entry>;
  const entry = manifest['frontend/main.tsx'];
  if (!entry?.file) throw new Error('Missing Signoff frontend assets. Run npm run build.');

  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="referrer" content="no-referrer" />
    <meta name="theme-color" content="#f3f1eb" />
    <title>Signoff</title>
    ${(entry.css ?? []).map((file) => html`<link rel="stylesheet" href="/${file}" />`)}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${entry.file}"></script>
  </body>
</html>`;
}
