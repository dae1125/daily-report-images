import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, "temp");

function fetch(url, retries = 2) {
  return new Promise((resolve, reject) => {
    const p = new URL(url);
    const m = url.startsWith("https") ? https : http;
    const tryFetch = (attempt) => {
      m.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 10000 }, (res) => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d));
      }).on("error", e => attempt < retries ? setTimeout(() => tryFetch(attempt + 1), 1000) : reject(e))
        .on("timeout", function() { this.destroy(); if (attempt < retries) setTimeout(() => tryFetch(attempt + 1), 1000); else reject("timeout"); });
    };
    tryFetch(0);
  });
}

function extract(html, regex, max = 15) {
  return [...html.matchAll(regex)].map(m => (m[1] || m[2] || "").trim()).filter(t => t.length > 4).slice(0, max);
}

async function crawl36kr() {
  const items = [];
  try {
    const html = await fetch("https://36kr.com/newsflashes");
    const titles = extract(html, /<a[^>]*>([^<]{8,})<\/a>/g, 20);
    titles.forEach(t => items.push({ title: t, source: "36氪", url: "https://36kr.com" }));
  } catch {}
  try {
    const feed = await fetch("https://36kr.com/feed");
    const rss = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20);
    rss.forEach(item => {
      const t = item[1].match(/<title>(.*?)<\/title>/);
      const l = item[1].match(/<link>(.*?)<\/link>/);
      if (t) items.push({ title: t[1].replace(/<!\[CDATA\[|\]\]>/g,"").trim(), source: "36氪", url: l?.[1] || "https://36kr.com" });
    });
  } catch {}
  return items.filter(i => i.title.length > 3);
}

async function crawlZhihu() {
  const items = [];
  try {
    const html = await fetch("https://www.zhihu.com/hot");
    const titles = extract(html, /<a[^>]*>([^<]{8,})<\/a>/g, 15);
    titles.forEach(t => items.push({ title: t, source: "知乎", url: "https://www.zhihu.com" }));
  } catch {}
  return items;
}

async function crawlGithub() {
  const items = [];
  try {
    const html = await fetch("https://github.com/trending");
    const repos = [...html.matchAll(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 15);
    repos.forEach(r => {
      const name = (r[2] || "").replace(/<[^>]*>/g, "").trim();
      if (name) items.push({ title: name, source: "GitHub", url: "https://github.com/" + r[1] });
    });
  } catch {}
  return items;
}

async function crawlHN() {
  const items = [];
  try {
    const data = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    const ids = JSON.parse(data).slice(0, 30);
    const batch = ids.slice(0, 10);
    for (const id of batch) {
      try {
        const item = JSON.parse(await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`));
        if (item?.title) items.push({ title: item.title, source: "HackerNews", url: `https://news.ycombinator.com/item?id=${id}` });
      } catch {}
    }
  } catch {}
  return items;
}

async function crawlJiqizhixin() {
  const items = [];
  try {
    const html = await fetch("https://www.jiqizhixin.com/");
    const titles = extract(html, /<a[^>]*>([^<]{8,})<\/a>/g, 15);
    titles.forEach(t => items.push({ title: t, source: "机器之心", url: "https://www.jiqizhixin.com" }));
  } catch {}
  return items;
}

async function main() {
  console.log("[爬虫开始]");
  const allItems = [];
  const sources = [
    { name: "36氪", fn: crawl36kr },
    { name: "知乎", fn: crawlZhihu },
    { name: "GitHub", fn: crawlGithub },
    { name: "HackerNews", fn: crawlHN },
    { name: "机器之心", fn: crawlJiqizhixin },
  ];
  for (const src of sources) {
    try {
      const items = await src.fn();
      allItems.push(...items);
      console.log(`  ${src.name}: ${items.length} 条`);
    } catch (e) { console.log(`  ${src.name}: 失败`); }
  }
  // 去重
  const seen = new Set();
  const unique = allItems.filter(i => { const k = i.title.substring(0, 20); if (seen.has(k)) return false; seen.add(k); return true; });
  const result = { items: unique, count: unique.length, date: new Date().toISOString().split("T")[0] };
  writeFileSync(join(TEMP_DIR, "crawled.json"), JSON.stringify(result, null, 2), "utf-8");
  console.log(`总计: ${unique.length} 条`);
  console.log("[完成]");
}
main().catch(console.error);
