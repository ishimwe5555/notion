// One-off helper: lists every page/database your integration currently has
// access to, so you can copy the right IDs into config.json.
//
// Remember: this uses Notion's /v1/search, which is NOT guaranteed to be
// exhaustive. Cross-check the output against your Notion sidebar. Once a
// top-level page/database is in config.json, everything nested under it is
// picked up automatically by sync.js — you don't need to list children here.
import { Client } from "@notionhq/client";

const token = process.env.NOTION_TOKEN;
if (!token) {
  console.error("Set NOTION_TOKEN before running this script.");
  process.exit(1);
}

const notion = new Client({ auth: token });

function getPlainText(richText) {
  return (richText || []).map((t) => t.plain_text).join("");
}

function getTitle(item) {
  if (item.object === "database") {
    return getPlainText(item.title);
  }
  const titleProp = Object.values(item.properties || {}).find(
    (p) => p.type === "title"
  );
  return titleProp ? getPlainText(titleProp.title) : "Untitled";
}

const items = [];
let cursor;
do {
  const res = await notion.search({
    start_cursor: cursor,
    page_size: 100,
  });
  items.push(...res.results);
  cursor = res.has_more ? res.next_cursor : undefined;
} while (cursor);

console.log(`Found ${items.length} item(s) shared with this integration:\n`);
console.log("type\tid\turl\ttitle");
for (const item of items) {
  console.log(`${item.object}\t${item.id}\t${item.url}\t${getTitle(item)}`);
}
