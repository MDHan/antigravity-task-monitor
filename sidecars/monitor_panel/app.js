(() => {
  const ICONS = {
    refresh: `<svg class="ic" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>`,
    clock: `<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>`,
    activity: `<svg class="ic" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    terminal: `<svg class="ic" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
    edit: `<svg class="ic" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    file: `<svg class="ic" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    layers: `<svg class="ic" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    sparkle: `<svg class="ic" viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/></svg>`,
    history: `<svg class="ic" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
    check: `<svg class="ic ic-ok" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>`,
    running: `<svg class="ic ic-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>`,
    pending: `<svg class="ic ic-muted" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>`,
    error: `<svg class="ic ic-danger" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    search: `<svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    chevronRight: `<svg class="ic ic-sm" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>`,
    chevronDown: `<svg class="ic ic-sm" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>`,
  };

  const state = {
    data: null,
    activeTab: "overview", // overview | notes | timeline | history
    showRawThoughts: false,
    toolFilter: "all",
    search: "",
    autoRefresh: true,
    expandedOps: new Set(),
    expandedBg: new Set(),
    expandedNotes: new Set(),
    expandedHistory: new Set(),
    polling: false,
    error: null,
    lastConvId: "",
  };

  let pollTimer = null;
  const params = new URLSearchParams(location.search);
  const getConversationId = () =>
    window.sidecar?.conversationId || params.get("conversationId") || "";

  function syncScheme() {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;color:var(--background, #ffffff)";
    document.documentElement.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    const nums = (color.match(/[\d.]+/g) || []).map(Number);
    if (nums.length < 3) return;
    const scale = color.startsWith("color(") ? 1 : 255;
    const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const theme = lum < 0.5 ? "dark" : "light";
    if (document.documentElement.dataset.theme !== theme) {
      document.documentElement.dataset.theme = theme;
    }
  }
  syncScheme();
  new MutationObserver(() => syncScheme()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDuration(sec) {
    if (sec === null || sec === undefined || Number.isNaN(sec)) return "-";
    sec = Math.max(0, Math.floor(sec));
    if (sec < 60) return `${sec}秒`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}小时${rm}分` : `${h}小时`;
  }

  function fmtShortTime(ms) {
    if (!ms) return "--:--";
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" });
  }

  function cleanLabel(text, maxLen = 44) {
    if (!text) return "当前任务";
    let s = String(text).replace(/\s+/g, " ").trim();
    if (/^ssh\s+/i.test(s)) {
      const hostMatch = s.match(/([a-zA-Z0-9._-]+@[\d.]+|\b\d{1,3}(?:\.\d{1,3}){3}\b)/);
      return hostMatch ? `远程任务 (${hostMatch[1]})` : "远程服务器任务";
    }
    if (/^python3?\s+-m\s+py_compile/i.test(s)) {
      const fileMatch = s.match(/([^/\s]+\.py)\b/);
      return fileMatch ? `同步并运行 ${fileMatch[1]}` : "远程脚本任务";
    }
    if (/^python3?\s+-/i.test(s)) return "脚本任务";
    s = s.replace(/\/[^\s]+\/([^/\s]+)/g, "$1");
    return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
  }

  function statusMeta(status) {
    switch (status) {
      case "running_tool":
        return { label: "执行中", dot: "dot-info", cls: "pill-info" };
      case "thinking":
        return { label: "思考中", dot: "dot-info", cls: "pill-info" };
      case "background_waiting":
        return { label: "后台执行中", dot: "dot-warn", cls: "pill-warn" };
      case "active":
        return { label: "进行中", dot: "dot-ok", cls: "pill-ok" };
      default:
        return { label: "已暂停", dot: "dot-muted", cls: "pill-muted" };
    }
  }

  function categoryIcon(cat, isError) {
    if (isError) return ICONS.error;
    if (cat === "command") return ICONS.terminal;
    if (cat === "edit") return ICONS.edit;
    if (cat === "read") return ICONS.file;
    if (cat === "schedule") return ICONS.clock;
    return ICONS.activity;
  }

  function stepIconSvg(status) {
    if (status === "done") return ICONS.check;
    if (status === "in_progress") return ICONS.running;
    if (status === "failed") return ICONS.error;
    return ICONS.pending;
  }

  function renderBgRow(t) {
    const isRun = t.status === "running";
    const isExp = state.expandedBg.has(t.taskId);
    const title = cleanLabel(t.title || t.description, 46);
    return `
      <div class="list-row ${isRun ? "" : "row-muted"}" data-bg-id="${esc(t.taskId)}">
        <div class="row-main">
          <span class="row-ic ${isRun ? "ic-warn" : "ic-muted"}">${ICONS.layers}</span>
          <div class="row-body">
            <div class="row-title">${esc(title)}</div>
            <div class="row-sub">
              <span class="tag-inline ${isRun ? "tag-warn" : "tag-muted"}">${isRun ? "运行中" : "已结束"}</span>
              <span>${fmtShortTime(t.startedAtMs)} 启动</span>
              ${isRun ? `<span>·</span><span>已跑 ${fmtDuration(t.elapsedSec)}</span>` : ""}
            </div>
          </div>
          <span class="chevron">${isExp ? ICONS.chevronDown : ICONS.chevronRight}</span>
        </div>
        ${isExp ? `<pre class="detail-box mono">${esc(t.description)}</pre>` : ""}
      </div>
    `;
  }

  function renderNoteRow(n, i) {
    const key = `n-${n.kind}-${n.stepIdx}-${i}`;
    const isExp = state.expandedNotes.has(key);
    const badge = n.kind === "reply" ? "阶段进展" : "内部思考(原文)";
    return `
      <div class="note-card" data-note-key="${esc(key)}">
        <div class="note-head">
          <span class="note-ic">${ICONS.sparkle}</span>
          <span class="mono note-time">${fmtShortTime(n.tsMs)}</span>
          <span class="tag-inline ${n.kind === "reply" ? "tag-soft" : "tag-muted"}">${badge}</span>
          <span class="chevron" style="margin-left:auto">${isExp ? ICONS.chevronDown : ICONS.chevronRight}</span>
        </div>
        <div class="note-sum">${esc(n.summary)}</div>
        ${isExp && n.text !== n.summary ? `<div class="note-full">${esc(n.text)}</div>` : ""}
      </div>
    `;
  }

  function renderOpRow(op, i) {
    const key = `${op.stepIdx}-${op.tool}-${i}`;
    const isExp = state.expandedOps.has(key);
    return `
      <div class="op-item ${op.isError ? "op-err" : ""}" data-op-key="${esc(key)}">
        <div class="op-line">
          <span class="op-ic cat-ic-${esc(op.category)}">${categoryIcon(op.category, op.isError)}</span>
          <span class="op-text">${esc(cleanLabel(op.summary, 42))}</span>
          <span class="mono op-meta">${op.durationSec !== null && op.durationSec !== undefined ? `${op.durationSec}s · ` : ""}${fmtShortTime(op.tsMs)}</span>
        </div>
        ${isExp && op.detail ? `<pre class="detail-box mono">${esc(op.detail)}</pre>` : ""}
      </div>
    `;
  }

  function renderHistoryTurn(ht) {
    const key = `ht-${ht.turnIndex}`;
    const isExp = state.expandedHistory.has(key);
    const files = ht.editedFiles || [];
    const cmds = ht.keyCommands || [];
    const metaBadges = [
      ht.stepsTotal > 0 ? `步骤 ${ht.stepsDone}/${ht.stepsTotal}` : "",
      files.length > 0 ? `改了 ${files.length} 个文件` : "",
      cmds.length > 0 ? `${cmds.length} 次命令` : "",
      ht.bgCount > 0 ? `${ht.bgCount} 个后台` : "",
      ht.errorCount > 0 ? `${ht.errorCount} 个报错` : "",
    ].filter(Boolean);

    return `
      <div class="note-card" data-ht-key="${esc(key)}">
        <div class="note-head">
          <span class="note-ic">${ICONS.history}</span>
          <span class="tag-inline tag-muted">第 ${ht.turnIndex} 轮</span>
          <span class="mono note-time">${fmtShortTime(ht.startedAtMs)} · ${fmtDuration(ht.durationSec)}</span>
          ${ht.errorCount > 0 ? `<span class="tag-inline" style="background:var(--danger-bg);color:var(--danger)">有报错</span>` : ""}
          <span class="chevron" style="margin-left:auto">${isExp ? ICONS.chevronDown : ICONS.chevronRight}</span>
        </div>
        <div class="note-sum">${esc(cleanLabel(ht.prompt, 56))}</div>
        ${
          isExp
            ? `<div class="history-body">` +
              (ht.summary ? `<div class="hist-summary">${esc(ht.summary)}</div>` : "") +
              (metaBadges.length > 0 ? `<div class="hist-stats">${metaBadges.map((b) => `<span>${esc(b)}</span>`).join("<span>·</span>")}</div>` : "") +
              (files.length > 0
                ? `<div><div class="hist-block-label">改动文件</div><div class="file-pills">${files.map((f) => `<span class="file-pill"><span class="cat-ic-edit">${ICONS.edit}</span><span class="mono">${esc(f)}</span></span>`).join("")}</div></div>`
                : "") +
              (cmds.length > 0
                ? `<div><div class="hist-block-label">关键命令</div><div class="hist-cmd-list">${cmds.map((c) => `<div class="hist-cmd"><span class="${c.isError ? "ic-danger" : "cat-ic-command"}">${c.isError ? ICONS.error : ICONS.terminal}</span><span class="hist-cmd-text">${esc(cleanLabel(c.summary, 40))}</span>${c.durationSec !== null && c.durationSec !== undefined ? `<span class="mono op-meta">${c.durationSec}s</span>` : ""}</div>`).join("")}</div></div>`
                : "") +
              (!ht.summary && files.length === 0 && cmds.length === 0 ? `<div class="empty-inline">本轮为纯问答，无文件或命令改动</div>` : "") +
              `</div>`
            : ""
        }
      </div>
    `;
  }

  function render() {
    const root = document.getElementById("app");
    const sel = state.data?.selected;

    if (!state.data) {
      root.innerHTML = `<div class="empty">正在读取当前对话进度...</div>`;
      return;
    }

    if (!sel) {
      root.innerHTML = `
        <div class="header">
          <div class="header-title"><span class="header-name">任务进度</span></div>
          <button id="btn-refresh" class="icon-btn" title="刷新">${ICONS.refresh}</button>
        </div>
        <div class="empty">当前对话尚无执行记录</div>
      `;
      bindEvents();
      return;
    }

    const st = statusMeta(sel.liveStatus);
    const allBg = sel.backgroundTasks || [];
    const runningBg = allBg.filter((t) => t.status === "running");
    const steps = sel.latestSteps || [];
    const stepsDone = steps.filter((s) => s.status === "done").length;
    const pct = steps.length > 0 ? Math.round((stepsDone / steps.length) * 100) : 0;
    const replyNotes = sel.replyNotes || [];
    const thoughtNotes = sel.thoughtNotes || [];
    const historyTurns = sel.historyTurns || [];

    const waitCls =
      sel.waitLevel === "alert" ? "wait-danger" : sel.waitLevel === "warn" ? "wait-warn" : "";

    let tabHtml = "";
    if (state.activeTab === "overview") {
      const latestNoteHtml = sel.latestNote
        ? `
        <div class="section">
          <div class="sec-head">
            <span class="sec-label">本轮进展</span>
            <button class="ghost-link" data-tab="notes"><span>全部</span>${ICONS.chevronRight}</button>
          </div>
          ${renderNoteRow(sel.latestNote, 0)}
        </div>
      `
        : "";

      const stepsHtml =
        steps.length > 0
          ? `
        <div class="section">
          <div class="sec-head">
            <span class="sec-label">本轮步骤</span>
            <span class="sec-meta mono">${stepsDone}/${steps.length}</span>
          </div>
          <div class="steps">
            ${steps
              .map(
                (s) => `
              <div class="step step-${esc(s.status)}">
                <span class="step-ic">${stepIconSvg(s.status)}</span>
                <span class="step-tx">${esc(s.title)}</span>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `
          : "";

      const bgHtml =
        runningBg.length > 0
          ? `
        <div class="section">
          <div class="sec-head">
            <span class="sec-label">运行中的后台任务</span>
            <span class="sec-meta">${runningBg.length} 个</span>
          </div>
          <div class="list-group">${runningBg.map(renderBgRow).join("")}</div>
        </div>
      `
          : "";

      const recentOps = (sel.operations || []).filter((o) => o.category !== "status").slice(0, 4);
      const recentHtml =
        recentOps.length > 0
          ? `
        <div class="section">
          <div class="sec-head">
            <span class="sec-label">本轮最近操作</span>
            <button class="ghost-link" data-tab="timeline"><span>全部 (${sel.totalOperationsCount})</span>${ICONS.chevronRight}</button>
          </div>
          <div class="ops-wrap">${recentOps.map(renderOpRow).join("")}</div>
        </div>
      `
          : "";

      tabHtml = latestNoteHtml + stepsHtml + bgHtml + recentHtml;
      if (!tabHtml) {
        tabHtml = `<div class="empty-inline">本轮刚开始，暂无中间操作记录</div>`;
      }
    } else if (state.activeTab === "notes") {
      const list = state.showRawThoughts
        ? [...replyNotes, ...thoughtNotes].sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0))
        : replyNotes;
      tabHtml = `
        <div class="toolbar">
          <div class="chips">
            <button class="chip ${!state.showRawThoughts ? "chip-on" : ""}" id="btn-notes-zh">阶段进展 (${replyNotes.length})</button>
            <button class="chip ${state.showRawThoughts ? "chip-on" : ""}" id="btn-notes-all">含内部思考原文 (${thoughtNotes.length})</button>
          </div>
        </div>
        <div class="notes-list">
          ${list.length > 0 ? list.map(renderNoteRow).join("") : `<div class="empty-inline">本轮暂无进展记录</div>`}
        </div>
      `;
    } else if (state.activeTab === "timeline") {
      const filters = [
        { key: "all", label: "全部" },
        { key: "command", label: "命令" },
        { key: "edit", label: "修改" },
        { key: "read", label: "读取" },
        { key: "error", label: "报错" },
      ];
      tabHtml = `
        <div class="toolbar">
          <div class="search-box">
            <span class="search-ic">${ICONS.search}</span>
            <input id="inp-search" class="search" type="text" placeholder="搜索本轮命令或文件..." value="${esc(state.search)}" />
          </div>
          <div class="chips">
            ${filters
              .map(
                (f) =>
                  `<button class="chip ${state.toolFilter === f.key ? "chip-on" : ""}" data-filter="${f.key}">${f.label}</button>`
              )
              .join("")}
          </div>
        </div>
        <div class="ops-wrap">
          ${(sel.operations || []).length > 0 ? sel.operations.map(renderOpRow).join("") : `<div class="empty-inline">本轮暂无匹配记录</div>`}
        </div>
      `;
    } else if (state.activeTab === "history") {
      tabHtml = `
        <div class="notes-list">
          ${historyTurns.length > 0 ? historyTurns.map(renderHistoryTurn).join("") : `<div class="empty-inline">当前是本对话第 1 轮，暂无历史记录</div>`}
        </div>
      `;
    }

    root.innerHTML = `
      <div class="header">
        <div class="header-title" title="${esc(sel.turnPrompt)}">
          <span class="header-name">第 ${sel.turnIndex} 轮 · ${esc(cleanLabel(sel.turnPrompt, 18))}</span>
        </div>
        <div class="header-actions">
          <button id="btn-auto" class="live-pill ${state.autoRefresh ? "live-on" : ""}" title="切换自动刷新">
            <span class="dot ${state.autoRefresh ? "dot-ok" : "dot-muted"}"></span>
            <span>${state.autoRefresh ? "自动刷新" : "已暂停"}</span>
          </button>
          <button id="btn-refresh" class="icon-btn" title="立即刷新">${ICONS.refresh}</button>
        </div>
      </div>

      ${state.error ? `<div class="err-bar">${esc(state.error)}</div>` : ""}

      <div class="hero">
        <div class="hero-top">
          <span class="status-pill ${st.cls}">
            <span class="dot ${st.dot}"></span>${st.label}
          </span>
          <span class="wait-time ${waitCls}">
            ${ICONS.clock}<span>距上次更新 <strong>${fmtDuration(sel.idleSec)}</strong></span>
          </span>
        </div>
        <div class="hero-focus">${esc(cleanLabel(sel.latestFocus || sel.turnPrompt, 72))}</div>
        ${steps.length > 0 ? `<div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>` : ""}
        <div class="hero-meta">
          <span>本轮耗时 <strong>${fmtDuration(sel.turnDurationSec)}</strong></span>
          <span>·</span>
          <span>${sel.turnStepCount} 步</span>
          ${runningBg.length > 0 ? `<span>·</span><span>后台 ${runningBg.length}</span>` : ""}
          ${steps.length > 0 ? `<span>·</span><span>完成 ${pct}%</span>` : ""}
        </div>
      </div>

      <div class="tabs">
        <button class="tab ${state.activeTab === "overview" ? "tab-on" : ""}" data-tab="overview">本轮</button>
        <button class="tab ${state.activeTab === "notes" ? "tab-on" : ""}" data-tab="notes">进展 <span class="tab-n">${replyNotes.length}</span></button>
        <button class="tab ${state.activeTab === "timeline" ? "tab-on" : ""}" data-tab="timeline">操作 <span class="tab-n">${sel.totalOperationsCount}</span></button>
        <button class="tab ${state.activeTab === "history" ? "tab-on" : ""}" data-tab="history">历史 <span class="tab-n">${historyTurns.length}</span></button>
      </div>

      <div class="content">${tabHtml}</div>

      <div class="foot">仅显示当前对话 · 更新于 ${fmtShortTime(state.data.generatedAtMs)}</div>
    `;

    bindEvents();
  }

  function bindEvents() {
    const btnRefresh = document.getElementById("btn-refresh");
    if (btnRefresh) btnRefresh.onclick = () => fetchStatus();

    const btnAuto = document.getElementById("btn-auto");
    if (btnAuto) {
      btnAuto.onclick = () => {
        state.autoRefresh = !state.autoRefresh;
        schedulePoll();
        render();
      };
    }

    const btnZh = document.getElementById("btn-notes-zh");
    if (btnZh) btnZh.onclick = () => { state.showRawThoughts = false; render(); };

    const btnAll = document.getElementById("btn-notes-all");
    if (btnAll) btnAll.onclick = () => { state.showRawThoughts = true; render(); };

    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.onclick = () => { state.activeTab = btn.getAttribute("data-tab"); render(); };
    });

    const inpSearch = document.getElementById("inp-search");
    if (inpSearch) {
      inpSearch.oninput = (e) => { state.search = e.target.value; fetchStatus(); };
    }

    document.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.onclick = () => { state.toolFilter = btn.getAttribute("data-filter"); fetchStatus(); };
    });

    document.querySelectorAll("[data-op-key]").forEach((row) => {
      row.onclick = () => {
        const key = row.getAttribute("data-op-key");
        if (state.expandedOps.has(key)) state.expandedOps.delete(key);
        else state.expandedOps.add(key);
        render();
      };
    });

    document.querySelectorAll("[data-bg-id]").forEach((row) => {
      row.onclick = () => {
        const id = row.getAttribute("data-bg-id");
        if (state.expandedBg.has(id)) state.expandedBg.delete(id);
        else state.expandedBg.add(id);
        render();
      };
    });

    document.querySelectorAll("[data-note-key]").forEach((row) => {
      row.onclick = () => {
        const key = row.getAttribute("data-note-key");
        if (state.expandedNotes.has(key)) state.expandedNotes.delete(key);
        else state.expandedNotes.add(key);
        render();
      };
    });

    document.querySelectorAll("[data-ht-key]").forEach((row) => {
      row.onclick = () => {
        const key = row.getAttribute("data-ht-key");
        if (state.expandedHistory.has(key)) state.expandedHistory.delete(key);
        else state.expandedHistory.add(key);
        render();
      };
    });
  }

  async function fetchStatus() {
    if (state.polling) return;
    state.polling = true;
    try {
      const convId = getConversationId();
      if (convId !== state.lastConvId) {
        state.lastConvId = convId;
        state.expandedOps.clear();
        state.expandedBg.clear();
        state.expandedNotes.clear();
        state.expandedHistory.clear();
      }
      const qs = new URLSearchParams();
      if (convId) qs.set("conversationId", convId);
      if (state.toolFilter && state.toolFilter !== "all") qs.set("tool_filter", state.toolFilter);
      if (state.search) qs.set("search", state.search);
      const fn = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
      const res = await fn(`./api/status?${qs.toString()}`, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
      state.error = null;
      render();
    } catch (err) {
      state.error = `刷新失败: ${err?.message || String(err)}`;
      render();
    } finally {
      state.polling = false;
    }
  }

  function schedulePoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (state.autoRefresh) pollTimer = setInterval(() => fetchStatus(), 3000);
  }

  fetchStatus();
  schedulePoll();
})();
