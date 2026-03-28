require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = '你是一個旅遊應變專家，專門幫群組旅遊在突發狀況下提供備案建議。請根據使用者輸入的偏好和限制，提供具體可執行的行程建議。若有突發狀況，優先提供應變備案。回答請用繁體中文，格式清楚易讀。';

app.post('/api/plan', async (req, res) => {
  const { destination, days, people, preferences } = req.body;

  if (!destination || !days || !people) {
    return res.status(400).json({ error: '請填寫必要欄位' });
  }

  const userMessage = `目的地：${destination}
旅遊天數：${days} 天
人數：${people} 人
偏好與限制：${preferences || '無特別限制'}

請根據以上條件，提供完整的旅遊行程建議。`;

  await streamGroq(res, userMessage);
});

app.post('/api/incident', async (req, res) => {
  const { originalPlan, incident, destination, days, people, preferences } = req.body;

  if (!originalPlan || !incident) {
    return res.status(400).json({ error: '缺少必要參數' });
  }

  const incidentText = {
    rain: '突發大雨',
    closed: '景點臨時關閉',
    delay: '交通延誤'
  }[incident] || incident;

  const userMessage = `以下是原定行程：

${originalPlan}

---

現在發生突發狀況：【${incidentText}】

旅遊資訊：
- 目的地：${destination}
- 旅遊天數：${days} 天
- 人數：${people} 人
- 偏好與限制：${preferences || '無特別限制'}

請針對此突發狀況，在原行程基礎上提供具體的應變備案。`;

  await streamGroq(res, userMessage);
});

async function streamGroq(res, userMessage) {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ]
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

app.listen(port, () => {
  console.log(`Navigator 已啟動：http://localhost:${port}`);
});
