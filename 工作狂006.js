import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf-8").replace(/^\uFEFF/, ""));
const TEMP_DIR = join(__dirname, "temp");
const KB_DIR = CONFIG.output_dir;

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request({
      hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname + parsed.search,
      method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 60000
    }, (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); });
    req.on("error", reject); req.on("timeout", function() { this.destroy(); reject("timeout"); });
    req.write(body); req.end();
  });
}

async function callDeepSeek(messages, system) {
  try {
    const resp = await postJson(CONFIG.deepseek.base_url + "/chat/completions", {
      model: CONFIG.deepseek.model, temperature: 0.3, max_tokens: 2048,
      messages: [{ role: "system", content: system || "你是一个专业的AI科技新闻编辑，擅长分类、总结和提炼要点。" }, ...messages]
    });
    const content = resp.choices?.[0]?.message?.content || "";
    if (!content) console.log("API返回内容为空:", JSON.stringify(resp).substring(0, 200));
    return content;
  } catch (e) { console.log("API异常:", e.message || e); return ""; }
}

function buildUrlMap() {
  const map = {};
  try {
    const c = JSON.parse(readFileSync(join(TEMP_DIR, "crawled.json"), "utf-8"));
    if (c.items) c.items.forEach(item => { if (item.url) { const k = item.title.replace(/[^\w\u4e00-\u9fff]/g, "").toLowerCase(); map[k] = item.url; } });
  } catch {}
  try {
    const b = JSON.parse(readFileSync(join(TEMP_DIR, "business_sources.json"), "utf-8"));
    if (b.sources) b.sources.forEach(src => { if (src.items) src.items.forEach(item => { if (item.url) { const k = item.title.replace(/[^\w\u4e00-\u9fff]/g,"").toLowerCase(); map[k] = item.url; } }); });
  } catch {}
  return map;
}

function findUrl(text, urlMap) {
  if (!urlMap || Object.keys(urlMap).length === 0) return null;
  const clean = text.replace(/^\d+\.\s*/, "").replace(/^[-•●]\s*/, "").replace(/\|.*$/, "").replace(/\*{1,2}/g, "").trim();
  const norm = clean.replace(/[^\w\u4e00-\u9fff]/g, "").toLowerCase();
  let best = null, bestLen = 0;
  for (const [key, url] of Object.entries(urlMap)) {
    if ((norm.includes(key) || key.includes(norm.substring(0, Math.min(15, norm.length)))) && key.length > bestLen) {
      best = url; bestLen = key.length;
    }
  }
  return best;
}

async function main() {
  console.log("[AI处理 + 日报生成]");
  const crawled = JSON.parse(readFileSync(join(TEMP_DIR, "crawled.json"), "utf-8"));
  const urlMap = buildUrlMap();
  console.log("数据: " + crawled.count + " 条, URL映射: " + Object.keys(urlMap).length);

  // 读取商机数据
  let bizDataStr = "";
  try {
    const biz = JSON.parse(readFileSync(join(TEMP_DIR, "business_sources.json"), "utf-8"));
    if (biz.count > 0) {
      bizDataStr = "\n\n【商机数据】\n" + biz.sources.map(s => s.items.map(i => "[" + s.source + "] " + i.title + (i.brief ? " - " + i.brief : "")).join("\n")).join("\n").substring(0, 2000);
      console.log("商机数据: " + biz.count + " 条");
    }
  } catch {}

  const itemsText = crawled.items.map((item, i) => (i+1) + ". [" + item.source + "] " + item.title).join("\n");

  // AI处理
  console.log("AI处理中...");
  const aiResult = await callDeepSeek([
    { role: "user", content: "注意：不要使用Markdown标题符号（#），直接用【】作为板块标题。\n\n以下是今天的科技热点和商机数据，请综合整理：\n\n【科技热点】\n" + itemsText.substring(0, 2000) + "\n" + bizDataStr + "\n\n请综合科技热点和商机数据，输出报告。商机解读要结合政策数据和商业新闻，给出普通人可参与的入局建议。\n\n格式：\n【今日头条】\n1. 标题 - 摘要\n\n【AI技术突破】\n- 摘要 | 商机：分析\n\n【开源项目】\n- 项目摘要\n\n【商机解读】\n● 机会名 - 适合谁 - 怎么入手" }
  ]);
  if (!aiResult) { console.log("AI处理失败"); return; }
  console.log("AI处理完成");

  // 保存结果
  const processed = { processed: aiResult, raw: crawled.items, count: crawled.count, date: new Date().toISOString().split("T")[0] };
  writeFileSync(join(TEMP_DIR, "processed.json"), JSON.stringify(processed, null, 2), "utf-8");

  // 生成飞书卡片（带点击链接）
  const dateStr = new Date().toISOString().split("T")[0];
  const sources = [...new Set(crawled.items.map(i => i.source))].join("、");
  const lines = aiResult.split("\n").filter(l => l.trim());
  const cardElements = [
    { tag: "div", text: { tag: "lark_md", content: "**" + dateStr + "**  " + sources } },
    { tag: "hr" }
  ];

  for (const line of lines) {
    const cleanLine = line.replace(/^#{1,6}\s*/, "");
    if (cleanLine.startsWith("【") && cleanLine.includes("】")) {
      cardElements.push({ tag: "div", text: { tag: "lark_md", content: "\n**" + cleanLine + "**" } });
    } else if (line.trim()) {
      const content = line.trim();
      const url = findUrl(content, urlMap);
      if (url) {
        cardElements.push({ tag: "div", text: { tag: "lark_md", content: "[" + content + "](" + url + ")" } });
      } else {
        cardElements.push({ tag: "div", text: { tag: "lark_md", content: content } });
      }
    }
  }

  cardElements.push({ tag: "hr" });
  cardElements.push({ tag: "note", elements: [{ tag: "plain_text", content: "数据: " + crawled.count + " 条 | 来源: " + sources + " | 点击标题可跳转原文" }] });

  // 推送
  try {
    const resp = await postJson(CONFIG.feishu.webhook_url, { msg_type: "interactive", card: { header: { title: { tag: "plain_text", content: "AI热点日报" }, template: "blue" }, elements: cardElements } });
    console.log("文字版推送: " + (resp.code === 0 ? "成功" : "失败"));
  } catch (e) {
    console.log("飞书推送失败:", e.message);
    try { await postJson(CONFIG.feishu.webhook_url, { msg_type: "text", content: JSON.stringify({ text: "【AI热点日报 " + dateStr + "】\n\n" + aiResult.substring(0, 2000) }) }); } catch {}
  }

  // 存档到知识库
  const reportMd = "# AI热点日报 - " + dateStr + "\n\n---\n\n" + aiResult + "\n\n---\n来源: " + sources + "\n时间: " + new Date().toLocaleString("zh-CN", {timeZone:"Asia/Shanghai"}) + "\n数据: " + crawled.count + " 条";
  const parts = dateStr.split("-");
  const kbPath = join(KB_DIR, parts[0], parts[1], parts[2]);
  try { mkdirSync(kbPath, { recursive: true }); } catch {}
  writeFileSync(join(kbPath, "日报.md"), reportMd, "utf-8");
  console.log("日报已存档");
  console.log("[完成]");
}
main().catch(console.error);
