import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse --data-dir CLI arg
function getDataDir() {
  const idx = process.argv.indexOf('--data-dir');
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  const eqArg = process.argv.find((a) => a.startsWith('--data-dir='));
  if (eqArg) {
    return eqArg.slice('--data-dir='.length);
  }
  return path.join(__dirname, 'data');
}

const DATA_DIR = getDataDir();
fs.mkdirSync(DATA_DIR, { recursive: true });
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const APP_URI = 'ui://paper-reader/app.html';
const DEFAULT_CHUNK_SIZE = 768 * 1024; // 768 KB raw -> ~1 MB base64

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load state:', err);
  }
  return {
    currentFolder: '',
    recentFolders: [],
    lastOpenedFile: '',
    annotations: {},
  };
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function listPdfFiles(folderPath, maxFiles = 250) {
  if (!folderPath || !fs.existsSync(folderPath)) return [];
  const results = [];
  const queue = [{ dir: folderPath, depth: 0 }];
  while (queue.length > 0 && results.length < maxFiles) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 2 && !entry.name.startsWith('.')) {
          queue.push({ dir: fullPath, depth: depth + 1 });
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        try {
          const stat = fs.statSync(fullPath);
          results.push({
            name: entry.name,
            relativePath: path.relative(folderPath, fullPath),
            filePath: fullPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        } catch {
          // ignore unreadable file
        }
      }
    }
  }
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

function updateRecentFolders(state, folderPath) {
  if (!folderPath) return;
  state.currentFolder = folderPath;
  state.recentFolders = [
    folderPath,
    ...(state.recentFolders || []).filter((f) => f !== folderPath),
  ].slice(0, 10);
}

function getShortcuts(state) {
  const home = os.homedir();
  const candidates = [
    { label: '🏠 用户目录', path: home },
    { label: '🖥️ 桌面', path: path.join(home, 'Desktop') },
    { label: '🖥️ OneDrive 桌面', path: path.join(home, 'OneDrive', 'Desktop') },
    { label: '📄 文档', path: path.join(home, 'Documents') },
    { label: '⬇️ 下载', path: path.join(home, 'Downloads') },
  ];
  for (const drive of ['C:\\', 'D:\\', 'E:\\', 'F:\\', 'G:\\']) {
    candidates.push({ label: `💾 ${drive}`, path: drive });
  }
  const seen = new Set();
  const shortcuts = [];
  for (const c of candidates) {
    if (!seen.has(c.path) && fs.existsSync(c.path)) {
      seen.add(c.path);
      shortcuts.push(c);
    }
  }
  for (const r of state.recentFolders || []) {
    if (!seen.has(r) && fs.existsSync(r)) {
      seen.add(r);
      shortcuts.push({ label: `🕒 ${path.basename(r) || r}`, path: r });
    }
  }
  return shortcuts;
}

function browseDirectory(dirPath, state) {
  const fallback = (state.currentFolder && fs.existsSync(state.currentFolder))
    ? state.currentFolder
    : os.homedir();
  const target = (dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory())
    ? path.resolve(dirPath)
    : fallback;

  const parentDir = path.dirname(target);
  const subdirs = [];
  let pdfCountInCurrent = 0;

  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;
      if (entry.isDirectory()) {
        subdirs.push({
          name: entry.name,
          path: path.join(target, entry.name),
        });
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        pdfCountInCurrent++;
      }
    }
  } catch (err) {
    return {
      currentDir: target,
      parentDir: parentDir !== target ? parentDir : '',
      shortcuts: getShortcuts(state),
      subdirs: [],
      pdfCountInCurrent: 0,
      error: `无法读取目录: ${err.message}`,
    };
  }

  subdirs.sort((a, b) => a.name.localeCompare(b.name));
  return {
    currentDir: target,
    parentDir: parentDir !== target ? parentDir : '',
    shortcuts: getShortcuts(state),
    subdirs,
    pdfCountInCurrent,
  };
}

let pdfjsLibPromise = null;
async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLibPromise;
}

async function extractPdfText(filePath, startPage = 1, endPage = 5) {
  const pdfjsLib = await getPdfJs();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({
    data,
    verbosity: 0,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  const totalPages = doc.numPages;
  const from = Math.max(1, Math.min(startPage, totalPages));
  const to = Math.max(from, Math.min(endPage, totalPages));
  const pages = [];

  for (let p = from; p <= to; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
    pages.push({ page: p, text });
  }
  await doc.destroy();
  return { totalPages, from, to, pages };
}

const server = new McpServer({
  name: 'paper-reader',
  version: '1.0.0',
});

// UI Resource
server.registerResource(
  'Paper Reader App',
  APP_URI,
  {
    description: 'Zotero-like PDF Paper Reader UI',
    mimeType: 'text/html;profile=mcp-app',
    _meta: {
      ui: {
        prefersBorder: false,
      },
    },
  },
  async () => {
    const htmlPath = process.env.PAPER_READER_APP_HTML || path.join(__dirname, 'dist', 'app.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    return {
      contents: [
        {
          uri: APP_URI,
          mimeType: 'text/html;profile=mcp-app',
          text: html,
        },
      ],
    };
  }
);

// Primary entrypoint tool (Aux Pane + Global Sidebar)
server.registerTool(
  'open_paper_reader',
  {
    title: 'Paper Reader',
    description: 'Open the Zotero-like PDF Paper Reader in the side pane to browse a folder of PDFs, highlight passages, take notes, and ask AI questions.',
    inputSchema: {
      folderPath: z.string().optional().describe('Optional folder path containing PDF papers'),
      filePath: z.string().optional().describe('Optional PDF file path to open immediately'),
      page: z.number().int().min(1).optional().describe('Optional 1-based page number to jump to'),
    },
    _meta: {
      ui: { resourceUri: APP_URI },
      'com.google.antigravity/ui': {
        entrypoints: [
          { type: 'aux_pane', title: 'Paper Reader' },
          { type: 'global', title: 'Paper Reader' },
        ],
      },
    },
  },
  async ({ folderPath, filePath, page }) => {
    const state = loadState();
    if (folderPath && fs.existsSync(folderPath)) {
      updateRecentFolders(state, folderPath);
    }
    if (filePath && fs.existsSync(filePath)) {
      state.lastOpenedFile = filePath;
      if (!state.currentFolder) {
        updateRecentFolders(state, path.dirname(filePath));
      }
    }
    saveState(state);

    const files = listPdfFiles(state.currentFolder).map((f) => ({
      ...f,
      annotationCount: (state.annotations[f.filePath] || []).length,
    }));

    const activeFile = filePath || (state.lastOpenedFile && fs.existsSync(state.lastOpenedFile) ? state.lastOpenedFile : (files[0]?.filePath || ''));
    const annotations = activeFile ? (state.annotations[activeFile] || []) : [];

    return {
      content: [
        {
          type: 'text',
          text: state.currentFolder
            ? `Paper Reader opened. Current folder: ${state.currentFolder} (${files.length} PDFs).${activeFile ? ` Active file: ${path.basename(activeFile)}.` : ''}`
            : 'Paper Reader opened. No folder selected yet—use "选择文件夹" in the reader UI to pick a folder of PDFs.',
        },
      ],
      structuredContent: {
        currentFolder: state.currentFolder,
        recentFolders: state.recentFolders || [],
        files,
        activeFile,
        targetPage: page || 1,
        annotations,
      },
    };
  }
);

// Model tool: list PDFs
server.registerTool(
  'list_papers',
  {
    title: 'List Papers in Folder',
    description: 'List PDF papers in the current or specified folder along with annotation counts.',
    inputSchema: {
      folderPath: z.string().optional().describe('Folder path to scan. Uses current folder if omitted.'),
    },
  },
  async ({ folderPath }) => {
    const state = loadState();
    const target = folderPath || state.currentFolder;
    if (!target || !fs.existsSync(target)) {
      return {
        content: [{ type: 'text', text: 'No valid folder selected or found.' }],
      };
    }
    const files = listPdfFiles(target).map((f) => ({
      name: f.name,
      relativePath: f.relativePath,
      filePath: f.filePath,
      sizeKB: Math.round(f.size / 1024),
      annotationCount: (state.annotations[f.filePath] || []).length,
    }));
    return {
      content: [{ type: 'text', text: JSON.stringify({ folder: target, count: files.length, files }, null, 2) }],
    };
  }
);

// Model tool: read PDF text
server.registerTool(
  'read_paper_text',
  {
    title: 'Read Paper Text',
    description: 'Extract text from specific pages of a PDF paper so you can answer questions about it.',
    inputSchema: {
      filePath: z.string().describe('Absolute path to the PDF file'),
      startPage: z.number().int().min(1).default(1).describe('Start page (1-based)'),
      endPage: z.number().int().min(1).default(5).describe('End page (1-based, inclusive)'),
    },
  },
  async ({ filePath, startPage, endPage }) => {
    if (!fs.existsSync(filePath)) {
      return { content: [{ type: 'text', text: `File not found: ${filePath}` }], isError: true };
    }
    const res = await extractPdfText(filePath, startPage, endPage);
    const formatted = res.pages.map((p) => `--- Page ${p.page} / ${res.totalPages} ---\n${p.text}`).join('\n\n');
    return {
      content: [{ type: 'text', text: formatted }],
    };
  }
);

// Model tool: get user notes/highlights
server.registerTool(
  'get_paper_notes',
  {
    title: 'Get Paper Highlights & Notes',
    description: 'Read all highlights and notes saved by the user for a given PDF paper.',
    inputSchema: {
      filePath: z.string().describe('Absolute path to the PDF file'),
    },
  },
  async ({ filePath }) => {
    const state = loadState();
    const notes = state.annotations[filePath] || [];
    return {
      content: [{ type: 'text', text: JSON.stringify({ filePath, count: notes.length, annotations: notes }, null, 2) }],
    };
  }
);

const translationCache = new Map();

async function translateChunkGoogle(chunk, targetLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(chunk)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const data = await res.json();
  const text = (data?.[0] || []).map((seg) => seg?.[0] || '').join('');
  if (!text) throw new Error('Google empty');
  return { text, engine: 'Google' };
}

async function translateChunkYoudao(chunk) {
  const url = `https://fanyi.youdao.com/translate?&doctype=json&type=AUTO&i=${encodeURIComponent(chunk)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
  if (!res.ok) throw new Error(`Youdao HTTP ${res.status}`);
  const data = await res.json();
  if (data?.errorCode !== 0) throw new Error(`Youdao err ${data?.errorCode}`);
  const text = (data?.translateResult || [])
    .map((para) => para.map((seg) => seg?.tgt || '').join(''))
    .join('\n');
  if (!text) throw new Error('Youdao empty');
  return { text, engine: '有道翻译' };
}

async function translateChunkMyMemory(chunk) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk.slice(0, 480))}&langpair=en|zh-CN`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.responseData?.translatedText || '';
  if (!text) throw new Error('MyMemory empty');
  return { text, engine: 'MyMemory' };
}

async function translateChunkFast(chunk, targetLang) {
  try {
    return await Promise.any([
      translateChunkGoogle(chunk, targetLang),
      translateChunkYoudao(chunk),
    ]);
  } catch {
    return await translateChunkMyMemory(chunk);
  }
}

async function translateTextFree(text, targetLang = 'zh-CN') {
  const trimmed = (text || '').trim();
  if (!trimmed) return { translatedText: '', engine: 'none' };

  const cacheKey = `${targetLang}:${trimmed}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  // Split long text into <= 1200-char chunks and translate in parallel
  const chunks = [];
  let remaining = trimmed;
  while (remaining.length > 0) {
    if (remaining.length <= 1200) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', 1200);
    if (splitAt < 500) splitAt = remaining.lastIndexOf('. ', 1200);
    if (splitAt < 500) splitAt = remaining.lastIndexOf(' ', 1200);
    if (splitAt < 300) splitAt = 1200;
    chunks.push(remaining.slice(0, splitAt + 1));
    remaining = remaining.slice(splitAt + 1).trimStart();
  }

  const results = await Promise.all(chunks.map((c) => translateChunkFast(c, targetLang)));
  const out = {
    translatedText: results.map((r) => r.text).join('\n'),
    engine: results[0]?.engine || '内置翻译',
  };
  if (translationCache.size > 200) translationCache.clear();
  translationCache.set(cacheKey, out);
  return out;
}

// App-only: Built-in free translation (no AI quota)
server.registerTool(
  'app_translate',
  {
    title: 'Translate Text',
    description: 'Translate text to Chinese using built-in free translation without consuming AI quota',
    inputSchema: {
      text: z.string(),
      targetLang: z.string().default('zh-CN'),
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  async ({ text, targetLang }) => {
    try {
      const result = await translateTextFree(text, targetLang);
      return {
        content: [{ type: 'text', text: result.translatedText }],
        structuredContent: result,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: err.message }],
        structuredContent: { error: `翻译失败: ${err.message}` },
      };
    }
  }
);

// App-only: Built-in directory browser
server.registerTool(
  'app_browse_dir',
  {
    title: 'Browse Directory',
    description: 'List subdirectories and shortcuts for the in-app folder browser',
    inputSchema: {
      dirPath: z.string().optional(),
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  async ({ dirPath }) => {
    const state = loadState();
    const result = browseDirectory(dirPath, state);
    return {
      content: [{ type: 'text', text: result.currentDir }],
      structuredContent: result,
    };
  }
);

// App-only: Set folder by path
server.registerTool(
  'app_set_folder',
  {
    title: 'Set Folder',
    description: 'Set active PDF folder by path',
    inputSchema: {
      folderPath: z.string(),
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  async ({ folderPath }) => {
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return {
        content: [{ type: 'text', text: 'Folder does not exist' }],
        structuredContent: { error: `文件夹不存在: ${folderPath}` },
      };
    }
    const state = loadState();
    updateRecentFolders(state, folderPath);
    const files = listPdfFiles(folderPath).map((f) => ({
      ...f,
      annotationCount: (state.annotations[f.filePath] || []).length,
    }));
    if (files.length > 0) {
      state.lastOpenedFile = files[0].filePath;
    }
    saveState(state);
    return {
      content: [{ type: 'text', text: `Set folder ${folderPath}` }],
      structuredContent: {
        currentFolder: state.currentFolder,
        recentFolders: state.recentFolders,
        files,
        activeFile: files[0]?.filePath || '',
        annotations: files[0] ? (state.annotations[files[0].filePath] || []) : [],
      },
    };
  }
);

// App-only: Read PDF in chunks
server.registerTool(
  'app_get_pdf_chunk',
  {
    title: 'Get PDF Chunk',
    description: 'Read a base64 chunk of a PDF file',
    inputSchema: {
      filePath: z.string(),
      offset: z.number().int().min(0).default(0),
      length: z.number().int().min(1).max(2 * 1024 * 1024).default(DEFAULT_CHUNK_SIZE),
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  async ({ filePath, offset, length }) => {
    if (!fs.existsSync(filePath)) {
      return {
        content: [{ type: 'text', text: 'File not found' }],
        structuredContent: { error: `文件不存在: ${filePath}` },
      };
    }
    const state = loadState();
    if (offset === 0) {
      state.lastOpenedFile = filePath;
      saveState(state);
    }
    const stat = fs.statSync(filePath);
    const totalBytes = stat.size;
    const toRead = Math.min(length, Math.max(0, totalBytes - offset));
    const buf = Buffer.alloc(toRead);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buf, 0, toRead, offset);
    } finally {
      fs.closeSync(fd);
    }
    const nextOffset = offset + toRead;
    return {
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: {
        base64: buf.toString('base64'),
        offset,
        nextOffset,
        totalBytes,
        done: nextOffset >= totalBytes,
      },
    };
  }
);

// App-only: Get annotations for a file
server.registerTool(
  'app_get_annotations',
  {
    title: 'Get Annotations',
    description: 'Get highlights and notes for a file',
    inputSchema: {
      filePath: z.string(),
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  async ({ filePath }) => {
    const state = loadState();
    return {
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: {
        filePath,
        annotations: state.annotations[filePath] || [],
      },
    };
  }
);

// App-only: Save/update annotation
server.registerTool(
  'app_save_annotation',
  {
    title: 'Save Annotation',
    description: 'Save or update a highlight/note',
    inputSchema: {
      filePath: z.string(),
      annotation: z.object({
        id: z.string(),
        page: z.number().int().min(1),
        text: z.string(),
        note: z.string().default(''),
        color: z.string().default('#fde047'),
        rects: z.array(
          z.object({
            left: z.number(),
            top: z.number(),
            width: z.number(),
            height: z.number(),
          })
        ),
        createdAt: z.number(),
      }),
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  async ({ filePath, annotation }) => {
    const state = loadState();
    const list = state.annotations[filePath] || [];
    const idx = list.findIndex((a) => a.id === annotation.id);
    if (idx >= 0) {
      list[idx] = annotation;
    } else {
      list.push(annotation);
    }
    list.sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
    state.annotations[filePath] = list;
    saveState(state);
    return {
      content: [{ type: 'text', text: 'saved' }],
      structuredContent: { annotations: list },
    };
  }
);

// App-only: Delete annotation
server.registerTool(
  'app_delete_annotation',
  {
    title: 'Delete Annotation',
    description: 'Delete a highlight/note',
    inputSchema: {
      filePath: z.string(),
      id: z.string(),
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  async ({ filePath, id }) => {
    const state = loadState();
    const list = (state.annotations[filePath] || []).filter((a) => a.id !== id);
    state.annotations[filePath] = list;
    saveState(state);
    return {
      content: [{ type: 'text', text: 'deleted' }],
      structuredContent: { annotations: list },
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
