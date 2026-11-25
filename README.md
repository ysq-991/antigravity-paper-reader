# Paper Reader for Antigravity

一个专为 **Google Antigravity** 打造的开源 **MCP App 插件**，旨在**优化用户在 Antigravity 中阅读论文的体验**：在右侧扩展栏中获得类似 Zotero 的 PDF 论文阅读体验，支持本地文件夹读取、划词高亮与笔记、**零 AI 额度消耗的悬浮“翻译钉子”**，以及一键向 AI 提问或引用原文。

> **项目说明与致谢**：
> 本插件的设计灵感借鉴了 **DeepSeek Harness (DSH)** 生态中的开源项目 [`agentero-dsh-plugin`](https://github.com/poco-ai/agentero-dsh-plugin)（以及 [Agentero](https://github.com/poco-ai/Agentero)）。
> 在此诚挚感谢 **`agentero-dsh-plugin` 插件作者（poco-ai）** 以及 **DeepSeek 官方（DeepSeek Harness）** 提供的优秀思路与生态启发！
> 本插件为独立适配版本，仅用于优化在 **Google Antigravity** 中阅读学术论文的交互体验，**完全开源免费，仅用于个人学习与科研交流，不用于任何商业或盈利目的**。
>
> **阅读寄语**：AI 与阅读插件只是提升文献检索与理解效率的辅助工具，**希望大家在精读论文时仍然能够保持手写笔记、独立思考的好习惯**。

## ✨ 核心特性

- **📁 本地论文文件夹浏览**：内置目录浏览器，直接选取本地 PDF 文件夹并列出全部论文。
- **🖍️ 类 Zotero 阅读与批注**：基于 PDF.js 渲染，支持翻页、缩放、适应宽度、4 色划词高亮与笔记持久化保存。
- **📌 零额度内置翻译钉子**：
  - 划词或整页点击 **🌐 翻译**，通过内置并发翻译引擎（Google Translate / 有道翻译 / MyMemory）快速译为中文，**不消耗任何 AI 对话额度**。
  - 翻译结果以**非遮挡悬浮钉子卡片**呈现，可自由拖动、折叠、定位页码或删除，不影响继续阅读原文。
- **💬 与 AI 深度协同**：
  - 划词后点击 **💬 问 AI** 或 **📎 引用到对话**，可将论文名、页码与选中原文直接带入对话。
  - 内置 `list_papers`、`read_paper_text`、`get_paper_notes` MCP 工具，AI 可直接翻阅论文原文和你的笔记来辅助精读。

## 📦 安装方法

### 前置要求
- Node.js >= 18
- Google Antigravity

### 安装步骤

1. 将本仓库克隆到 Antigravity 的本地插件目录：

```bash
# Windows (PowerShell)
git clone https://github.com/ysq-991/antigravity-paper-reader.git "$env:USERPROFILE\.gemini\config\plugins\paper-reader"
cd "$env:USERPROFILE\.gemini\config\plugins\paper-reader"
npm install
npm run build
```

```bash
# macOS / Linux
git clone https://github.com/ysq-991/antigravity-paper-reader.git ~/.gemini/config/plugins/paper-reader
cd ~/.gemini/config/plugins/paper-reader
npm install
npm run build
```

2. 在 Antigravity 右侧扩展栏点击 **`+`**，选择 **Paper Reader** 即可打开使用。

## 🛠️ 本地开发

```bash
npm install
npm run build   # 使用 esbuild 打包生成自包含单文件 dist/app.html
```

## 📄 开源协议

[MIT License](LICENSE)
