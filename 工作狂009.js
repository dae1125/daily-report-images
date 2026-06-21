import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, "temp");

function fetch(url) {
  return new Promise((resolve, reject) => {
    const p = new URL(url);
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15000 }, (res) => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d));
    }).on("error", reject).on("timeout", function() { this.destroy(); reject("timeout"); });
  });
}

async function crawlGov() {
  const items = [];
  try {
    const html = await fetch("https://www.gov.cn/zhengce/");
    const matches = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>\s*([^<]{8,}?)\s*<\/a>/g)];
    matches.forEach(m => {
      const title = (m[2]||"").trim();
      if (title.length > 5 && !title.includes("更多") && !title.includes(">>")) {
        items.push({ title, url: m[1].startsWith("http") ? m[1] : "https://www.gov.cn" + m[1], type: "政策红利", brief: title.replace(/国务院|办公厅|关于印发|的通知/g,"").trim() });
      }
    });
  } catch (e) { console.log("国务院失败:", e.message); }
  return items.slice(0, 15);
}

async function crawl36krFeed() {
  const items = [];
  try {
    const xml = await fetch("https://36kr.com/feed");
    const rss = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    rss.slice(0, 15).forEach(item => {
      const t = item[1].match(/<title>(.*?)<\/title>/);
      const d = item[1].match(/<description>(.*?)<\/description>/);
      const l = item[1].match(/<link>(.*?)<\/link>/);
      const title = (t?.[1]||"").replace(/<!\[CDATA\[|\]\]>/g,"").trim();
      if (title.length > 3) {
        items.push({ title, brief: ((d?.[1]||"").replace(/<[^>]*>/g,"").substring(0,120)) || title, url: l?.[1]||"", type: title.match(/融资|投资|收购/) ? "融资风向" : "行业动态" });
      }
    });
  } catch (e) { console.log("36氪失败:", e.message); }
  return items;
}

async function main() {
  console.log("[商机数据采集]");
  const results = { sources: [], count: 0, date: new Date().toISOString().split("T")[0] };
  const gov = await crawlGov();
  if (gov.length > 0) { results.sources.push({ source: "国务院政策", items: gov }); results.count += gov.length; console.log("国务院: " + gov.length + " 条"); }
  const kr = await crawl36krFeed();
  if (kr.length > 0) { results.sources.push({ source: "36氪", items: kr }); results.count += kr.length; console.log("36氪: " + kr.length + " 条"); }
  writeFileSync(join(TEMP_DIR, "business_sources.json"), JSON.stringify(results, null, 2), "utf-8");
  console.log("共 " + results.count + " 条"); console.log("[完成]");
}
main().catch(console.error);
