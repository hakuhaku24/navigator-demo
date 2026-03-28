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

app.post('/api/chat', async (req, res) => {
  const { messages, travelInfo } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '缺少對話內容' });
  }

  let systemPrompt = SYSTEM_PROMPT;
  if (travelInfo && travelInfo.destination) {
    systemPrompt += `\n\n本次旅遊基本資料：目的地：${travelInfo.destination}、${travelInfo.days} 天、${travelInfo.people} 人、偏好與限制：${travelInfo.preferences || '無'}。`;
  }

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
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
});

app.listen(port, () => {
  console.log(`Navigator 已啟動：http://localhost:${port}`);
});
