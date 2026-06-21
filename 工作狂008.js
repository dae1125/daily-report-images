import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import https from "https";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf-8").replace(/^\uFEFF/, ""));
const KB_DIR = CONFIG.output_dir;
const TEMP_DIR = join(__dirname, "temp");
const WEBHOOK_URL = CONFIG.feishu.webhook_url;

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request({
      hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname + parsed.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 30000
    }, (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); });
    req.on("error", reject); req.on("timeout", function() { this.destroy(); reject("timeout"); });
    req.write(body); req.end();
  });
}

function pad(n) { return String(n).padStart(2, "0"); }
function esc(t) { return (t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

async function callDeepSeek(messages, system) {
  try {
    const resp = await postJson(CONFIG.deepseek.base_url + "/chat/completions", {
      model: CONFIG.deepseek.model, temperature: 0.3, max_tokens: 2048,
      messages: [{ role: "system", content: system || "你是一个编辑。" }, ...messages]
    });
    const c = resp.choices?.[0]?.message?.content || "";
    if (!c) console.log("API返回空");
    return c;
  } catch (e) { console.log("API异常:", e.message); return ""; }
}

function getDateRange(mode) {
  const now = new Date(); const end = new Date(now); end.setDate(end.getDate() - 1);
  const start = new Date(end);
  if (mode === "weekly") start.setDate(start.getDate() - 6); else start.setDate(start.getDate() - 29);
  return { start, end };
}

async function readKBContent(start, end) {
  const all = []; const cur = new Date(start);
  while (cur <= end) {
    const p = join(KB_DIR, String(cur.getFullYear()), pad(cur.getMonth()+1), pad(cur.getDate()), "日报.md");
    if (existsSync(p)) { all.push("【" + cur.getFullYear() + "-" + pad(cur.getMonth()+1) + "-" + pad(cur.getDate()) + "】\n" + readFileSync(p, "utf-8")); }
    cur.setDate(cur.getDate() + 1);
  }
  return all.join("\n\n---\n\n");
}

function buildSummaryHtml(summary, header, dateRange, dayCount) {
  const secs = []; let cur = null;
  for (const line of summary.split("\n").filter(l => l.trim())) {
    const cl = line.replace(/^#{1,6}\s*/, ""); const m = cl.match(/^【(.+?)】/);
    if (m) { if (cur) secs.push(cur); cur = { t: m[1], items: [], hl: m[1].includes("重点")||m[1].includes("头条") }; }
    else if (cur) { cur.items.push(line.replace(/^[-•●]\s*/, "")); }
  }
  if (cur) secs.push(cur);
  const hl = secs.find(s => s.hl); const others = secs.filter(s => !s.hl);
  let hHTML = "";
  if (hl) { hHTML = '<div class="hlx"><div class="hdt">' + esc(hl.t) + '</div>'; hl.items.forEach((item,i) => { hHTML += '<div class="hli"><span class="hln">' + (i+1) + '</span><span class="hlt">' + esc(item.replace(/\*{1,2}/g,"")) + '</span></div>'; }); hHTML += "</div>"; }
  let secHTML = "";
  others.filter(s => s.items.length > 0).forEach(sec => {
    secHTML += '<div class="scc"><div class="sct">' + esc(sec.t) + '</div>'; sec.items.forEach(item => { secHTML += '<div class="sci">◆ ' + esc(item.replace(/\*{1,2}/g,"")) + '</div>'; }); secHTML += "</div>";
  });
  var css = '*{margin:0;padding:0;box-sizing:border-box}body{width:1080px;background:#080C18;background-image:radial-gradient(ellipse at 50% 0%,rgba(30,50,100,0.3) 0%,transparent 60%);font-family:"Microsoft YaHei","PingFang SC",sans-serif;padding:28px;color:#F0EDE4;position:relative;overflow:hidden}body::before{content:"";position:absolute;top:0;left:0;right:0;bottom:0;background-image:linear-gradient(rgba(201,168,76,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(201,168,76,0.03) 1px,transparent 1px);background-size:60px 60px;pointer-events:none}.ct{position:relative;z-index:1}.hd{text-align:center;padding:16px 0 20px}.hdi{font-size:48px;line-height:1;margin-bottom:3px}.hdn{font-size:44px;font-weight:900;letter-spacing:8px;background:linear-gradient(180deg,#E8D48B,#C9A84C,#A68B3A,#A68B3A);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:3px}.hds{font-size:12px;color:rgba(201,168,76,0.3);letter-spacing:4px;margin-bottom:8px}.hll{margin:10px auto 0;width:140px;height:2px;background:linear-gradient(90deg,transparent,#C9A84C,transparent);border-radius:2px}.hlx{margin:20px 0;padding:24px;background:rgba(18,25,45,0.95);border:1px solid rgba(201,168,76,0.35);border-radius:10px;box-shadow:0 3px 20px rgba(0,0,0,0.4)}.hdt{font-size:26px;font-weight:700;color:#E8D48B;letter-spacing:1.5px;margin-bottom:12px;padding-left:3px}.hli{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid rgba(201,168,76,0.08)}.hli:last-child{border-bottom:none}.hln{flex-shrink:0;width:28px;height:28px;background:linear-gradient(135deg,#C9A84C,#A68B3A);border-radius:50%;text-align:center;line-height:28px;font-size:14px;font-weight:800;color:#080C18;margin-top:1px}.hlt{font-size:18px;line-height:1.4;color:rgba(240,237,228,0.85);flex:1}.scc{margin:12px 0;padding:18px 20px;background:rgba(14,20,36,0.85);border:1px solid rgba(201,168,76,0.15);border-radius:8px}.sct{font-size:22px;font-weight:700;color:#C9A84C;letter-spacing:1.5px;margin-bottom:10px;padding-left:10px;border-left:3px solid #C9A84C}.sci{font-size:18px;line-height:1.5;padding:4px 0 4px 8px;color:rgba(240,237,228,0.85)}.ft{margin-top:20px;padding-top:12px;text-align:center;border-top:1px solid rgba(201,168,76,0.12)}.fs{font-size:13px;color:rgba(201,168,76,0.3);margin-bottom:4px}.fb{font-size:12px;font-weight:700;color:rgba(201,168,76,0.25);letter-spacing:3px}';
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>' + css + '</style></head><body><div class="ct"><div class="hd"><div class="hdi">🐊</div><div class="hdn">大鳄·' + esc(header) + '</div><div class="hds">' + esc(dateRange) + ' · ' + dayCount + '天数据</div><div class="hll"></div></div>' + hHTML + secHTML + '<div class="ft"><div class="fs">大鳄智能体1号 · AI驱动</div></div></div></body></html>';
}