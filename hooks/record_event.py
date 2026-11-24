#!/usr/bin/env python3
"""Lifecycle hook collector for task-monitor plugin.

Records real-time agent lifecycle events (SessionStart, PreToolUse, PostToolUse,
PreInvocation, PostInvocation, Stop) to PLUGIN_DATA as append-only JSONL +
latest per-conversation live state JSON so the Task Monitor MCP App can show
in-flight tool calls and live status immediately.
"""

import json
import os
import sys
import time
from pathlib import Path


def get_data_dir() -> Path:
    base = os.environ.get("PLUGIN_DATA")
    if base:
        p = Path(base)
    else:
        p = Path.home() / ".gemini" / "antigravity" / "task-monitor-data"
    p.mkdir(parents=True, exist_ok=True)
    return p


def summarize_args(tool_name: str, args: dict) -> str:
    if not isinstance(args, dict):
        return ""
    if tool_name == "run_command":
        summary = args.get("toolSummary") or ""
        cmd = args.get("CommandLine") or ""
        text = f"{summary}: {cmd}" if summary else cmd
        return text[:240]
    if tool_name in ("read_file", "write_file", "edit_file"):
        path = args.get("Path") or args.get("path") or ""
        return str(path)[:240]
    if tool_name == "update_focus":
        return str(args.get("focus") or "")[:200]
    if tool_name == "update_steps":
        steps = args.get("steps") or []
        if isinstance(steps, list):
            done = sum(1 for s in steps if isinstance(s, dict) and s.get("status") == "done")
            in_prog = [s.get("title", "") for s in steps if isinstance(s, dict) and s.get("status") == "in_progress"]
            cur = f" -> {in_prog[0]}" if in_prog else ""
            return f"{done}/{len(steps)} done{cur}"[:200]
    if tool_name == "schedule":
        dur = args.get("DurationSeconds")
        cron = args.get("CronExpression")
        prompt = args.get("Prompt") or ""
        prefix = f"{dur}s" if dur else (str(cron) if cron else "")
        return f"[{prefix}] {prompt}"[:200]
    # Generic fallback
    try:
        s = json.dumps(args, ensure_ascii=False)
        return s[:200]
    except Exception:
        return ""


def atomic_write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        payload = {}

    event = payload.get("hookEventName") or "Unknown"
    conv_id = payload.get("conversationId") or "unknown"
    now = time.time()
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))

    data_dir = get_data_dir()
    conv_dir = data_dir / "conversations"
    conv_dir.mkdir(parents=True, exist_ok=True)

    state_file = conv_dir / f"{conv_id}.json"
    events_file = conv_dir / f"{conv_id}.events.jsonl"

    # Load existing live state
    state = {}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception:
            state = {}

    state["conversationId"] = conv_id
    state["lastEvent"] = event
    state["lastEventAt"] = now
    state["lastEventIso"] = now_iso
    if payload.get("transcriptPath"):
        state["transcriptPath"] = payload["transcriptPath"]
    if payload.get("workspacePaths"):
        state["workspacePaths"] = payload["workspacePaths"]
    if payload.get("lastUserInput"):
        state["lastUserInput"] = str(payload["lastUserInput"])[:300]
    if payload.get("modelName"):
        state["modelName"] = payload["modelName"]

    in_flight = state.get("inFlightTools")
    if not isinstance(in_flight, dict):
        in_flight = {}

    tool_call = payload.get("toolCall") if isinstance(payload.get("toolCall"), dict) else None
    record = {
        "ts": now,
        "iso": now_iso,
        "event": event,
        "stepIdx": payload.get("stepIdx"),
    }

    if event == "SessionStart":
        state["status"] = "active"
        state["startedAt"] = state.get("startedAt") or now
    elif event == "PreInvocation":
        state["status"] = "thinking"
        state["invocationNum"] = payload.get("invocationNum")
    elif event == "PostInvocation":
        state["status"] = "active"
    elif event == "PreToolUse" and tool_call:
        tc_id = str(tool_call.get("id") or f"step-{payload.get('stepIdx')}-{int(now * 1000)}")
        tc_name = str(tool_call.get("name") or "unknown")
        tc_args = tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {}
        summary = summarize_args(tc_name, tc_args)
        state["status"] = "running_tool"
        in_flight[tc_id] = {
            "id": tc_id,
            "name": tc_name,
            "summary": summary,
            "startedAt": now,
            "startedIso": now_iso,
            "stepIdx": payload.get("stepIdx"),
        }
        record["toolId"] = tc_id
        record["toolName"] = tc_name
        record["summary"] = summary
    elif event == "PostToolUse" and tool_call:
        tc_id = str(tool_call.get("id") or "")
        tc_name = str(tool_call.get("name") or "unknown")
        tc_args = tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {}
        err = payload.get("error") or ""
        started = in_flight.pop(tc_id, None)
        duration_sec = round(now - started["startedAt"], 2) if started and "startedAt" in started else None
        state["status"] = "running_tool" if in_flight else "active"
        record["toolId"] = tc_id
        record["toolName"] = tc_name
        record["summary"] = summarize_args(tc_name, tc_args)
        record["durationSec"] = duration_sec
        if err:
            record["error"] = str(err)[:300]
    elif event == "Stop":
        reason = payload.get("terminationReason") or ""
        fully_idle = bool(payload.get("fullyIdle", True))
        state["status"] = "idle" if fully_idle else "background_waiting"
        state["terminationReason"] = reason
        state["fullyIdle"] = fully_idle
        in_flight.clear()
        record["terminationReason"] = reason
        record["fullyIdle"] = fully_idle

    state["inFlightTools"] = in_flight

    try:
        atomic_write_json(state_file, state)
        with events_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass

    # Always return an empty JSON object so we never interfere with permissions or control flow.
    sys.stdout.write("{}\n")


if __name__ == "__main__":
    main()
