import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import https from "https";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf-8").replace(/^\uFEFF/, ""));
const TEMP_DIR = join(__dirname, "temp");
const KB_DIR = CONFIG.output_dir;
const FEISHU_WEBHOOK = CONFIG.feishu.webhook_url;

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request({
      hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname + parsed.search,
      method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 30000
    }, (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); });
    req.on("error", reject); req.on("timeout", function() { this.destroy(); reject("timeout"); });
    req.write(body); req.end();
  });
}

function esc(t) { return (t || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function parseSec(txt) {
  const lines = txt.split("\n").filter(l => l.trim()); const secs = []; let cur = null;
  for (const line of lines) {
    const cl = line.replace(/^#{1,6}\s*/, ""); const m = cl.match(/^【(.+?)】/);
    if (m) { if (cur) secs.push(cur); cur = { t: m[1], items: [], hl: m[1].includes("头条") }; }
    else if (cur) cur.items.push(line);
  }
  if (cur) secs.push(cur); return secs;
}

function buildHtml(aiText, dateStr, srcNames, rawCount, theme) {
  const secs = parseSec(aiText); const hl = secs.find(s => s.hl);
  const others = secs.filter(s => !s.hl); const d = new Date(dateStr + "T00:00:00+08:00");
  const wd = ["周日","周一","周二","周三","周四","周五","周六"];
  const fd = dateStr.replace(/-/g, ".");
  let totalItems = 0; if (hl) totalItems += hl.items.length;
  others.forEach(sec => totalItems += sec.items.length);
  let s = 1.0; if (totalItems <= 2) s = 1.5; else if (totalItems <= 4) s = 1.35; else if (totalItems <= 6) s = 1.2; else if (totalItems <= 9) s = 1.05;

  let hHTML = "";
  if (hl) {
    hHTML = '<div class="hlx"><div class="hdt">🔥 头条聚焦</div>';
    hl.items.forEach((item, i) => { const c = item.replace(/^\d+\.\s*\*{0,2}\s*/, "").replace(/\*{1,2}/g,"");
      hHTML += '<div class="hli"><span class="hln">' + (i+1) + '</span><span class="hlt">' + esc(c) + '</span></div>'; });
    hHTML += "</div>";
  }
  let secHTML = "";
  others.filter(sec => sec.items.length > 0).forEach(sec => {
    secHTML += '<div class="scc"><div class="sct">' + esc(sec.t) + '</div>';
    sec.items.forEach(item => { const c = item.replace(/^[-•]\s*/, "").replace(/\*{1,2}/g,"");
      secHTML += '<div class="sci">◆ ' + esc(c) + '</div>'; });
    secHTML += "</div>";
  });

  const isDay = theme === "day";
  const C = isDay ? {bg:"#FAF6EE",txt:"#2C2418",card:"rgba(235,225,210,0.9)",ct:"#3C3420",sb:"#8A7A60",dm:"#A09078",gd:"#C9A84C",gl:"#D4B356",gd2:"#A68B3A",hbg:"rgba(235,225,210,0.95)",grd:"rgba(201,168,76,0.04)",lg:"linear-gradient(90deg,transparent,rgba(201,168,76,0.4),transparent)",f1:"rgba(220,195,160,0.12)",f2:"rgba(201,168,76,0.03)"}
    : {bg:"#080C18",txt:"#F0EDE4",card:"rgba(14,20,36,0.85)",ct:"rgba(240,237,228,0.85)",sb:"rgba(201,168,76,0.3)",dm:"rgba(255,255,255,0.3)",gd:"#C9A84C",gl:"#E8D48B",gd2:"#A68B3A",hbg:"rgba(18,25,45,0.95)",grd:"rgba(201,168,76,0.03)",lg:"linear-gradient(90deg,transparent,rgba(201,168,76,0.6),transparent)",f1:"rgba(30,50,100,0.3)",f2:"rgba(201,168,76,0.05)"};

  const p = Math.round(30*s), gap = Math.round(14*s), pad = Math.round(14*s), hdt = Math.round(28*s), hlt = Math.round(22*s), sct = Math.round(24*s);
  let css = `*{margin:0;padding:0;box-sizing:border-box}body{width:1080px;background:${C.bg};background-image:radial-gradient(ellipse at 50% 0%,${C.f1} 0%,transparent 60%),radial-gradient(ellipse at 80% 100%,${C.f2} 0%,transparent 50%);font-family:"Microsoft YaHei","PingFang SC",sans-serif;padding:${p}px;color:${C.txt};position:relative;overflow:hidden}
body::before{content:"";position:absolute;top:0;left:0;right:0;bottom:0;background-image:linear-gradient(${C.grd} 1px,transparent 1px),linear-gradient(90deg,${C.grd} 1px,transparent 1px);background-size:60px 60px;pointer-events:none}
.ct{position:relative;z-index:1}.hd{text-align:center;padding:${Math.round(20*s)}px 0 ${Math.round(25*s)}px}
.hdi{font-size:${Math.round(60*s)}px;line-height:1;margin-bottom:${Math.round(4*s)}px}
.hdn{font-size:${Math.round(52*s)}px;font-weight:900;letter-spacing:${Math.round(10*s)}px;background:linear-gradient(180deg,${C.gl} 0%,${C.gd} 30%,${C.gd2} 70%,${C.gd2} 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:${Math.round(4*s)}px}
.hds{font-size:${Math.round(16*s)}px;color:${C.sb};letter-spacing:${Math.round(6*s)}px;margin-bottom:${Math.round(10*s)}px}
.hdd{font-size:${Math.round(24*s)}px;color:rgba(201,168,76,0.75);letter-spacing:${Math.round(3*s)}px}
.hdd .wdw{color:${C.gl};font-weight:700}
.hll{margin:${Math.round(14*s)}px auto 0;width:${Math.round(180*s)}px;height:2px;background:${C.lg};border-radius:2px}
.hlx{margin:${Math.round(30*s)}px 0 ${Math.round(25*s)}px;padding:${Math.round(36*s)}px;background:${C.hbg};border:1px solid rgba(201,168,76,0.35);border-radius:${Math.round(12*s)}px;box-shadow:0 ${Math.round(4*s)}px ${Math.round(30*s)}px rgba(0,0,0,0.4),inset 0 1px 0 rgba(201,168,76,0.12)}
.hlx::before{content:"";position:absolute;left:0;top:0;bottom:0;width:${Math.round(4*s)}px;background:linear-gradient(180deg,${C.gl},${C.gd2});border-radius:${Math.round(4*s)}px 0 0 ${Math.round(4*s)}px}
.hdt{font-size:${hdt}px;font-weight:700;color:${C.gl};letter-spacing:${Math.round(2*s)}px;margin-bottom:${Math.round(20*s)}px;padding-left:${Math.round(4*s)}px}
.hli{display:flex;align-items:flex-start;gap:${gap}px;padding:${pad}px 0;border-bottom:1px solid rgba(201,168,76,0.08)}
.hli:last-child{border-bottom:none}
.hln{flex-shrink:0;width:${Math.round(32*s)}px;height:${Math.round(32*s)}px;background:linear-gradient(135deg,${C.gd},${C.gd2});border-radius:50%;text-align:center;line-height:${Math.round(32*s)}px;font-size:${Math.round(16*s)}px;font-weight:800;color:#080C18;margin-top:${Math.round(2*s)}px}
.hlt{font-size:${hlt}px;line-height:1.5;color:${C.ct};flex:1}
.scc{margin:${Math.round(20*s)}px 0;padding:${Math.round(24*s)}px ${Math.round(26*s)}px;background:${C.card};border:1px solid rgba(201,168,76,0.15);border-radius:${Math.round(10*s)}px;box-shadow:0 ${Math.round(2*s)}px ${Math.round(14*s)}px rgba(0,0,0,0.2)}
.sct{font-size:${sct}px;font-weight:700;color:${C.gd};letter-spacing:${Math.round(2*s)}px;margin-bottom:${Math.round(14*s)}px;padding-left:${Math.round(14*s)}px;border-left:${Math.round(4*s)}px solid ${C.gd}}
.sci{font-size:${Math.round(20*s)}px;line-height:1.5;padding:${Math.round(6*s)}px 0 ${Math.round(6*s)}px ${Math.round(10*s)}px;color:${C.ct}}
.ft{margin-top:${Math.round(35*s)}px;padding-top:${Math.round(18*s)}px;text-align:center;border-top:1px solid rgba(201,168,76,0.15)}
.fs{font-size:${Math.round(13*s)}px;color:${C.dm};letter-spacing:${Math.round(1.5*s)}px;margin-bottom:${Math.round(6*s)}px}
.fst{font-size:${Math.round(13*s)}px;color:${C.sb};letter-spacing:${Math.round(1.5*s)}px;margin-bottom:${Math.round(10*s)}px}
.fb{font-size:${Math.round(14*s)}px;font-weight:700;color:rgba(201,168,76,0.25);letter-spacing:${Math.round(4*s)}px}`;

  // 白天版.hln颜色修复
  if (isDay) {
    css = css.replace(/\.hln\{[^}]*\}/g, m => m.replace(/#FAF6EE/g, "#2C2418"));
  }

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>${css}</style></head><body><div class="ct">
<div class="hd"><div class="hdi">🐊</div><div class="hdn">大鳄·AI 情报</div><div class="hds">DAE AGENT · AI INTELLIGENCE</div><div class="hdd">${fd} <span class="wdw">${wd[d.getDay()]}</span></div><div class="hll"></div></div>
${hHTML}${secHTML}
<div class="ft"><div class="fs">数据来源：${esc(srcNames)}</div><div class="fst">共 ${rawCount} 条数据 · AI智能筛选</div><div class="fb">大鳄智能体1号 · AI驱动</div></div></div></body></html>`;
}

async function main() {
  console.log("[海报生成 + 飞书推送]");
  let processed;
  try { processed = JSON.parse(readFileSync(join(TEMP_DIR, "processed.json"), "utf-8")); } catch { console.log("无数据"); return; }
  const aiText = processed.processed || "";
  const rawCount = processed.raw?.length || processed.count || 0;
  const dateStr = processed.date || new Date().toISOString().split("T")[0];
  if (!aiText) { console.log("文本为空"); return; }
  const seen = new Set(); const sources = [];
  if (processed.raw) processed.raw.forEach(item => { if (item.source && !seen.has(item.source)) { seen.add(item.source); sources.push(item.source); } });
  const srcNames = sources.join(" · ") || "科技媒体";

  // 主题检测
  const theme = (new Date().getHours() >= 6 && new Date().getHours() < 18) ? "day" : "night";
  console.log("主题: " + theme);

  console.log("正在生成海报...");
  const html = buildHtml(aiText, dateStr, srcNames, rawCount, theme);
  writeFileSync(join(TEMP_DIR, "poster.html"), html, "utf-8");

  let browser;
  try { browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }); }
  catch { try { browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] }); } catch (e) { console.log("Playwright失败:", e.message); return; } }

  const page = await browser.newPage({ viewport: { width: 1080, height: 600 }, deviceScaleFactor: 3 });
  await page.setContent(html, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(800);
  let box; try { box = await page.$("body").then(h => h.boundingBox()); } catch { box = { x: 0, y: 0, width: 1080, height: 1920 }; }
  const h = Math.ceil((box?.y||0) + (box?.height||600) + 20);
  await page.setViewportSize({ width: 1080, height: h > 600 ? h : 600 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(TEMP_DIR, "poster.png"), fullPage: true });
  await browser.close();
  const pngBuffer = readFileSync(join(TEMP_DIR, "poster.png"));
  console.log("海报: " + Math.round(pngBuffer.length/1024) + " KB");

  // 发送文字版
  console.log("正在发送文字版...");
  try {
    const txt = aiText.replace(/【/g, "\n【").replace(/\n{3,}/g, "\n\n").trim();
    await postJson(FEISHU_WEBHOOK, { msg_type: "text", content: JSON.stringify({ text: "📋 今日日报 - " + dateStr + "\n━━━━━━━━━━━━━━\n" + txt.substring(0,1800) + "\n━━━━━━━━━━━━━━\n🎨 点击文字版标题可跳转原文" }) });
    console.log("文字版推送完成");
  } catch (e) { console.log("文字版失败:", e.message); }

  // 上传海报到飞书
  let imageKey = null;
  try {
    const token = await postJson("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { app_id: CONFIG.feishu.app_id, app_secret: CONFIG.feishu.app_secret });
    const tk = token.tenant_access_token;
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2,10);
    const header = Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"image_type\"\r\n\r\nmessage\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"image\"; filename=\"p.png\"\r\nContent-Type: image/png\r\n\r\n");
    const footer = Buffer.from("\r\n--" + boundary + "--\r\n");
    const body = Buffer.concat([header, pngBuffer, footer]);
    const parsed = new URL("https://open.feishu.cn/open-apis/im/v1/images");
    const req = https.request({ hostname: parsed.hostname, port: 443, path: parsed.pathname, method: "POST", headers: { "Authorization": "Bearer " + tk, "Content-Type": "multipart/form-data; boundary=" + boundary, "Content-Length": body.length }, timeout: 30000 },
      (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { const j = JSON.parse(d); if (j.code === 0) imageKey = j.data?.image_key; } catch {} }); });
    req.on("error", () => {}); req.write(body); req.end();
    await new Promise(r => setTimeout(r, 3000));

    if (imageKey) {
      await postJson(FEISHU_WEBHOOK, { msg_type: "image", content: JSON.stringify({ image_key: imageKey }) });
      console.log("海报推送完成（直传）");
    }
  } catch (e) { console.log("海报上传失败:", e.message); }

  // 存档
  const parts = dateStr.split("-");
  const kbDir = join(KB_DIR, parts[0], parts[1], parts[2]);
  try { mkdirSync(kbDir, { recursive: true }); } catch {}
  writeFileSync(join(kbDir, "日报海报.png"), readFileSync(join(TEMP_DIR, "poster.png")));
  console.log("海报已存档");
  console.log("[完成]");
}
main().catch(console.error);
