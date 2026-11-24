import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SidecarApp, Response } from "sidecar_sdk";
import { getConversationDetail } from "../../server/monitor-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env.PLUGIN_DATA ||
  join(homedir(), ".gemini", "antigravity", "task-monitor-data");

const app = new SidecarApp();

app.page("/", () => readFileSync(join(__dirname, "index.html"), "utf-8"));

app.api(
  "/styles.css",
  () =>
    new Response(readFileSync(join(__dirname, "styles.css"), "utf-8"), {
      contentType: "text/css; charset=utf-8",
    }),
  "GET"
);

app.api(
  "/app.js",
  () =>
    new Response(readFileSync(join(__dirname, "app.js"), "utf-8"), {
      contentType: "application/javascript; charset=utf-8",
    }),
  "GET"
);

app.api(
  "/api/status",
  async (data) => {
    const convId =
      (typeof data?.conversationId === "string" && data.conversationId.trim()) ||
      app.config?.conversationId ||
      "";
    if (!convId) {
      return {
        generatedAtMs: Date.now(),
        conversationId: null,
        selected: null,
      };
    }
    const detail = getConversationDetail(DATA_DIR, convId, {
      toolFilter: typeof data?.tool_filter === "string" ? data.tool_filter : "all",
      search: typeof data?.search === "string" ? data.search : "",
      maxOps: 100,
    });
    return {
      generatedAtMs: Date.now(),
      conversationId: convId,
      selected: detail,
    };
  },
  "GET"
);

app.run().catch((err) => {
  console.error("[monitor_panel] failed to start:", err);
  process.exit(1);
});
