// Walks every root page/database listed in config.json, recursively pulls
// all text content (following nested sub-pages, child databases, and table
// cells), and writes it to public/search-index.json for the static search
// page to load.
//
// Deliberately does NOT use /v1/search to discover pages — Notion's docs
// say that endpoint isn't guaranteed to return everything. Instead it walks
// the block tree from roots you've explicitly shared, which is reliable
// because sharing a page with the integration cascades to all of its
// descendants.
import { Client, APIErrorCode } from "@notionhq/client";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const token = process.env.NOTION_TOKEN;
if (!token) {
  console.error("Set NOTION_TOKEN before running this script.");
  process.exit(1);
}

const notion = new Client({ auth: token });

const config = JSON.parse(
  readFileSync(path.join(__dirname, "config.json"), "utf8")
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimited =
        err.code === APIErrorCode.RateLimited || err.status === 429;
      if (isRateLimited && attempt < 4) {
        const retryAfter = Number(err.headers?.["retry-after"]) || 1;
        console.warn(`Rate limited, waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exceeded retries");
}

function getPlainText(richText) {
  return (richText || []).map((t) => t.plain_text).join("");
}

function getPageTitle(page) {
  const titleProp = Object.values(page.properties || {}).find(
    (p) => p.type === "title"
  );
  return titleProp ? getPlainText(titleProp.title) || "Untitled" : "Untitled";
}

async function fetchAllBlockChildren(blockId) {
  let results = [];
  let cursor;
  do {
    const res = await withRetry(() =>
      notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      })
    );
    results = results.concat(res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
    await sleep(120);
  } while (cursor);
  return results;
}

// Extracts text from a block list into textParts, and pushes any nested
// pages/databases it finds onto the work queue instead of inlining them.
async function extractTextFromBlocks(blocks, textParts, queue) {
  for (const block of blocks) {
    if (block.type === "child_page") {
      queue.push({ type: "page", id: block.id });
      continue;
    }
    if (block.type === "child_database") {
      queue.push({ type: "database", id: block.id });
      continue;
    }

    const richText = block[block.type]?.rich_text;
    if (Array.isArray(richText)) {
      const text = getPlainText(richText);
      if (text) textParts.push(text);
    }

    if (block.type === "table_row") {
      for (const cell of block.table_row?.cells || []) {
        const text = getPlainText(cell);
        if (text) textParts.push(text);
      }
    }

    if (block.has_children) {
      const children = await fetchAllBlockChildren(block.id);
      await extractTextFromBlocks(children, textParts, queue);
    }
  }
}

async function main() {
  const queue = [];
  for (const id of config.pages || []) queue.push({ type: "page", id });
  for (const id of config.databases || [])
    queue.push({ type: "database", id });

  if (queue.length === 0) {
    console.error(
      "config.json has no root pages/databases. Run `npm run list-shared` " +
        "and add some IDs first."
    );
    process.exit(1);
  }

  const visitedPages = new Set();
  const pagesOut = [];

  while (queue.length > 0) {
    const item = queue.shift();

    if (item.type === "page") {
      if (visitedPages.has(item.id)) continue;
      visitedPages.add(item.id);

      const page = await withRetry(() =>
        notion.pages.retrieve({ page_id: item.id })
      );
      if (page.archived || page.in_trash) continue;

      const title = getPageTitle(page);
      const blocks = await fetchAllBlockChildren(item.id);
      const textParts = [];
      await extractTextFromBlocks(blocks, textParts, queue);

      pagesOut.push({
        id: page.id,
        title,
        url: page.url,
        text: textParts.join("\n"),
      });
      console.log(`Indexed page: ${title}`);
    } else {
      let cursor;
      do {
        const res = await withRetry(() =>
          notion.databases.query({
            database_id: item.id,
            start_cursor: cursor,
            page_size: 100,
          })
        );
        for (const row of res.results) {
          queue.push({ type: "page", id: row.id });
        }
        cursor = res.has_more ? res.next_cursor : undefined;
        await sleep(120);
      } while (cursor);
    }
  }

  const outDir = path.join(__dirname, "public");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "search-index.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      pages: pagesOut,
    })
  );

  console.log(`\nDone. Indexed ${pagesOut.length} page(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
