const form = document.getElementById('planForm');
const submitBtn = document.getElementById('submitBtn');
const resultBox = document.getElementById('result');
const incidentPanel = document.getElementById('incidentPanel');
const contingencyBox = document.getElementById('contingency');

// Stores the last generated plan text and form inputs for incident calls
let currentPlanText = '';
let currentFormData = {};

// --- Plan generation ---

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  currentFormData = {
    destination: document.getElementById('destination').value.trim(),
    days: parseInt(document.getElementById('days').value),
    people: parseInt(document.getElementById('people').value),
    preferences: document.getElementById('preferences').value.trim()
  };

  submitBtn.disabled = true;
  submitBtn.textContent = '規劃中…';
  incidentPanel.classList.add('hidden');
  contingencyBox.classList.add('hidden');
  contingencyBox.innerHTML = '';
  currentPlanText = '';

  resultBox.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <span>AI 正在規劃行程，請稍候…</span>
    </div>`;

  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentFormData)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '伺服器錯誤');
    }

    currentPlanText = await streamToElement(res, resultBox);
    incidentPanel.classList.remove('hidden');

  } catch (err) {
    resultBox.innerHTML = `<div class="error-msg">錯誤：${escapeHtml(err.message)}</div>`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '產生行程建議';
  }
});

// --- Incident buttons ---

document.querySelectorAll('.incident-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const incident = btn.dataset.incident;
    const labels = { rain: '突發大雨', closed: '景點臨時關閉', delay: '交通延誤' };

    document.querySelectorAll('.incident-btn').forEach(b => b.disabled = true);
    btn.textContent = '應變中…';

    contingencyBox.classList.remove('hidden');
    contingencyBox.innerHTML = `
      <div class="contingency-header">
        <span class="tag-incident">${{ rain: '⛈', closed: '🚫', delay: '⏱' }[incident]} ${labels[incident]}</span>
        <span class="contingency-label">應變備案</span>
      </div>
      <div class="loading">
        <div class="spinner"></div>
        <span>AI 正在生成應變備案…</span>
      </div>`;

    // Scroll to contingency
    contingencyBox.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const res = await fetch('/api/incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...currentFormData, originalPlan: currentPlanText, incident })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '伺服器錯誤');
      }

      // Keep header, stream content below it
      const header = contingencyBox.querySelector('.contingency-header');
      const contentTarget = document.createElement('div');
      contingencyBox.innerHTML = '';
      contingencyBox.appendChild(header);
      contingencyBox.appendChild(contentTarget);

      await streamToElement(res, contentTarget);

    } catch (err) {
      contingencyBox.innerHTML += `<div class="error-msg">錯誤：${escapeHtml(err.message)}</div>`;
    } finally {
      const incidentLabels = { rain: '⛈ 突發大雨', closed: '🚫 景點臨時關閉', delay: '⏱ 交通延誤' };
      document.querySelectorAll('.incident-btn').forEach(b => {
        b.disabled = false;
        b.textContent = incidentLabels[b.dataset.incident];
      });
    }
  });
});

// --- Shared streaming helper ---

async function streamToElement(res, container) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let contentDiv = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') break;

      try {
        const parsed = JSON.parse(data);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) {
          fullText += parsed.text;
          if (!contentDiv) {
            container.innerHTML = '';
            contentDiv = document.createElement('div');
            contentDiv.className = 'result-content';
            container.appendChild(contentDiv);
          }
          contentDiv.innerHTML = renderMarkdown(fullText) + '<span class="cursor"></span>';
        }
      } catch (parseErr) {
        if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr;
      }
    }
  }

  if (contentDiv) {
    contentDiv.innerHTML = renderMarkdown(fullText);
  }

  return fullText;
}

// --- Helpers ---

function renderMarkdown(text) {
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
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
