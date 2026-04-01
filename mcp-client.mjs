/**
 * ╔══════════════════════════════════════════════════╗
 * ║         MCP Client — Navigator Host 使用          ║
 * ║                                                  ║
 * ║  角色：連接 MCP Server 並代表 Host 呼叫工具        ║
 * ║  · 啟動 mcp-weather-server.mjs 子程序             ║
 * ║  · 透過 stdio 建立連線                             ║
 * ║  · 提供 listTools / callTool 介面給 Host           ║
 * ╚══════════════════════════════════════════════════╝
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createWeatherMCPClient() {
  // 啟動 MCP Server 子程序（stdio 傳輸）
  // StdioClientTransport 只繼承白名單 env（系統路徑等），
  // 自訂 key 必須明確透過 env 選項傳入，SDK 會合併兩者。
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(__dirname, "mcp-weather-server.mjs")],
    env: {
      ...(process.env.CWA_API_KEY ? { CWA_API_KEY: process.env.CWA_API_KEY } : {}),
    },
  });

  const client = new Client(
    { name: "navigator-host", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}
