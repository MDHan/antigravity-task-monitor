# Antigravity Task Monitor（任务进度看板）

一个用于 **Google Antigravity** 的长任务可观测性插件，解决长时间任务（如模型训练、远程 SSH/GPU 实验、多步骤代码开发）中**久不更新状态、不知道进行到哪一步、看不清执行了哪些操作**的痛点。

## 核心特性

1. **自动绑定当前对话的右侧边栏（严格会话隔离）**
   - 基于 Antigravity Sidecar（`SIDECAR_UI_ENTRYPOINT_AUX_PANE`），点开哪个对话就自动显示哪个对话的专属进度，绝不串台。
   - **聚焦本轮任务**：主界面只展示当前这一次提问的**本轮耗时、距上次更新时间、执行步骤、阶段进展、运行中的后台任务和本轮操作**。
   - **结构化历史回看**：「历史」Tab 按轮次折叠收纳本对话之前的轮次，展开即可查看该轮的结果摘要、去重改动文件标签和关键命令。
   - **中文优先进展**：「进展」Tab 默认展示按用户语言生成的阶段结论，支持一键切换查看内部英文思考原文。
   - **零额外 Token 消耗**：面板轮询刷新与状态记录均在本地完成，不调用大模型。

2. **左侧全局「任务总览」入口（MCP App）**
   - 在左侧全局导航栏提供跨对话总览，方便同时监控多个会话的运行状态。

3. **Hooks 实时状态记录（`hooks.json`）**
   - 监听 `SessionStart` / `PreInvocation` / `PostInvocation` / `PostToolUse` / `Stop`，实时记录执行状态与报错，不干扰工具权限弹窗。

4. **5 分钟长任务自动回报规范（`rules/AGENTS.md`）**
   - 启用插件后自动约束长任务/后台任务按 5 分钟间隔检查并回报进度，避免 30 分钟~1 小时静默等待。

## 安装方式

```bash
git clone https://github.com/MDHan/antigravity-task-monitor.git ~/.gemini/config/plugins/task-monitor
cd ~/.gemini/config/plugins/task-monitor/server
npm install
```

安装后无需重启 Antigravity，在插件页启用「任务进度看板」即可：
- **单对话进度**：在任意对话右侧边栏点击 **`+`** → 选择 **「任务进度」**
- **跨对话总览**：在左侧全局导航栏点击 **「任务总览」**

## 目录结构

```text
task-monitor/
├── plugin.json                 # 插件元数据
├── rules/AGENTS.md             # 长任务 5 分钟定时回报与进度同步规范
├── hooks.json                  # 生命周期 Hook 配置
├── hooks/record_event.py       # 轻量本地状态采集脚本
├── mcp_config.json             # 全局总览 MCP Server 配置
├── sidecars/monitor_panel/     # 自动绑定当前对话的侧边栏 Sidecar 面板
├── server/
│   ├── monitor-core.mjs        # 共享轨迹与轮次解析器
│   ├── server.mjs              # 全局任务总览 MCP Server
│   └── app.html                # 已打包的全局面板前端
└── assets/logo.svg
```

## License

MIT
