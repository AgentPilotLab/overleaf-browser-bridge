# 面向AI Agent的Overleaf浏览器桥接器

[![English README](https://img.shields.io/badge/README-English-blue?style=flat-square)](README.md)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-mira.ai-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=000)](https://buymeacoffee.com/mira.ai)

当用户希望Codex、Claude Code或其他支持MCP的AI agent操作已经在浏览器中打开的Overleaf项目，又不具备Overleaf Premium Git同步功能时，推荐使用本仓库。

本项目由Chrome扩展和本地MCP桥接服务组成。AI agent只与本机桥接服务通信，扩展只在用户已经打开的Overleaf编辑器标签页中工作。它不需要读取Overleaf cookie、session、密码或Git token。

## 适用场景

- 让Codex或Claude Code读取当前Overleaf项目、文件树和LaTeX源码。
- 读取指定`.tex`或`.bib`文件、选区、章节、行范围和编辑器诊断。
- 使用文件哈希保护进行插入、选区替换、整文件替换和统一diff patch。
- 触发Overleaf重新编译并读取错误、警告、页数和可见编译日志。
- 将当前项目导出为本地可读镜像，并查看只读diff或准备受保护的同步计划。
- 在多个已打开项目之间使用alias和target lock锁定目标标签页。
- 检查上传、下载、文件操作和评论UI是否可用，而不直接执行高影响操作。
- 在免费Overleaf项目中建立本地优先、可验证的AI写作和编辑工作流。

## 支持范围

当前版本支持：

- 读取已经打开并连接的Overleaf项目。
- 读取当前文件和指定`.tex`、`.bib`文件。
- 读取CodeMirror选区、诊断和可见编译状态。
- 带`beforeHash`校验的文本插入、替换、整文件写入和patch。
- 编译状态与日志摘要读取。
- 本地snapshot、patch log、项目镜像、搜索、diff预览和恢复。
- 受保护的镜像刷新与仅更新已有Overleaf文件的同步计划。
- Codex和Claude Code的MCP连接。
- `www.overleaf.com`及`cn.overleaf.com`等官方`*.overleaf.com`项目域名。

当前版本不支持：

- 枚举Overleaf账号控制台或后台项目。
- 读取Overleaf cookie、session、密码、OAuth token或Git token。
- Overleaf Git integration、`git remote`、`pull`或`push`。
- 自动创建Overleaf项目、上传项目ZIP或无人值守下载项目ZIP。
- 无确认的本地文件上传、评论修改、文件夹移动或服务器管理。

自托管或自定义域名Overleaf需要生成仅供本地使用的扩展副本，不会扩大默认Release的域名权限。

## 快速开始

环境要求：Node.js 18+、Chrome或Chromium，以及已经打开的Overleaf项目编辑器标签页。

```powershell
npm run doctor
npm test
npm run first-run
npm run config:mcp
npm start
```

在`chrome://extensions`中启用开发者模式，将`extension/`加载为解压扩展，然后刷新Overleaf项目标签页并运行：

```powershell
npm run live:verify
npm run live:suite
node scripts/live-smoke-test.js
```

正式Release用户可以下载扩展ZIP，解压后加载解压目录。发布前完整验证命令为：

```powershell
npm run release:preflight
```

## Codex配置

仓库模式可以使用[config/codex-mcp.example.toml](config/codex-mcp.example.toml)作为模板：

```toml
[mcp_servers.overleaf_browser_bridge]
command = "node"
args = [
  "<ABSOLUTE_REPO_PATH>\\server\\overleaf-bridge-mcp.js"
]
env = {}
```

也可以运行以下命令生成包含本地路径的配置片段：

```powershell
npm run config:mcp
```

生成内容位于`.runtime/generated-configs/`，可能包含本机绝对路径，不应提交或分享。

未来npm包入口可使用：

```toml
[mcp_servers.overleaf_browser_bridge]
command = "npx"
args = ["overleaf-browser-bridge"]
env = {}
```

## Claude Code配置

使用[config/mcp-launch.example.json](config/mcp-launch.example.json)作为Claude Desktop或Claude Code风格的MCP模板：

```json
{
  "mcpServers": {
    "overleaf_browser_bridge": {
      "command": "node",
      "args": ["<ABSOLUTE_REPO_PATH>\\server\\overleaf-bridge-mcp.js"],
      "env": {}
    }
  }
}
```

Codex和Claude Code共享同一个MCP服务与安全协议。进行任何写入前，先调用`health_check`和`paper_context`确认目标项目。

## 核心工具

项目提供以下几类MCP工具：

- 连接与定位：`health_check`、`get_current_project`、`paper_context`、项目alias和target lock。
- 读取：文件列表、当前文件、指定文件、行范围、章节、选区和编辑器诊断。
- 写入：`replace_section`、`insert_text`、`replace_selection`、`replace_file`和`apply_patch_to_file`。
- 编译：`compile_and_read_log`。
- 本地镜像：snapshot、diff预览、同步计划、镜像搜索和恢复。
- 导出：源码、编译日志、可见artifact和artifact inventory。
- 受保护操作：文件创建/重命名/删除与可见评论操作的prepare/execute流程。

完整工具列表和参数说明见[英文README](README.md)与[使用文档](docs/USAGE.md)。

写工具需要`projectTitle`、`expectedFileName`、`beforeHash`、`reason`以及`text`或`patch`。当多个Overleaf标签页同时打开时，应先锁定目标项目。

## 官方区域域名与自定义域名

默认Release支持官方Overleaf项目域名：

```text
https://*.overleaf.com/project/*
```

其中包括`https://www.overleaf.com/project/*`和`https://cn.overleaf.com/project/*`。

自托管或其他自定义域名请生成本地扩展副本：

```powershell
npm run extension:build -- --overleaf-origin https://overleaf.example.com
```

生成目录位于`.runtime/extension-builds/<origin>/`，可能包含私有域名，不应提交。

## 隐私与安全

- 桥接器不需要Overleaf cookie、session、密码、OAuth token或Git token。
- 默认只连接用户已经打开的Overleaf项目标签页。
- 写入必须校验项目、文件名和写前哈希，并记录操作原因。
- 本地镜像、日志、配置和运行时文件位于私有目录，不应进入Git或Release。
- 在真实论文上使用写工具前，请先阅读[SECURITY.md](SECURITY.md)。

## AI入口

- [llms.txt](llms.txt)
- [Agent说明](AGENTS.md)
- [AI Agent指南](docs/AI_AGENT_GUIDE.md)
- [可复制Agent提示词](docs/AGENT_PROMPTS.md)
- [使用文档](docs/USAGE.md)
- [安装文档](docs/INSTALLATION.md)
- [故障排查](docs/TROUBLESHOOTING.md)
- [安全说明](SECURITY.md)

## 许可证

本仓库使用[AgentPilotLab Non-Commercial License](LICENSE)。仅允许免费用于非商业用途。商业使用必须事先取得`AgentPilotLab`书面授权，并支付双方约定的商业许可费用。

## 支持

支持项目完全自愿，不是使用本工具的前提。

<a href="https://buymeacoffee.com/mira.ai">
  <img src="docs/assets/buy-me-a-coffee-qr.jpg" alt="Buy me a coffee QR code" width="180">
</a>

[Buy me a coffee](https://buymeacoffee.com/mira.ai)
