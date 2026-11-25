**English** | [中文](README.md)

# Paper Reader for Antigravity

An open-source **MCP App plugin** built for **Google Antigravity**, designed to **enhance the academic paper reading experience inside Antigravity**: get a Zotero-like PDF reader right in the side pane, with local folder browsing, text highlighting & note-taking, **zero-quota floating "Translation Pins"**, and one-click AI Q&A with citations.

> **Acknowledgements & Disclaimer**:
> The design of this plugin is inspired by the open-source project [`agentero-dsh-plugin`](https://github.com/poco-ai/agentero-dsh-plugin) (and [Agentero](https://github.com/poco-ai/Agentero)) in the **DeepSeek Harness (DSH)** ecosystem.
> Sincere thanks to **the author of `agentero-dsh-plugin` (`poco-ai`)** and **DeepSeek Official (`DeepSeek Harness`)** for the great ideas and inspiration!
> This plugin is an independent adaptation solely intended to improve the academic paper reading workflow in **Google Antigravity**. **It is completely free and open-source, for personal study and research only, and not for any commercial or for-profit use.**
>
> **A Note on Reading**: AI and reading plugins are only tools to help improve literature retrieval and comprehension efficiency—**we still hope everyone keeps the good habit of taking handwritten notes and thinking independently when reading papers deeply.**

## ✨ Key Features

- **📁 Local Folder PDF Browser**: Built-in directory browser to pick any local folder of PDFs and list all papers with search and annotation counts.
- **🖍️ Zotero-like Reading & Annotations**: Powered by PDF.js with page navigation, zoom, fit-to-width, 4-color text highlighting, and persistent notes.
- **📌 Zero-Quota Built-in Translation Pins**:
  - Select any passage or click **🌐 Translate Page** to translate into Chinese via the built-in concurrent translation engine (Google Translate / Youdao / MyMemory), **consuming zero AI chat quota**.
  - Translations appear as **non-blocking floating pin cards** that you can drag, collapse, jump back to the page, or delete—without blocking the original PDF text.
- **💬 Deep AI Collaboration**:
  - Select text and click **💬 Ask AI** or **📎 Attach to Chat** to send the paper title, page number, and quoted passage directly into your conversation.
  - Exposes `list_papers`, `read_paper_text`, and `get_paper_notes` MCP tools so the AI can read your PDF pages and notes directly.

## 📦 Installation

### Prerequisites
- Node.js >= 18
- Google Antigravity

### Steps

1. Clone this repository into Antigravity's local plugins directory:

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

2. Click **`+`** in Antigravity's right-hand side pane and select **Paper Reader** to open it.

## 🛠️ Development

```bash
npm install
npm run build   # Bundles the UI into a self-contained dist/app.html via esbuild
```

## 📄 License

[MIT License](LICENSE)
