#!/usr/bin/env node
// Pulls the latest blog posts from saschb2b.com's RSS feed and injects them
// into README.md between the BLOG-POST-LIST markers. Dependency-free so the
// GitHub Action can run `node scripts/update-blog.mjs` with no install step.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const FEED_URL = process.env.FEED_URL ?? "https://saschb2b.com/en/blog/feed.xml";
const MAX_POSTS = Number(process.env.MAX_POSTS ?? 5);
const README_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "README.md",
);
const START = "<!-- BLOG-POST-LIST:START -->";
const END = "<!-- BLOG-POST-LIST:END -->";

function extractAll(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function extractOne(xml, tag) {
  return extractAll(xml, tag)[0];
}

function stripCdata(value) {
  if (!value) return "";
  const trimmed = value.trim();
  const cdata = trimmed.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1] : trimmed).trim();
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function formatDate(pubDate) {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

async function fetchFeed(url) {
  const res = await fetch(url, { headers: { "user-agent": "saschb2b-readme-bot" } });
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}

function parseItems(xml) {
  return extractAll(xml, "item").map((item) => ({
    title: decodeEntities(stripCdata(extractOne(item, "title"))),
    link: decodeEntities(stripCdata(extractOne(item, "link"))),
    date: stripCdata(extractOne(item, "pubDate")),
  }));
}

function renderList(items) {
  if (items.length === 0) return "_No posts yet — check back soon._";
  return items
    .map((p) => {
      const date = formatDate(p.date);
      const prefix = date ? `\`${date}\` — ` : "";
      return `- ${prefix}[${p.title}](${p.link})`;
    })
    .join("\n");
}

function replaceBetween(content, start, end, replacement) {
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`Could not find markers ${start} / ${end} in README.md`);
  }
  const before = content.slice(0, startIdx + start.length);
  const after = content.slice(endIdx);
  return `${before}\n${replacement}\n${after}`;
}

async function main() {
  const xml = await fetchFeed(FEED_URL);
  const items = parseItems(xml).slice(0, MAX_POSTS);
  const readme = await readFile(README_PATH, "utf8");
  const next = replaceBetween(readme, START, END, renderList(items));
  if (next === readme) {
    console.log("README already up to date.");
    return;
  }
  await writeFile(README_PATH, next, "utf8");
  console.log(`Updated README with ${items.length} post(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
