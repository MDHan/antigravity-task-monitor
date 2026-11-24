import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BRAIN_DIR = path.join(os.homedir(), ".gemini", "antigravity", "brain");
const transcriptCache = new Map();

function unwrapJsonString(val) {
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

function parseIsoMs(s) {
  if (!s || typeof s !== "string") return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

function categorizeTool(name) {
  if (!name) return "other";
  if (name === "run_command") return "command";
  if (["write_file", "edit_file", "multi_replace_file_content", "replace_file_content"].includes(name)) return "edit";
  if (["read_file", "view_file", "list_dir", "grep_search", "find_by_name"].includes(name)) return "read";
  if (["update_steps", "update_focus"].includes(name)) return "status";
  if (["schedule", "manage_task"].includes(name)) return "schedule";
  return "other";
}

function summarizeToolArgs(name, rawArgs) {
  const args = {};
  if (rawArgs && typeof rawArgs === "object") {
    for (const [k, v] of Object.entries(rawArgs)) {
      args[k] = unwrapJsonString(v);
    }
  }
  if (name === "run_command") {
    const sum = args.toolSummary ? String(args.toolSummary) : "";
    const cmd = args.CommandLine ? String(args.CommandLine) : "";
    return {
      summary: sum || cmd.slice(0, 100) || "执行命令",
      detail: cmd,
      args,
    };
  }
  if (["read_file", "write_file", "edit_file"].includes(name)) {
    const p = String(args.Path || args.path || "");
    const base = p ? path.basename(p) : name;
    return { summary: base, detail: p, args };
  }
  if (name === "update_focus") {
    const f = String(args.focus || "");
    return { summary: f || "更新当前焦点", detail: f, args };
  }
  if (name === "update_steps") {
    const steps = Array.isArray(args.steps) ? args.steps : [];
    const done = steps.filter((s) => s?.status === "done").length;
    const cur = steps.find((s) => s?.status === "in_progress");
    const summary = cur ? `${done}/${steps.length} · ${cur.title}` : `${done}/${steps.length} 完成`;
    return { summary, detail: JSON.stringify(steps, null, 2), args };
  }
  if (name === "schedule") {
    const dur = args.DurationSeconds ? `${args.DurationSeconds}s` : (args.CronExpression || "");
    const prompt = String(args.Prompt || "");
    return { summary: `[${dur}] ${prompt.slice(0, 80)}`, detail: prompt, args };
  }
  const detail = JSON.stringify(args);
  return { summary: detail.slice(0, 100), detail, args };
}

function extractUserTitle(content) {
  if (!content || typeof content !== "string") return "";
  let text = content;
  const m = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  if (m) text = m[1];
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, 90);
}

function cleanMarkdownSnippet(text, maxLen = 120) {
  const s = String(text || "")
    .replace(/```[\s\S]*?```/g, " [代码] ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  const first = s.split(/(?<=[。！？.!?])\s+/)[0] || s;
  return first.length > maxLen ? first.slice(0, maxLen) + "…" : first;
}

function parseGenericTiming(content) {
  if (!content || typeof content !== "string") return {};
  const created = content.match(/Created At:\s*([^\n]+)/);
  const completed = content.match(/Completed At:\s*([^\n]+)/);
  const exitCode = content.match(/Command exited with code\s+(-?\d+)/);
  let durationSec = null;
  if (created && completed) {
    const c1 = Date.parse(created[1].trim());
    const c2 = Date.parse(completed[1].trim());
    if (!Number.isNaN(c1) && !Number.isNaN(c2)) {
      durationSec = Math.max(0, Math.round(((c2 - c1) / 1000) * 10) / 10);
    }
  }
  const isError =
    (exitCode && Number(exitCode[1]) !== 0) ||
    /\b(Error|Exception|FAILED|Traceback)\b/.test(content.slice(0, 400));
  return {
    durationSec,
    exitCode: exitCode ? Number(exitCode[1]) : null,
    isError,
  };
}

function createTurn(index, prompt, startedAtMs) {
  return {
    turnIndex: index,
    prompt: prompt || `第 ${index} 轮`,
    startedAtMs: startedAtMs || null,
    lastActivityMs: startedAtMs || null,
    stepCount: 0,
    latestFocus: "",
    latestSteps: [],
    notes: [],
    operations: [],
    bgTaskIds: [],
  };
}

export function parseTranscript(convId, transcriptPath) {
  let stat;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    return null;
  }

  const cached = transcriptCache.get(transcriptPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.data;
  }

  let raw = "";
  try {
    raw = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.split("\n");
  let title = "";
  let startedAtMs = null;
  let lastTranscriptAtMs = null;
  let totalSteps = 0;
  let model = "";
  const turns = [];
  let currentTurn = null;
  const bgTasks = new Map();
  let pendingToolOps = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    totalSteps += 1;
    const stepIdx = d.step_index ?? totalSteps;
    const tsMs = parseIsoMs(d.created_at);
    if (tsMs) {
      if (!startedAtMs || tsMs < startedAtMs) startedAtMs = tsMs;
      if (!lastTranscriptAtMs || tsMs > lastTranscriptAtMs) lastTranscriptAtMs = tsMs;
    }
    if (d.model) model = d.model;

    if (d.type === "USER_INPUT") {
      const promptText = extractUserTitle(d.content);
      if (!title && promptText) title = promptText;
      currentTurn = createTurn(turns.length + 1, promptText, tsMs);
      turns.push(currentTurn);
      pendingToolOps = [];
      continue;
    }

    if (!currentTurn) {
      currentTurn = createTurn(1, title || "当前任务", tsMs);
      turns.push(currentTurn);
    }

    currentTurn.stepCount += 1;
    if (tsMs) {
      if (!currentTurn.startedAtMs) currentTurn.startedAtMs = tsMs;
      currentTurn.lastActivityMs = tsMs;
    }

    if (d.type === "PLANNER_RESPONSE") {
      const calledTools = Array.isArray(d.tool_calls)
        ? d.tool_calls.map((tc) => tc.name).filter((n) => n && !["update_focus", "update_steps"].includes(n))
        : [];
      const rawContent = typeof d.content === "string" ? d.content.trim() : "";
      const rawThinking = typeof d.thinking === "string" ? d.thinking.trim() : "";

      if (rawContent.length >= 10) {
        currentTurn.notes.push({
          kind: "reply",
          stepIdx,
          tsMs,
          iso: d.created_at || null,
          summary: cleanMarkdownSnippet(rawContent, 110),
          text: rawContent.slice(0, 1200),
          tools: calledTools,
        });
      }
      if (rawThinking.length >= 24) {
        currentTurn.notes.push({
          kind: "thought",
          stepIdx,
          tsMs,
          iso: d.created_at || null,
          summary: cleanMarkdownSnippet(rawThinking, 110),
          text: rawThinking.slice(0, 1200),
          tools: calledTools,
        });
      }

      if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) {
        pendingToolOps = [];
        for (const tc of d.tool_calls) {
          const name = tc.name || "unknown";
          const parsed = summarizeToolArgs(name, tc.args);
          if (name === "update_focus" && parsed.detail) {
            currentTurn.latestFocus = parsed.detail;
          } else if (name === "update_steps" && Array.isArray(parsed.args?.steps)) {
            currentTurn.latestSteps = parsed.args.steps.map((s) => ({
              title: String(s?.title || ""),
              status: String(s?.status || "pending"),
            }));
          }
          const op = {
            stepIdx,
            tsMs,
            iso: d.created_at || null,
            tool: name,
            category: categorizeTool(name),
            summary: parsed.summary,
            detail: parsed.detail.slice(0, 600),
            status: "done",
            durationSec: null,
            isError: false,
          };
          currentTurn.operations.push(op);
          pendingToolOps.push(op);
        }
      }
    } else if (d.type === "GENERIC") {
      const content = String(d.content || "");
      const timing = parseGenericTiming(content);
      let matchedOp = null;
      if (pendingToolOps.length > 0) {
        matchedOp = pendingToolOps.shift();
        if (timing.durationSec !== null) matchedOp.durationSec = timing.durationSec;
        if (timing.isError) matchedOp.isError = true;
        if (d.status === "RUNNING") matchedOp.status = "running";
      }
      const bgMatch = content.match(/background task with task id:\s*([^\s\n]+)/);
      if (bgMatch) {
        const taskId = bgMatch[1];
        const descMatch = content.match(/Task Description:\s*([^\n]+)/);
        const rawDesc = descMatch ? descMatch[1].trim().slice(0, 400) : content.slice(0, 240);
        const friendlyTitle =
          matchedOp && matchedOp.summary && matchedOp.summary !== "run_command"
            ? matchedOp.summary
            : rawDesc.slice(0, 80);
        const timerMatch = friendlyTitle.match(/^\[(\d+)s\]/);
        const isTimer = matchedOp?.tool === "schedule" || Boolean(timerMatch);
        const expectedDurationSec = timerMatch ? Number(timerMatch[1]) : null;
        bgTasks.set(taskId, {
          taskId,
          turnIndex: currentTurn.turnIndex,
          stepIdx,
          startedAtMs: tsMs,
          startedIso: d.created_at || null,
          title: friendlyTitle,
          description: rawDesc,
          isTimer,
          expectedDurationSec,
          status: d.status === "RUNNING" ? "running" : "done",
          lastUpdateMs: tsMs,
          lastNote: "",
        });
        currentTurn.bgTaskIds.push(taskId);
      }
    } else if (d.type === "SYSTEM_MESSAGE") {
      const content = String(d.content || "");
      const senderMatch = content.match(/sender=([^\s\n\]]+)/);
      if (senderMatch && bgTasks.has(senderMatch[1])) {
        const task = bgTasks.get(senderMatch[1]);
        task.lastUpdateMs = tsMs || task.lastUpdateMs;
        const lower = content.toLowerCase();
        if (lower.includes("still running") || lower.includes("notification timeout")) {
          task.status = "running";
          task.lastNote = "运行中";
        } else if (
          lower.includes("completed") ||
          lower.includes("exited") ||
          lower.includes("finished") ||
          lower.includes("terminated") ||
          lower.includes("failed") ||
          lower.includes("killed") ||
          lower.includes("canceled") ||
          lower.includes("cancelled") ||
          lower.includes("expired") ||
          lower.includes("timer") ||
          lower.includes("triggered") ||
          lower.includes("fired")
        ) {
          task.status = "done";
          task.lastNote = "已结束";
        }
      }
    }
  }

  const data = {
    conversationId: convId,
    transcriptPath,
    title: title || convId.slice(0, 8),
    model,
    startedAtMs,
    lastTranscriptAtMs,
    totalSteps,
    turns,
    bgTasksMap: Object.fromEntries(bgTasks.entries()),
  };

  transcriptCache.set(transcriptPath, { mtimeMs: stat.mtimeMs, size: stat.size, data });
  return data;
}

export function readHookState(dataDir, convId) {
  if (!dataDir || !convId) return null;
  const statePath = path.join(dataDir, "conversations", `${convId}.json`);
  try {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch {
    return null;
  }
}

export function listConversations(dataDir, limit = 20) {
  const convMap = new Map();
  if (fs.existsSync(BRAIN_DIR)) {
    for (const entry of fs.readdirSync(BRAIN_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const convId = entry.name;
      const tPath = path.join(BRAIN_DIR, convId, ".system_generated", "logs", "transcript.jsonl");
      if (fs.existsSync(tPath)) {
        try {
          const st = fs.statSync(tPath);
          convMap.set(convId, { convId, transcriptPath: tPath, mtimeMs: st.mtimeMs });
        } catch {}
      }
    }
  }

  const sorted = Array.from(convMap.values())
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  const nowMs = Date.now();
  return sorted.map((item) => {
    const parsed = parseTranscript(item.convId, item.transcriptPath);
    const hook = readHookState(dataDir, item.convId);
    const hookLastMs = hook?.lastEventAt ? Math.round(hook.lastEventAt * 1000) : null;
    const lastActivityMs = Math.max(parsed?.lastTranscriptAtMs || 0, hookLastMs || 0, item.mtimeMs || 0);
    const idleSec = Math.max(0, Math.round((nowMs - lastActivityMs) / 1000));
    const allBg = parsed?.bgTasksMap ? Object.values(parsed.bgTasksMap) : [];
    const runningBgCount = allBg.filter((t) => t.status === "running").length;

    let liveStatus = "idle";
    if (hook?.status && hook.status !== "idle" && idleSec < 3600) {
      liveStatus = hook.status;
    } else if (runningBgCount > 0) {
      liveStatus = "background_waiting";
    } else if (idleSec < 120) {
      liveStatus = "active";
    }

    return {
      conversationId: item.convId,
      shortId: item.convId.slice(0, 8),
      title: parsed?.title || item.convId.slice(0, 8),
      liveStatus,
      idleSec,
      totalTurns: parsed?.turns?.length || 0,
      runningBgCount,
    };
  });
}

export function getConversationDetail(dataDir, convId, opts = {}) {
  const { toolFilter = "all", search = "", maxOps = 100 } = opts;
  const tPath = path.join(BRAIN_DIR, convId, ".system_generated", "logs", "transcript.jsonl");
  const hook = readHookState(dataDir, convId);
  const resolvedPath = fs.existsSync(tPath) ? tPath : (hook?.transcriptPath || null);
  const parsed = resolvedPath ? parseTranscript(convId, resolvedPath) : null;

  const nowMs = Date.now();
  const turns = parsed?.turns || [];
  const curTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const bgMap = parsed?.bgTasksMap || {};

  const hookLastMs = hook?.lastEventAt ? Math.round(hook.lastEventAt * 1000) : null;
  const lastActivityMs = Math.max(parsed?.lastTranscriptAtMs || 0, hookLastMs || 0) || nowMs;
  const idleSec = Math.max(0, Math.round((nowMs - lastActivityMs) / 1000));

  // Current turn timing (NOT whole conversation!)
  const turnStartMs = curTurn?.startedAtMs || lastActivityMs;
  const turnEndRefMs = hook?.status === "idle" && curTurn?.lastActivityMs ? curTurn.lastActivityMs : nowMs;
  const turnDurationSec = Math.max(0, Math.round((turnEndRefMs - turnStartMs) / 1000));

  // Current turn background tasks (+ any still-running background tasks in this conversation)
  const curBgIds = new Set(curTurn?.bgTaskIds || []);
  const currentBgTasks = Object.values(bgMap)
    .map((t) => {
      const elapsedSec = t.startedAtMs ? Math.max(0, Math.round((nowMs - t.startedAtMs) / 1000)) : null;
      let status = t.status;
      let lastNote = t.lastNote;
      if (status === "running" && t.isTimer && t.expectedDurationSec && elapsedSec !== null && elapsedSec > t.expectedDurationSec + 10) {
        status = "done";
        lastNote = "已触发";
      }
      return { ...t, status, lastNote, elapsedSec };
    })
    .filter((t) => curBgIds.has(t.taskId) || t.status === "running")
    .sort((a, b) => (b.startedAtMs || 0) - (a.startedAtMs || 0));

  const runningBgCount = currentBgTasks.filter((t) => t.status === "running").length;

  let liveStatus = "idle";
  if (hook?.status && hook.status !== "idle" && idleSec < 3600) {
    liveStatus = hook.status;
  } else if (runningBgCount > 0) {
    liveStatus = "background_waiting";
  } else if (idleSec < 120) {
    liveStatus = "active";
  }

  const isMonitoringActive =
    liveStatus === "running_tool" ||
    liveStatus === "thinking" ||
    liveStatus === "background_waiting" ||
    runningBgCount > 0;

  let waitLevel = "ok";
  if (isMonitoringActive) {
    if (idleSec >= 1200) waitLevel = "alert";
    else if (idleSec >= 600) waitLevel = "warn";
  }

  // Current turn operations
  const curOps = curTurn?.operations ? [...curTurn.operations] : [];
  const q = (search || "").trim().toLowerCase();
  const filteredOps = curOps
    .filter((op) => {
      if (toolFilter === "error") return op.isError;
      if (toolFilter && toolFilter !== "all") return op.category === toolFilter;
      return true;
    })
    .filter((op) => {
      if (!q) return true;
      return (
        (op.tool || "").toLowerCase().includes(q) ||
        (op.summary || "").toLowerCase().includes(q) ||
        (op.detail || "").toLowerCase().includes(q)
      );
    })
    .reverse()
    .slice(0, maxOps);

  const curNotes = curTurn?.notes ? [...curTurn.notes].reverse() : [];
  const replyNotes = curNotes.filter((n) => n.kind === "reply");
  const thoughtNotes = curNotes.filter((n) => n.kind === "thought");

  // Previous turns -> clean summary list + full drill-down detail for each turn (newest first)
  const historyTurns = turns
    .slice(0, -1)
    .reverse()
    .map((t) => {
      const tReplies = t.notes.filter((n) => n.kind === "reply").reverse();
      const lastReply = tReplies[0];
      const dur =
        t.startedAtMs && t.lastActivityMs
          ? Math.max(0, Math.round((t.lastActivityMs - t.startedAtMs) / 1000))
          : 0;
      const tBgs = (t.bgTaskIds || [])
        .map((id) => bgMap[id])
        .filter(Boolean)
        .map((b) => ({
          ...b,
          elapsedSec: b.startedAtMs ? Math.max(0, Math.round((nowMs - b.startedAtMs) / 1000)) : null,
        }));

      const editedFiles = [];
      const seenFiles = new Set();
      let cmdCount = 0;
      let errorCount = 0;
      for (const o of t.operations) {
        if (o.isError) errorCount += 1;
        if (o.category === "edit" && o.summary && !seenFiles.has(o.summary)) {
          seenFiles.add(o.summary);
          editedFiles.push(o.summary);
        } else if (o.category === "command") {
          cmdCount += 1;
        }
      }

      const steps = t.latestSteps || [];
      const stepsTotal = steps.length;
      const stepsDone = steps.filter((s) => s.status === "done").length;

      return {
        turnIndex: t.turnIndex,
        prompt: t.prompt,
        startedAtMs: t.startedAtMs,
        durationSec: dur,
        stepCount: t.stepCount,
        latestFocus: t.latestFocus || "",
        summary: lastReply?.summary || t.latestFocus || "",
        replies: tReplies.slice(0, 10),
        steps,
        stepsTotal,
        stepsDone,
        editedFiles: editedFiles.slice(0, 16),
        cmdCount,
        errorCount,
        opCount: t.operations.length,
        bgCount: tBgs.length,
        backgroundTasks: tBgs,
        operations: t.operations
          .filter((o) => o.category !== "status")
          .reverse()
          .slice(0, 40),
      };
    });

  return {
    conversationId: convId,
    shortId: convId.slice(0, 8),
    title: parsed?.title || hook?.lastUserInput || "当前对话",
    liveStatus,
    waitLevel,
    idleSec,
    // Current turn stats (primary)
    turnIndex: curTurn?.turnIndex || 1,
    totalTurns: turns.length,
    turnPrompt: curTurn?.prompt || parsed?.title || "当前任务",
    turnDurationSec,
    turnStepCount: curTurn?.stepCount || 0,
    latestFocus: curTurn?.latestFocus || "",
    latestSteps: curTurn?.latestSteps || [],
    latestNote: replyNotes[0] || thoughtNotes[0] || null,
    replyNotes: replyNotes.slice(0, 30),
    thoughtNotes: thoughtNotes.slice(0, 30),
    backgroundTasks: currentBgTasks,
    operations: filteredOps,
    totalOperationsCount: curOps.length,
    // Previous turns (secondary / History tab)
    historyTurns,
  };
}
