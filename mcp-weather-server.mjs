/**
 * ╔══════════════════════════════════════════════════╗
 * ║         MCP Server — Navigator 天氣工具           ║
 * ║                                                  ║
 * ║  角色：提供工具的「服務端」                          ║
 * ║  · 宣告自己擁有哪些工具（ListTools）               ║
 * ║  · 執行工具並回傳結果（CallTool）                  ║
 * ║  · 透過 stdio 與 MCP Client 通訊                  ║
 * ╚══════════════════════════════════════════════════╝
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

// ── 台灣各地模擬天氣資料（示範用，可替換為真實 API） ──
const MOCK_WEATHER = {
  台北:  { temperature: "22–28°C", condition: "多雲時晴", humidity: "75%", wind: "東北風 3 級", precipitation: "20%", forecast: "午後局部地區有短暫陣雨，晚間轉涼" },
  臺北:  { temperature: "22–28°C", condition: "多雲時晴", humidity: "75%", wind: "東北風 3 級", precipitation: "20%", forecast: "午後局部地區有短暫陣雨，晚間轉涼" },
  花蓮:  { temperature: "24–30°C", condition: "晴",       humidity: "68%", wind: "東南風 2 級", precipitation: "10%", forecast: "天氣穩定，能見度佳，適合戶外活動" },
  墾丁:  { temperature: "26–32°C", condition: "晴時多雲", humidity: "80%", wind: "東北風 5 級", precipitation: "15%", forecast: "海面風浪中浪，戶外水上活動請留意安全" },
  高雄:  { temperature: "25–31°C", condition: "晴",       humidity: "65%", wind: "西南風 2 級", precipitation: "5%",  forecast: "晴朗炎熱，注意防曬補水" },
  台南:  { temperature: "25–31°C", condition: "晴",       humidity: "65%", wind: "西南風 2 級", precipitation: "5%",  forecast: "晴朗炎熱，注意防曬補水" },
  臺南:  { temperature: "25–31°C", condition: "晴",       humidity: "65%", wind: "西南風 2 級", precipitation: "5%",  forecast: "晴朗炎熱，注意防曬補水" },
  台中:  { temperature: "23–29°C", condition: "多雲",     humidity: "70%", wind: "東南風 2 級", precipitation: "25%", forecast: "山區有零星雲霧，下午有局部陣雨" },
  臺中:  { temperature: "23–29°C", condition: "多雲",     humidity: "70%", wind: "東南風 2 級", precipitation: "25%", forecast: "山區有零星雲霧，下午有局部陣雨" },
  日月潭:{ temperature: "18–24°C", condition: "多雲有霧", humidity: "85%", wind: "東北風 1 級", precipitation: "35%", forecast: "山區霧氣濃厚，午後有零星降雨" },
  阿里山:{ temperature: "12–18°C", condition: "多雲有霧", humidity: "90%", wind: "東北風 2 級", precipitation: "40%", forecast: "高山霧氣，氣溫偏低，請攜帶保暖衣物" },
  台東:  { temperature: "24–30°C", condition: "晴",       humidity: "72%", wind: "東南風 3 級", precipitation: "10%", forecast: "東部天氣穩定，適合騎車旅遊" },
  臺東:  { temperature: "24–30°C", condition: "晴",       humidity: "72%", wind: "東南風 3 級", precipitation: "10%", forecast: "東部天氣穩定，適合騎車旅遊" },
  澎湖:  { temperature: "22–27°C", condition: "多雲",     humidity: "76%", wind: "東北風 5–6 級", precipitation: "20%", forecast: "離島風較強，海面達中浪，注意船班異動" },
  金門:  { temperature: "20–25°C", condition: "晴",       humidity: "72%", wind: "東北風 4 級", precipitation: "10%", forecast: "風速偏強，但天氣晴朗，適合觀光" },
  宜蘭:  { temperature: "20–26°C", condition: "陰有雨",   humidity: "85%", wind: "東北風 4 級", precipitation: "60%", forecast: "迎風面降雨機率高，請備好雨具" },
  基隆:  { temperature: "19–24°C", condition: "陰有雨",   humidity: "85%", wind: "東北風 4 級", precipitation: "65%", forecast: "雨都，降雨頻繁，強烈建議攜帶雨具" },
  新竹:  { temperature: "22–28°C", condition: "多雲",     humidity: "68%", wind: "東北風 4–5 級", precipitation: "15%", forecast: "風城，東北風偏強，體感較實際氣溫涼" },
  嘉義:  { temperature: "24–30°C", condition: "晴",       humidity: "65%", wind: "西南風 2 級", precipitation: "10%", forecast: "晴朗舒適，阿里山山區溫差大請注意" },
  屏東:  { temperature: "25–32°C", condition: "晴",       humidity: "70%", wind: "東北風 3 級", precipitation: "10%", forecast: "南部晴熱，前往墾丁注意海上風浪" },
  新北:  { temperature: "21–27°C", condition: "多雲",     humidity: "78%", wind: "東北風 3 級", precipitation: "25%", forecast: "山區有零星降雨，都市區晴間多雲" },
};

// ── Mock fallback：先比對 MOCK_WEATHER，再用 LOCATION_TO_COUNTY 找縣市 ──
function lookupWeather(location) {
  // 直接比對 mock
  if (MOCK_WEATHER[location]) return { ...MOCK_WEATHER[location] };
  for (const [key, data] of Object.entries(MOCK_WEATHER)) {
    if (location.includes(key) || key.includes(location)) return { ...data };
  }
  // 透過 LOCATION_TO_COUNTY 找縣市，再比對縣市 mock
  const county = LOCATION_TO_COUNTY[location];
  if (county) {
    const countyShort = county.replace(/[市縣]$/, "");
    for (const [key, data] of Object.entries(MOCK_WEATHER)) {
      if (county.includes(key) || key.includes(countyShort)) return { ...data };
    }
  }
  return { ...MOCK_WEATHER["台北"], forecast: `${location} 查無對應縣市資料，以台北天氣替代` };
}

// ── 地名 → CWA 縣市名稱對照表（縣市 + 常見景點） ──
const LOCATION_TO_COUNTY = {
  // 直轄市／縣市
  台北: "臺北市", 臺北: "臺北市",
  新北: "新北市",
  桃園: "桃園市",
  台中: "臺中市", 臺中: "臺中市",
  台南: "臺南市", 臺南: "臺南市",
  高雄: "高雄市",
  基隆: "基隆市",
  新竹: "新竹市",
  嘉義: "嘉義市",
  宜蘭: "宜蘭縣",
  花蓮: "花蓮縣",
  台東: "臺東縣", 臺東: "臺東縣",
  屏東: "屏東縣",
  苗栗: "苗栗縣",
  彰化: "彰化縣",
  南投: "南投縣",
  雲林: "雲林縣",
  澎湖: "澎湖縣",
  金門: "金門縣",
  連江: "連江縣", 馬祖: "連江縣",
  // 新北景點
  九份: "新北市", 金瓜石: "新北市",
  淡水: "新北市", 漁人碼頭: "新北市",
  野柳: "新北市", 鼻頭角: "新北市",
  烏來: "新北市", 平溪: "新北市",
  十分: "新北市", 碧潭: "新北市",
  三峽: "新北市", 鶯歌: "新北市",
  // 台北景點
  陽明山: "臺北市", 北投: "臺北市",
  象山: "臺北市", 貓空: "臺北市",
  // 桃園景點
  拉拉山: "桃園市", 復興: "桃園市",
  // 苗栗景點
  三義: "苗栗縣", 南庄: "苗栗縣",
  獅頭山: "苗栗縣",
  // 台中景點
  清境: "南投縣",   // 清境在南投，常被誤以為台中
  大坑: "臺中市", 逢甲: "臺中市",
  // 南投景點
  日月潭: "南投縣", 埔里: "南投縣",
  合歡山: "南投縣", 廬山: "南投縣",
  奧萬大: "南投縣", 惠蓀: "南投縣",
  九族: "南投縣", 霧社: "南投縣",
  // 嘉義景點
  阿里山: "嘉義縣", 奮起湖: "嘉義縣",
  // 台南景點
  安平: "臺南市", 奇美: "臺南市",
  七股: "臺南市", 四草: "臺南市",
  // 高雄景點
  左營: "高雄市", 旗津: "高雄市",
  美濃: "高雄市", 茂林: "高雄市",
  // 屏東景點
  墾丁: "屏東縣", 恆春: "屏東縣",
  小琉球: "屏東縣", 琉球: "屏東縣",
  三地門: "屏東縣", 霧台: "屏東縣",
  // 宜蘭景點
  礁溪: "宜蘭縣", 羅東: "宜蘭縣",
  蘇澳: "宜蘭縣", 冬山: "宜蘭縣",
  // 花蓮景點
  太魯閣: "花蓮縣", 秀林: "花蓮縣",
  瑞穗: "花蓮縣", 光復: "花蓮縣",
  玉里: "花蓮縣", 富里: "花蓮縣",
  // 台東景點
  綠島: "臺東縣", 蘭嶼: "臺東縣",
  三仙台: "臺東縣", 池上: "臺東縣",
  關山: "臺東縣", 鹿野: "臺東縣",
  知本: "臺東縣", 成功: "臺東縣",
};

// ── 解析日期描述 → 距今天數 ──
function parseDateOffset(dateStr) {
  if (!dateStr || /今天|今日|今晚|現在/.test(dateStr)) return 0;
  if (/明天|明日|明晚/.test(dateStr)) return 1;
  if (/後天/.test(dateStr)) return 2;
  if (/大後天/.test(dateStr)) return 3;
  if (/下(禮拜|週|周)/.test(dateStr)) return 7;

  // 週一～週日（取「下一個」出現的星期幾）
  const dayNamesZH = ['日', '一', '二', '三', '四', '五', '六'];
  for (let i = 0; i < dayNamesZH.length; i++) {
    if (dateStr.includes(`週${dayNamesZH[i]}`) || dateStr.includes(`星期${dayNamesZH[i]}`)) {
      const today = new Date().getDay();
      let diff = i - today;
      if (diff <= 0) diff += 7;
      return diff;
    }
  }
  return 0;
}

// ── 找縣市名稱 ──
function resolveCounty(location) {
  let county = LOCATION_TO_COUNTY[location];
  if (!county) {
    for (const [k, v] of Object.entries(LOCATION_TO_COUNTY)) {
      if (location.includes(k) || k.includes(location)) { county = v; break; }
    }
  }
  return county ?? null;
}

// ── CWA F-D0047-089：縣市一週預報（3 小時間隔） ──
async function fetchCWAWeekly(county, dayOffset, key) {
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-089` +
    `?Authorization=${key}&LocationName=${encodeURIComponent(county)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;

  const json = await res.json();
  const loc = json?.records?.Locations?.[0]?.Location?.[0];
  if (!loc) return null;

  const elMap = {};
  for (const e of loc.WeatherElement) elMap[e.ElementName] = e.Time;

  // 計算目標日期，若超出 API 涵蓋範圍就取最後一天
  const target = new Date();
  target.setDate(target.getDate() + dayOffset);

  // API 實際涵蓋的最晚日期
  const wxAll = elMap['天氣現象'] ?? [];
  const availDates = [...new Set(wxAll.map(t => (t.StartTime ?? '').slice(0, 10)))].filter(Boolean).sort();
  if (!availDates.length) return null;

  let targetDateStr = target.toISOString().slice(0, 10);
  const isBeyondRange = targetDateStr > availDates.at(-1);
  if (isBeyondRange) targetDateStr = availDates.at(-1); // 用最後一天代替

  // 篩出目標日的各時段
  const wxDay    = wxAll.filter(t => (t.StartTime ?? '').startsWith(targetDateStr));
  const tempDay  = (elMap['溫度']           ?? []).filter(t => (t.DataTime  ?? '').startsWith(targetDateStr));
  const popDay   = (elMap['3小時降雨機率']  ?? []).filter(t => (t.StartTime ?? '').startsWith(targetDateStr));
  const humidDay = (elMap['相對濕度']       ?? []).filter(t => (t.DataTime  ?? '').startsWith(targetDateStr));
  const wsDay    = (elMap['風速']           ?? []).filter(t => (t.DataTime  ?? '').startsWith(targetDateStr));
  const wdDay    = (elMap['風向']           ?? []).filter(t => (t.DataTime  ?? '').startsWith(targetDateStr));
  const descDay  = (elMap['天氣預報綜合描述'] ?? []).filter(t => (t.StartTime ?? '').startsWith(targetDateStr));

  if (!wxDay.length && !tempDay.length) return null;

  // 白天代表時段（優先取 09:00 或 12:00）
  const dayHour = (t, key) => parseInt((t[key] ?? '').slice(11, 13));
  const daytimeWx = wxDay.find(t => [9, 12].includes(dayHour(t, 'StartTime'))) ?? wxDay[0];
  const condition = daytimeWx?.ElementValue?.[0]?.Weather ?? '—';

  // 氣溫：全天最低 / 最高
  const temps = tempDay.map(t => +(t.ElementValue?.[0]?.Temperature ?? NaN)).filter(n => !isNaN(n));
  const minT = temps.length ? Math.min(...temps) : null;
  const maxT = temps.length ? Math.max(...temps) : null;

  // 降雨機率：全天最大值
  const pops = popDay.map(t => +(t.ElementValue?.[0]?.ProbabilityOfPrecipitation ?? 0));
  const maxPoP = pops.length ? Math.max(...pops) : null;

  // 濕度：白天平均
  const daytimeHumid = humidDay.filter(t => { const h = dayHour(t, 'DataTime'); return h >= 6 && h <= 18; });
  const avgHumid = daytimeHumid.length
    ? Math.round(daytimeHumid.reduce((s, t) => s + +(t.ElementValue?.[0]?.RelativeHumidity ?? 0), 0) / daytimeHumid.length)
    : null;

  // 風：取中午時段
  const noonWs = wsDay.find(t => dayHour(t, 'DataTime') === 12) ?? wsDay[0];
  const noonWd = wdDay.find(t => dayHour(t, 'DataTime') === 12) ?? wdDay[0];
  const windDir = noonWd?.ElementValue?.[0]?.WindDirection ?? '';
  const beaufort = noonWs?.ElementValue?.[0]?.BeaufortScale ?? '';
  const wind = windDir && beaufort ? `${windDir} ${beaufort} 級` : '—';

  // 綜合描述（取第一段）
  const descText = descDay[0]?.ElementValue?.[0]?.WeatherDescription;

  const note = isBeyondRange ? `（超出預報範圍，以 ${targetDateStr} 資料替代）` : '';

  return {
    temperature: (minT !== null && maxT !== null) ? `${minT}–${maxT}°C` : '—',
    condition,
    humidity: avgHumid !== null ? `${avgHumid}%` : '—',
    wind,
    precipitation: maxPoP !== null ? `${maxPoP}%` : '—',
    forecast: descText
      ? descText.slice(0, 60) + (descText.length > 60 ? '…' : '')
      : `${condition}，降雨機率 ${maxPoP ?? '?'}%（${county}）`,
    source: `中央氣象署 CWA 即時 API${note}`,
    forecast_date: targetDateStr,
  };
}

// ── CWA F-C0032-001：36 小時預報（今天 / 明天後備） ──
async function fetchCWA36h(county, dayOffset, key) {
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001` +
    `?Authorization=${key}&locationName=${encodeURIComponent(county)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;

  const json = await res.json();
  const loc = json?.records?.location?.[0];
  if (!loc) return null;

  const el = {};
  for (const e of loc.weatherElement) el[e.elementName] = e.time;

  // 3 個 12 小時時段：[0]=今天白天, [1]=今晚, [2]=明天
  const idx = dayOffset === 0 ? 0 : Math.min(dayOffset * 2, 2);
  const getP = (name) => el[name]?.[idx]?.parameter?.parameterName ?? '—';
  const startTime = el['Wx']?.[idx]?.startTime ?? '';

  return {
    temperature: `${getP('MinT')}–${getP('MaxT')}°C`,
    condition: getP('Wx'),
    humidity: '—',
    wind: '—',
    precipitation: `${getP('PoP')}%`,
    forecast: `${getP('Wx')}，降雨機率 ${getP('PoP')}%（${county}）`,
    source: '中央氣象署 CWA 即時 API',
    forecast_date: startTime.slice(0, 10) || new Date(Date.now() + dayOffset * 86400000).toISOString().slice(0, 10),
  };
}

// ── 主查詢：優先用週預報，後備 36h 預報 ──
async function fetchCWAWeather(location, dateStr = '今天') {
  const key = process.env.CWA_API_KEY;
  if (!key) return null;

  const county = resolveCounty(location);
  if (!county) return null;

  const dayOffset = parseDateOffset(dateStr);

  // 嘗試週預報
  try {
    const w = await fetchCWAWeekly(county, dayOffset, key);
    if (w) return w;
  } catch { /* 繼續 */ }

  // 後備：36 小時預報（僅今天/明天有效）
  if (dayOffset <= 1) {
    try {
      const w = await fetchCWA36h(county, dayOffset, key);
      if (w) return w;
    } catch { /* 繼續 */ }
  }

  return null;
}

// ── 根據天氣產生旅遊建議 ──
function travelAdvice(w) {
  const tips = [];
  const pop = parseInt(w.precipitation) || 0;
  const maxT = parseInt((w.temperature || "").split("–")[1]) || 25;
  if (pop >= 50)                     tips.push("降雨機率偏高，建議攜帶雨具");
  if (w.condition.includes("霧"))     tips.push("霧氣影響能見度，山路駕駛請謹慎");
  if (w.condition.includes("雨"))     tips.push("注意積水路面，酌情調整戶外行程");
  if (/[56]/.test(w.wind ?? ""))      tips.push("風速偏強，高空景觀台及海上活動請留意");
  if (maxT >= 32)                     tips.push("高溫炎熱，注意防曬並多補充水分");
  if (maxT <= 15)                     tips.push("氣溫偏低，請攜帶保暖外套");
  return tips.length ? tips.join("；") : "天氣狀況良好，適合戶外旅遊";
}

// ════════════════════════════════════════════════════
//  建立 MCP Server
// ════════════════════════════════════════════════════
const server = new Server(
  { name: "navigator-weather-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── 宣告工具清單 ──
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_weather",
      description:
        "查詢台灣指定地點的即時天氣狀況與旅遊建議，包含溫度、天氣狀況、濕度、降雨機率、風速及注意事項",
      inputSchema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "查詢的台灣地點，例如：台北、花蓮、墾丁、高雄、阿里山、日月潭",
          },
          date: {
            type: "string",
            description: "查詢的日期，例如：今天、明天、後天、週三、下禮拜。預設為今天。",
          },
        },
        required: ["location"],
      },
    },
  ],
}));

// ── 執行工具 ──
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "get_weather") {
    throw new McpError(ErrorCode.MethodNotFound, `未知工具: ${request.params.name}`);
  }

  const location = request.params.arguments?.location;
  const dateStr  = request.params.arguments?.date ?? '今天';
  if (!location) {
    throw new McpError(ErrorCode.InvalidParams, "缺少必要參數 location");
  }

  // 優先呼叫 CWA API，失敗則用模擬資料
  let weather = null;
  try { weather = await fetchCWAWeather(location, dateStr); } catch { /* fallback */ }

  const source = weather ? weather.source : "模擬資料（示範用，不分日期相同）";
  if (!weather) weather = lookupWeather(location);

  const result = {
    location,
    ...weather,
    source,
    travel_advice: travelAdvice(weather),
    queried_at: new Date().toISOString(),
  };

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

// ── 啟動（stdio 傳輸） ──
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[MCP Weather Server] 啟動成功，等待 Client 連線...\n");
