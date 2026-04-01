/**
 * ╔══════════════════════════════════════════════════╗
 * ║         Host — Navigator Express Server          ║
 * ║                                                  ║
 * ║  角色：MCP 架構中的「Host（宿主）」               ║
 * ║  · 持有 MCP Client，負責啟動並連線 MCP Server     ║
 * ║  · 將 MCP 工具定義傳給 AI（Groq）                 ║
 * ║  · 當 AI 決定呼叫工具時，透過 MCP Client 執行     ║
 * ║  · 將工具結果回饋給 AI，讓 AI 生成最終回答        ║
 * ╚══════════════════════════════════════════════════╝
 */

require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── MCP Client（由 Host 管理） ──
let mcpClient = null;

async function initMCP() {
  try {
    // 動態載入 ES Module（mcp-client.mjs）
    const { createWeatherMCPClient } = await import('./mcp-client.mjs');
    mcpClient = await createWeatherMCPClient();
    console.log('[MCP] 天氣工具已就緒');
  } catch (err) {
    console.warn('[MCP] 初始化失敗（天氣功能停用）:', err.message);
  }
}

// ── 已知台灣地名清單（用來從用戶訊息中偵測地名） ──
const TAIWAN_LOCATIONS = [
  // 縣市
  '台北','臺北','新北','桃園','台中','臺中','台南','臺南','高雄',
  '基隆','新竹','苗栗','彰化','南投','雲林','嘉義','屏東','宜蘭',
  '花蓮','台東','臺東','澎湖','金門','馬祖',
  // 景點
  '九份','金瓜石','淡水','漁人碼頭','野柳','烏來','平溪','十分',
  '陽明山','北投','象山','貓空','三峽','鶯歌','三義','南庄',
  '日月潭','埔里','清境','合歡山','奧萬大','九族','霧社',
  '阿里山','奮起湖','墾丁','恆春','小琉球','三地門','霧台',
  '礁溪','羅東','蘇澳','太魯閣','瑞穗','光復','玉里',
  '綠島','蘭嶼','三仙台','池上','關山','知本','成功',
];

// 從用戶訊息偵測地名（回傳最長匹配，避免「新北」被「北」提前截斷）
function detectLocation(text) {
  const matches = TAIWAN_LOCATIONS.filter(loc => text.includes(loc));
  if (!matches.length) return null;
  return matches.reduce((a, b) => a.length >= b.length ? a : b);
}

// 從用戶訊息偵測日期描述
function extractDate(text) {
  if (/今天|今日|今晚|現在/.test(text))   return '今天';
  if (/明天|明日|明晚/.test(text))         return '明天';
  if (/後天/.test(text))                   return '後天';
  if (/大後天/.test(text))                 return '大後天';
  if (/下(禮拜|週|周)/.test(text))         return '下禮拜';
  const days = ['日','一','二','三','四','五','六'];
  for (const d of days) {
    if (text.includes(`週${d}`) || text.includes(`星期${d}`)) return `週${d}`;
  }
  return '今天';
}

// ── 工具定義：Host 把 MCP 工具「翻譯」成 AI 看得懂的格式 ──
const WEATHER_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description:
        "查詢台灣指定地點的即時天氣狀況與旅遊建議。" +
        "當使用者詢問天氣、氣溫、下雨、颱風、氣象、濕度等問題時必須呼叫此工具，" +
        "不得依賴訓練資料回答天氣問題。",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "使用者訊息中提到的台灣地名，原文照傳，不要更改。",
          },
        },
        required: ["location"],
      },
    },
  },
];

const SYSTEM_PROMPT =
  "你是一個旅遊應變專家，專門幫群組旅遊在突發狀況下提供備案建議。" +
  "請根據使用者輸入的偏好和限制，提供具體可執行的行程建議。" +
  "若有突發狀況，優先提供應變備案。" +
  "回答請用繁體中文，格式清楚易讀。" +
  "\n\n工具使用規則：呼叫 get_weather 時，location 必須等於使用者訊息中出現的地名原文，" +
  "不得翻譯成英文、不得替換成縣市名稱、不得推斷或改寫。" +
  "例如使用者說「九份」，location 就填「九份」；說「日月潭」就填「日月潭」。";

// ════════════════════════════════════════════════════
//  POST /api/chat  — 核心對話端點
// ════════════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  const { messages, travelInfo } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '缺少對話內容' });
  }

  // 建立 system prompt（含旅遊基本資料）
  let systemPrompt = SYSTEM_PROMPT;
  if (travelInfo?.destination) {
    systemPrompt +=
      `\n\n本次旅遊基本資料：目的地：${travelInfo.destination}、` +
      `${travelInfo.days} 天、${travelInfo.people} 人、` +
      `偏好與限制：${travelInfo.preferences || '無'}。`;
  }

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const lastUserText = messages[messages.length - 1]?.content ?? '';
    const WEATHER_KEYWORDS = ['天氣', '氣溫', '溫度', '下雨', '颱風', '氣象', '預報', '降雨', '晴', '濕度'];
    const hasWeather = WEATHER_KEYWORDS.some(k => lastUserText.includes(k));

    // ── 偵測地名：由 Host 做，不靠 LLM（llama 對台灣景點名稱提取不穩定） ──
    const detectedLoc = detectLocation(lastUserText) ?? travelInfo?.destination;

    const detectedDate = extractDate(lastUserText);

    if (hasWeather && detectedLoc && mcpClient) {
      // ══ 路徑 A：有天氣查詢 + 偵測到地名 → Host 直接呼叫 MCP 工具 ══

      // 通知前端：MCP Client 正在呼叫工具
      res.write(`data: ${JSON.stringify({ tool_call: { name: 'get_weather', arguments: { location: detectedLoc, date: detectedDate } } })}\n\n`);

      // ── 透過 MCP Client 呼叫 MCP Server ──
      let resultText = '{}';
      try {
        const mcpResult = await mcpClient.callTool({ name: 'get_weather', arguments: { location: detectedLoc, date: detectedDate } });
        resultText = mcpResult.content?.[0]?.text ?? '{}';
      } catch (err) {
        resultText = JSON.stringify({ error: err.message });
      }

      // 通知前端：工具結果已拿到
      let resultObj = {};
      try { resultObj = JSON.parse(resultText); } catch { resultObj = { raw: resultText }; }
      res.write(`data: ${JSON.stringify({ tool_result: resultObj })}\n\n`);

      // ── 帶天氣資料請 AI 串流最終回答（不使用 tool_calls，改用 user message 注入） ──
      const stream = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
          {
            role: 'user',
            content: `[天氣資料已取得，請根據以下資訊回答]\n${resultText}`,
          },
        ],
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

    } else {
      // ══ 路徑 B：一般對話 → 直接串流 ══
      const stream = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        stream: true,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── 啟動（等 MCP 初始化完成後再開始接受請求） ──
initMCP().finally(() => {
  app.listen(port, () => {
    console.log(`Navigator 已啟動：http://localhost:${port}`);
    console.log(`MCP 天氣工具：${mcpClient ? '已連線' : '停用'}`);
  });
});
