import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8').replace(/^\uFEFF/, ''));
  const TEMP_DIR = join(__dirname, 'temp');
  const KB_DIR = CONFIG.output_dir;
  
  function postJson(url, data) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(data);
    const parsed = new URL(url);
    const mod = url.startsWith('https') ? https : http;
    const opt = {
      hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 60000
    };
    const req = mod.request(opt, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject); req.on('timeout', function() { this.destroy(); reject('timeout'); });
    req.write(body); req.end();
  });
}
function postForm(url, data) {
  return new Promise((resolve, reject) => {
    const body = Object.entries(data).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
    const parsed = new URL(url);
    const mod = url.startsWith("https") ? https : http;
    const opt = {
      hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
      timeout: 60000
    };
    const req = mod.request(opt, (res) => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on("error", reject); req.on("timeout", function() { this.destroy(); reject("timeout"); });
    req.write(body); req.end();
  });
}


async function callDeepSeek(messages, system) {
  try {
    const resp = await postJson(CONFIG.deepseek.base_url + '/chat/completions', {
      model: CONFIG.deepseek.model,
      messages: [
        { role: 'system', content: system || '你是一个专业的AI科技新闻编辑，擅长分类、总结和提炼要点。' },
        ...messages
      ],
      temperature: 0.3,
      max_tokens: 2048
    });
    const content = resp.choices?.[0]?.message?.content || '';
    if (!content) {
      console.log('API返回内容为空:', JSON.stringify(resp).substring(0, 200));
    }
    return content;
  } catch (e) {
    console.log('API调用异常:', e.message || e);
    return '';
  }
}

async function main() {
  console.log('[AI处理 + 日报生成]');

  const crawled = JSON.parse(readFileSync(join(TEMP_DIR, 'crawled.json'), 'utf-8'));
  // 读取商机数据
  let bizDataStr = "";
  try {
    const biz = JSON.parse(readFileSync(join(TEMP_DIR, "business_sources.json"), "utf-8"));
    if (biz.count > 0) {
      bizDataStr = "\n\n【商机数据】\n" + biz.sources.map(s =>
        s.items.map(i => "[" + s.source + "] " + i.title + (i.brief ? " - " + i.brief : "")).join("\n")
      ).join("\n").substring(0, 2000);
      console.log("商机数据: " + biz.count + " 条");
    }
  } catch {}
  console.log('数据: ' + crawled.count + ' 条');

  // AI处理
  console.log('AI处理中...');
  const itemsText = crawled.items.map((item, i) => (i+1) + '. [' + item.source + '] ' + item.title).join('\n');

 const aiResult = await callDeepSeek([
    { role: 'user', content: '注意：不要使用Markdown标题符号（#），直接用【】作为板块标题。\n\n以下是今天的科技/AI热点资讯，请必须严格按以下5个板块输出，缺一不可：\n\n【上篇·速览】用3-5条一句话概括今日重点\n【今日头条】选出最重要的3条，每条约15-30字\n【AI技术突破】技术进展摘要 | 商机：普通人怎么用/有什么机会\n【开源项目】项目摘要（保持技术性，不加商机分析）\n【下篇·商机解读】从以上资讯中提炼出3-5个普通人可参与的商业机会，每条包含：机会名称、适合人群、入手方法、收费参考\n\n以上5个板块【必须全部输出】，数量不能少。\n\n格式示例：\n【今日头条】\n1. 标题 - 摘要\n\n【AI技术突破】\n- 技术摘要 | 商机：具体分析\n\n【开源项目】\n- 项目摘要\n\n【商机解读】\n● 机会名 - 适合谁 - 怎么入手 - 收费参考\n\n资讯内容：\n\n【科技热点】\n' + itemsText.substring(0, 2000) + '\n' + bizDataStr + '\n\n请综合科技热点和商机数据，输出完整报告。商机解读必须结合政策数据和商业新闻，给出普通人可参与的入局建议。如果某个板块无对应内容，请标注"暂无内容"，不要省略板块。\n\n' }
 ]);

 if (!aiResult) {
   console.log('AI处理失败（返回空）');
   return;
 }
 console.log('AI处理完成');

  // 保存AI结果供007生成图片
  writeFileSync(join(TEMP_DIR, 'processed.json'), JSON.stringify({
    processed: aiResult,
    raw: crawled.items,
    count: crawled.count,
    date: new Date().toISOString().split('T')[0]
  }, null, 2), 'utf-8');
  console.log('AI结果已保存，等待007生成精美海报');

 // 生成精美飞书卡片
 const dateStr = new Date().toISOString().split('T')[0];
 const sources = [...new Set(crawled.items.map(i => i.source))].join('、');

 const lines = aiResult.split('\n').filter(l => l.trim());
 const cardElements = [];
 let currentSection = '';

 cardElements.push({
   tag: 'div',
   text: { tag: 'lark_md', content: '**' + dateStr + '**  ' + sources }
 });
 cardElements.push({ tag: 'hr' });

 for (const line of lines) {
   if (line.startsWith('【') && line.includes('】')) {
     currentSection = line;
     cardElements.push({
       tag: 'div',
       text: { tag: 'lark_md', content: '\n**' + line + '**' }
     });
   } else if (line.trim()) {
     cardElements.push({
       tag: 'div',
       text: { tag: 'lark_md', content: line }
     });
   }
 }

 cardElements.push({ tag: 'hr' });
 cardElements.push({
   tag: 'note',
   elements: [{ tag: 'plain_text', content: '数据: ' + crawled.count + ' 条 | 来源: ' + sources + ' | 图片版见下条消息' }]
 });

  const feishuCard = {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: 'AI热点日报' }, template: 'blue' },
      elements: cardElements
    }
  };

  // 推送到飞书
  try {
    const feishuResp = await postJson(CONFIG.feishu.webhook_url, feishuCard);
    console.log('文字版推送: ' + (feishuResp.code === 0 ? '成功' : '失败 ' + JSON.stringify(feishuResp)));
  } catch (e) {
    console.log('飞书推送失败: ' + e.message);
    const textMsg = { msg_type: 'text', content: { text: '【AI热点日报 ' + dateStr + '】\n\n' + aiResult.substring(0, 2000) + '\n\n来源: ' + sources } };
    await postJson(CONFIG.feishu.webhook_url, textMsg);
    console.log('已用文本消息备用发送');
  }

  // 保存到知识库
  // 推送微信（Server酱）
  if (CONFIG.serverchan?.sendkey) {
    try {
      const title = '【AI热点日报】' + dateStr;
      const desp = aiResult.substring(0, 2000) + '\n\n来源: ' + sources;
      await postForm('https://sctapi.ftqq.com/' + CONFIG.serverchan.sendkey + '.send', { title, desp });
      console.log('微信推送: 成功');
    } catch (e) {
      console.log('微信推送失败: ' + e.message);
    }
  }
  // 保存到知识库
  const reportMd = '# AI热点日报 - ' + dateStr + '\n\n---\n\n' + aiResult + '\n\n---\n来源: ' + sources + '\n生成时间: ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '\n数据量: ' + crawled.count + ' 条';
  const parts = dateStr.split('-');
  const kbPath = join(KB_DIR, parts[0], parts[1], parts[2]);
  try { mkdirSync(kbPath, { recursive: true }); } catch {}
  writeFileSync(join(kbPath, '日报.md'), reportMd, 'utf-8');
  console.log('日报已存档');
  console.log('[完成]');
}

main().catch(console.error);

