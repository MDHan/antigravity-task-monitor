import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const result = await esbuild.build({
  entryPoints: [path.join(__dirname, "ui-src", "app.js")],
  bundle: true,
  format: "esm",
  minify: true,
  write: false,
  target: "es2022",
});

const jsCode = result.outputFiles[0].text;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>任务监控台</title>
<style>
  :root {
    --bg: var(--color-background-primary, #ffffff);
    --bg2: var(--color-background-secondary, #f6f7f9);
    --bg3: var(--color-background-tertiary, #eceff3);
    --fg: var(--color-text-primary, #111827);
    --fg2: var(--color-text-secondary, #6b7280);
    --fg3: var(--color-text-tertiary, #9ca3af);
    --border: var(--color-border-primary, rgba(15, 23, 42, 0.08));
    --info: var(--color-text-info, #2563eb);
    --info-bg: var(--color-background-info, rgba(37, 99, 235, 0.1));
    --warn: var(--color-text-warning, #d97706);
    --warn-bg: var(--color-background-warning, rgba(217, 119, 6, 0.11));
    --danger: var(--color-text-danger, #dc2626);
    --danger-bg: var(--color-background-danger, rgba(220, 38, 38, 0.1));
    --ok: var(--color-text-success, #16a34a);
    --ok-bg: var(--color-background-success, rgba(22, 163, 74, 0.1));
    --font: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 14px 14px 18px;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font);
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

  /* Unified SVG Icons */
  .ic {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex-shrink: 0;
    display: inline-block;
    vertical-align: middle;
  }
  .ic-sm { width: 13px; height: 13px; }
  .ic-ok { color: var(--ok); }
  .ic-info { color: var(--info); }
  .ic-warn { color: var(--warn); }
  .ic-danger { color: var(--danger); }
  .ic-muted { color: var(--fg3); }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .conv-select {
    flex: 1;
    min-width: 0;
    background: var(--bg2);
    color: var(--fg);
    border: 1px solid transparent;
    border-radius: 9px;
    padding: 6px 10px;
    font-size: 12.5px;
    font-weight: 500;
    outline: none;
    cursor: pointer;
  }
  .conv-select:hover, .conv-select:focus { border-color: var(--border); }
  .session-lock {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg2);
    border-radius: 9px;
    padding: 5px 8px 5px 10px;
  }
  .session-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--fg);
  }
  .mini-icon-btn {
    background: transparent;
    color: var(--fg3);
    border: none;
    border-radius: 6px;
    width: 22px;
    height: 22px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .mini-icon-btn:hover { background: var(--bg3); color: var(--fg); }
  .header-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .live-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--bg2);
    color: var(--fg2);
    border: none;
    border-radius: 999px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
  }
  .live-on { color: var(--ok); background: var(--ok-bg); }
  .icon-btn {
    background: var(--bg2);
    color: var(--fg2);
    border: none;
    border-radius: 9px;
    width: 28px;
    height: 28px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover { background: var(--bg3); color: var(--fg); }

  /* Dots */
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .dot-ok { background: var(--ok); }
  .dot-info { background: var(--info); }
  .dot-warn { background: var(--warn); }
  .dot-muted { background: var(--fg3); }

  /* Hero Card */
  .hero {
    background: var(--bg2);
    border-radius: 12px;
    padding: 13px 14px;
    margin-bottom: 14px;
  }
  .hero-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 9px;
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
  }
  .pill-ok { background: var(--ok-bg); color: var(--ok); }
  .pill-info { background: var(--info-bg); color: var(--info); }
  .pill-warn { background: var(--warn-bg); color: var(--warn); }
  .pill-muted { background: var(--bg3); color: var(--fg2); }
  .silence {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--fg2);
  }
  .silence-warn { color: var(--warn); }
  .silence-danger { color: var(--danger); }
  .hero-focus {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--fg);
    margin-bottom: 9px;
    word-break: break-word;
  }
  .bar {
    height: 4px;
    background: var(--bg3);
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 9px;
  }
  .bar-fill { height: 100%; background: var(--ok); border-radius: 999px; transition: width 0.25s ease; }
  .hero-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 11.5px;
    color: var(--fg2);
  }

  /* Segmented Tabs */
  .tabs {
    display: flex;
    gap: 4px;
    background: var(--bg2);
    padding: 3px;
    border-radius: 10px;
    margin-bottom: 14px;
  }
  .tab {
    flex: 1;
    background: transparent;
    color: var(--fg2);
    border: none;
    border-radius: 7px;
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .tab:hover { color: var(--fg); }
  .tab-on {
    background: var(--bg);
    color: var(--fg);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
  .tab-n { font-size: 11px; color: var(--fg3); font-weight: 500; }

  /* Sections */
  .section { margin-bottom: 16px; }
  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 7px;
  }
  .sec-label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--fg2);
    margin-bottom: 7px;
  }
  .sec-head .sec-label { margin-bottom: 0; }
  .sec-meta { font-size: 11.5px; color: var(--fg3); }

  /* Steps */
  .steps { display: flex; flex-direction: column; gap: 8px; padding: 2px 0; }
  .step { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; }
  .step-ic { margin-top: 2px; display: inline-flex; }
  .step-done { color: var(--fg3); }
  .step-done .step-tx { text-decoration: line-through; }
  .step-in_progress { color: var(--fg); font-weight: 600; }
  .step-failed { color: var(--danger); }

  /* Clean List Group */
  .list-group {
    background: var(--bg2);
    border-radius: 10px;
    overflow: hidden;
  }
  .list-row {
    padding: 9px 11px;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
  }
  .list-row:last-child { border-bottom: none; }
  .list-row:hover { background: var(--bg3); }
  .row-muted { opacity: 0.7; }
  .row-main { display: flex; align-items: center; gap: 9px; }
  .row-ic { display: inline-flex; }
  .row-body { flex: 1; min-width: 0; }
  .row-title {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-sub {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--fg2);
    margin-top: 2px;
  }
  .tag-inline {
    font-size: 10.5px;
    font-weight: 600;
    padding: 0 5px;
    border-radius: 4px;
  }
  .tag-warn { background: var(--warn-bg); color: var(--warn); }
  .tag-muted { background: var(--bg3); color: var(--fg2); }
  .tag-soft { background: var(--info-bg); color: var(--info); }
  .chevron { color: var(--fg3); display: inline-flex; }

  /* Intermediate Thoughts */
  .thoughts-list { display: flex; flex-direction: column; gap: 8px; }
  .thought-item {
    background: var(--bg2);
    border-radius: 10px;
    padding: 9px 11px;
    cursor: pointer;
  }
  .thought-item:hover { background: var(--bg3); }
  .thought-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .thought-ic { color: var(--info); display: inline-flex; }
  .thought-time { font-size: 11px; color: var(--fg3); }
  .thought-sum {
    font-size: 12.5px;
    color: var(--fg);
    line-height: 1.5;
    word-break: break-word;
  }
  .thought-full {
    margin-top: 7px;
    padding-top: 7px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--fg2);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.55;
  }

  /* Operations Timeline */
  .toolbar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
  .search-box {
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--bg2);
    border: 1px solid transparent;
    border-radius: 9px;
    padding: 0 10px;
  }
  .search-box:focus-within { border-color: var(--info); }
  .search-ic { color: var(--fg3); display: inline-flex; }
  .search {
    flex: 1;
    background: transparent;
    color: var(--fg);
    border: none;
    padding: 6px 0;
    font-size: 12px;
    outline: none;
  }
  .chips { display: flex; gap: 5px; flex-wrap: wrap; }
  .chip {
    background: var(--bg2);
    color: var(--fg2);
    border: none;
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 11.5px;
    cursor: pointer;
  }
  .chip-on { background: var(--info-bg); color: var(--info); font-weight: 600; }
  .ops-wrap { display: flex; flex-direction: column; }
  .op-item {
    padding: 8px 6px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    border-radius: 7px;
  }
  .op-item:last-child { border-bottom: none; }
  .op-item:hover { background: var(--bg2); }
  .op-err { background: var(--danger-bg); }
  .op-line { display: flex; align-items: center; gap: 8px; }
  .op-ic { display: inline-flex; color: var(--fg2); }
  .cat-ic-command { color: var(--info); }
  .cat-ic-edit { color: var(--warn); }
  .cat-ic-read { color: var(--fg2); }
  .op-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }
  .op-meta { font-size: 11px; color: var(--fg3); flex-shrink: 0; }

  .detail-box {
    margin: 7px 0 2px;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 11px;
    color: var(--fg2);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 160px;
    overflow-y: auto;
  }

  .ghost-link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: none;
    border: none;
    color: var(--fg2);
    font-size: 11.5px;
    padding: 4px 2px;
    cursor: pointer;
  }
  .ghost-link:hover { color: var(--info); }
  .err-bar {
    background: var(--danger-bg);
    color: var(--danger);
    border-radius: 8px;
    padding: 7px 10px;
    margin-bottom: 10px;
    font-size: 12px;
  }
  .empty { text-align: center; color: var(--fg2); padding: 36px 12px; }
  .empty-title { font-weight: 600; font-size: 13.5px; }
  .empty-inline { color: var(--fg3); font-size: 12px; padding: 6px 2px; }
  .foot { text-align: center; font-size: 11px; color: var(--fg3); margin-top: 10px; }
</style>
</head>
<body>
<div id="app"></div>
<script type="module">
${jsCode}
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, "app.html"), html, "utf-8");
console.log(`Built app.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
