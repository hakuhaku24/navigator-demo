// ── State ──
let conversationHistory = [];
let travelInfo = {};
let isStreaming = false;

// ── DOM ──
const travelForm  = document.getElementById('travelForm');
const startBtn    = document.getElementById('startBtn');
const messagesEl  = document.getElementById('messages');
const userInput   = document.getElementById('userInput');
const sendBtn     = document.getElementById('sendBtn');

// ── Auto-resize textarea ──
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
});

// ── Send on Enter (Shift+Enter = newline) ──
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) handleSend();
  }
});

// ── Start planning ──
travelForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  travelInfo = {
    destination: document.getElementById('destination').value.trim(),
    days:        parseInt(document.getElementById('days').value),
    people:      parseInt(document.getElementById('people').value),
    preferences: document.getElementById('preferences').value.trim()
  };

  // Reset conversation
  conversationHistory = [];
  messagesEl.innerHTML = '';

  const initMessage =
    `請幫我規劃以下旅遊行程：\n` +
    `目的地：${travelInfo.destination}\n` +
    `旅遊天數：${travelInfo.days} 天\n` +
    `人數：${travelInfo.people} 人\n` +
    `偏好與限制：${travelInfo.preferences || '無特別限制'}\n\n` +
    `請提供完整的逐日行程建議。`;

  await sendMessage(initMessage);

  userInput.disabled = false;
  sendBtn.disabled = false;
  userInput.focus();
});

// ── Manual send ──
sendBtn.addEventListener('click', handleSend);

// ── Incident quick buttons ──
document.querySelectorAll('.incident-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (isStreaming || conversationHistory.length === 0) return;
    userInput.value = btn.dataset.msg;
    userInput.style.height = 'auto';
    handleSend();
  });
});

function handleSend() {
  const text = userInput.value.trim();
  if (!text || isStreaming) return;
  userInput.value = '';
  userInput.style.height = 'auto';
  sendMessage(text);
}

// ── Core: send message → stream response ──
async function sendMessage(text) {
  isStreaming = true;
  setControlsDisabled(true);

  conversationHistory.push({ role: 'user', content: text });
  appendMessage('user', text);

  const aiBubble = appendMessage('assistant', null); // null = show loading dots

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory, travelInfo })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '伺服器錯誤');
    }

    const fullText = await streamToElement(res, aiBubble);
    conversationHistory.push({ role: 'assistant', content: fullText });

  } catch (err) {
    aiBubble.innerHTML = `<div class="error-msg">錯誤：${escapeHtml(err.message)}</div>`;
  } finally {
    isStreaming = false;
    setControlsDisabled(false);
    if (conversationHistory.length > 0) userInput.focus();
  }
}

// ── Append a message bubble, return the bubble element ──
function appendMessage(role, text) {
  const welcome = messagesEl.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const row    = document.createElement('div');
  row.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? '你' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (text === null) {
    bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  } else if (role === 'user') {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = renderMarkdown(text);
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  scrollToBottom();

  return bubble;
}

// ── Stream SSE into a bubble element, return full text ──
async function streamToElement(res, bubble) {
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText     = '';
  let textStarted  = false;
  let toolHtml     = '';   // MCP 工具呼叫 / 結果區塊

  function repaint() {
    if (toolHtml && fullText) {
      bubble.innerHTML = toolHtml +
        '<hr class="tool-divider">' +
        renderMarkdown(fullText) + '<span class="cursor"></span>';
    } else if (toolHtml) {
      bubble.innerHTML = toolHtml;
    } else {
      bubble.innerHTML = renderMarkdown(fullText) + '<span class="cursor"></span>';
    }
    scrollToBottom();
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') break;

      try {
        const parsed = JSON.parse(data);
        if (parsed.error) throw new Error(parsed.error);

        // MCP Client 正在呼叫工具
        if (parsed.tool_call) {
          toolHtml = renderToolCalling(parsed.tool_call);
          repaint();
        }

        // MCP Server 回傳工具結果
        if (parsed.tool_result) {
          toolHtml = renderToolResult(parsed.tool_result);
          repaint();
        }

        // AI 最終文字回答
        if (parsed.text) {
          textStarted = true;
          fullText += parsed.text;
          repaint();
        }
      } catch (e) {
        if (e.message !== 'Unexpected end of JSON input') throw e;
      }
    }
  }

  // 移除游標、最終渲染
  if (toolHtml && fullText) {
    bubble.innerHTML = toolHtml + '<hr class="tool-divider">' + renderMarkdown(fullText);
  } else if (fullText) {
    bubble.innerHTML = renderMarkdown(fullText);
  } else if (!toolHtml) {
    bubble.innerHTML = '';
  }

  return fullText;
}

// ── MCP 工具呼叫中：顯示 Loading 狀態 ──
function renderToolCalling(toolCall) {
  const loc  = escapeHtml(toolCall.arguments?.location || '');
  const date = escapeHtml(toolCall.arguments?.date || '今天');
  return `<div class="mcp-tool-calling">
    <span class="mcp-spinner"></span>
    <span>正在透過 <strong>MCP</strong> 查詢 <strong>${loc}</strong> <strong>${date}</strong> 天氣資料…</span>
  </div>`;
}

// ── MCP 工具結果：顯示天氣卡片 ──
function renderToolResult(r) {
  const safe = s => escapeHtml(String(s ?? '—'));
  const dateLabel = r.forecast_date
    ? `<span class="mcp-date">${safe(r.forecast_date)}</span>`
    : '';
  return `<div class="mcp-tool-result">
    <div class="mcp-result-header">
      <span class="mcp-icon">📡</span>
      <span class="mcp-title">MCP 工具回傳</span>
      ${dateLabel}
      <span class="mcp-source">${safe(r.source)}</span>
    </div>
    <div class="weather-grid">
      <div class="weather-cell"><span class="wl">地點</span><span>${safe(r.location)}</span></div>
      <div class="weather-cell"><span class="wl">氣溫</span><span>${safe(r.temperature)}</span></div>
      <div class="weather-cell"><span class="wl">天氣</span><span>${safe(r.condition)}</span></div>
      <div class="weather-cell"><span class="wl">濕度</span><span>${safe(r.humidity)}</span></div>
      <div class="weather-cell"><span class="wl">降雨機率</span><span>${safe(r.precipitation)}</span></div>
      <div class="weather-cell weather-cell--wide"><span class="wl">預報</span><span>${safe(r.forecast)}</span></div>
    </div>
    ${r.travel_advice ? `<div class="weather-advice">⚠ ${escapeHtml(r.travel_advice)}</div>` : ''}
  </div>`;
}

// ── Enable / disable controls while streaming ──
function setControlsDisabled(disabled) {
  startBtn.disabled = disabled;
  sendBtn.disabled  = disabled;
  userInput.disabled = disabled;
  document.querySelectorAll('.incident-btn').forEach(b => b.disabled = disabled);
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Minimal Markdown renderer ──
function renderMarkdown(text) {
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .split('\n\n')
    .map(block => {
      if (block.startsWith('<h3>') || block.startsWith('<ul>') || block.startsWith('<ol>')) return block;
      if (block.trim() === '') return '';
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
