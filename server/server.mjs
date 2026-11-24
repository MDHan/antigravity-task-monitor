#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listConversations, getConversationDetail } from "./monitor-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URI = "ui://task-monitor/app.html";
const APP_HTML_PATH = path.join(__dirname, "app.html");

let DATA_DIR = path.join(os.homedir(), ".gemini", "antigravity", "task-monitor-data");
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--data-dir=")) {
    const val = arg.slice("--data-dir=".length).trim();
    if (val) DATA_DIR = val;
  }
}

function buildSnapshot(args = {}) {
  const limit = typeof args.limit === "number" ? Math.min(Math.max(args.limit, 1), 50) : 20;
  const conversations = listConversations(DATA_DIR, limit);
  let selectedId = args.conversation_id;
  if (!selectedId || !conversations.some((c) => c.conversationId === selectedId)) {
    selectedId = conversations[0]?.conversationId || null;
  }
  const selected = selectedId
    ? getConversationDetail(DATA_DIR, selectedId, {
        toolFilter: args.tool_filter || "all",
        search: args.search || "",
        maxOps: typeof args.max_ops === "number" ? args.max_ops : 100,
      })
    : null;

  return {
    generatedAtMs: Date.now(),
    conversations,
    selected,
  };
}

const server = new McpServer({
  name: "task-monitor",
  version: "1.3.0",
});

server.registerResource(
  "task-monitor-ui",
  APP_URI,
  {
    title: "任务总览",
    description: "Global task overview across conversations",
    mimeType: "text/html;profile=mcp-app",
    _meta: { ui: { prefersBorder: false } },
  },
  async () => ({
    contents: [
      {
        uri: APP_URI,
        mimeType: "text/html;profile=mcp-app",
        text: fs.readFileSync(APP_HTML_PATH, "utf-8"),
      },
    ],
  })
);

// Global sidebar entrypoint (per-conversation side pane is handled by the auto-bound Sidecar)
server.registerTool(
  "open_task_monitor",
  {
    title: "任务总览",
    description: "打开全局任务总览面板，查看所有近期对话的执行进度、阶段结论、操作记录和后台任务。",
    inputSchema: {
      conversation_id: z.string().optional().describe("可选：指定要查看的会话 ID"),
      limit: z.number().optional().describe("可选：列出最近多少个会话（默认 20）"),
    },
    _meta: {
      ui: { resourceUri: APP_URI },
      "com.google.antigravity/ui": {
        entrypoints: [{ type: "global", title: "任务总览" }],
      },
    },
  },
  async (args) => {
    const snapshot = buildSnapshot(args || {});
    const sel = snapshot.selected;
    const summaryText = sel
      ? `当前查看对话「${sel.title}」：状态=${sel.liveStatus}，距上次更新 ${sel.idleSec} 秒，后台运行中=${sel.backgroundTasks.filter((t) => t.status === "running").length}，总步骤=${sel.totalSteps}。`
      : "暂未发现历史对话。";
    return {
      content: [{ type: "text", text: summaryText }],
      structuredContent: snapshot,
    };
  }
);

server.registerTool(
  "get_monitor_snapshot",
  {
    title: "Get Monitor Snapshot",
    description: "App-only polling endpoint for global task overview.",
    inputSchema: {
      conversation_id: z.string().optional(),
      tool_filter: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
      max_ops: z.number().optional(),
    },
    _meta: { ui: { visibility: ["app"] } },
  },
  async (args) => ({
    content: [{ type: "text", text: "ok" }],
    structuredContent: buildSnapshot(args || {}),
  })
);

server.registerTool(
  "get_task_summary",
  {
    title: "查询任务进度",
    description: "查询指定对话或近期所有对话的进度摘要、后台任务和最近操作。",
    inputSchema: {
      conversation_id: z.string().optional().describe("可选：指定对话 ID"),
    },
  },
  async (args) => {
    if (args?.conversation_id) {
      const detail = getConversationDetail(DATA_DIR, args.conversation_id, { maxOps: 30 });
      return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(listConversations(DATA_DIR, 15), null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
