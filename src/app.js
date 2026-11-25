import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// Run PDF.js worker in-process so default CSP (no external/worker scripts) never blocks it.
globalThis.pdfjsWorker = pdfjsWorker;

const app = new App({ name: 'Paper Reader', version: '1.0.0' });

const state = {
  currentFolder: '',
  recentFolders: [],
  files: [],
  activeFile: '',
  annotations: [],
  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  scale: 1.15,
  renderedPages: new Set(),
  renderingPages: new Set(),
  pendingSelection: null,
  hostCaps: {},
};

// DOM refs
const el = {
  btnPickFolder: document.getElementById('btn-pick-folder'),
  btnTogglePath: document.getElementById('btn-toggle-path'),
  pathBar: document.getElementById('path-bar'),
  inputFolderPath: document.getElementById('input-folder-path'),
  btnLoadPath: document.getElementById('btn-load-path'),
  selectRecent: document.getElementById('select-recent-folders'),
  btnToggleLibrary: document.getElementById('btn-toggle-library'),
  btnToggleNotes: document.getElementById('btn-toggle-notes'),
  paperCount: document.getElementById('paper-count'),
  noteCount: document.getElementById('note-count'),
  activeFolderLabel: document.getElementById('active-folder-label'),
  activeFileLabel: document.getElementById('active-file-label'),
  readerToolbar: document.getElementById('reader-toolbar'),
  btnPrevPage: document.getElementById('btn-prev-page'),
  btnNextPage: document.getElementById('btn-next-page'),
  inputPage: document.getElementById('input-page'),
  totalPages: document.getElementById('total-pages'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnFitWidth: document.getElementById('btn-fit-width'),
  zoomLabel: document.getElementById('zoom-label'),
  btnTranslatePage: document.getElementById('btn-translate-page'),
  btnAskCurrentPage: document.getElementById('btn-ask-current-page'),
  libraryDrawer: document.getElementById('library-drawer'),
  inputSearchPapers: document.getElementById('input-search-papers'),
  paperList: document.getElementById('paper-list'),
  notesDrawer: document.getElementById('notes-drawer'),
  notesList: document.getElementById('notes-list'),
  btnSendAllNotes: document.getElementById('btn-send-all-notes'),
  viewerContainer: document.getElementById('viewer-container'),
  emptyState: document.getElementById('empty-state'),
  loadingState: document.getElementById('loading-state'),
  loadingText: document.getElementById('loading-text'),
  pagesWrapper: document.getElementById('pages-wrapper'),
  popover: document.getElementById('selection-popover'),
  btnPopTranslate: document.getElementById('btn-pop-translate'),
  btnPopAsk: document.getElementById('btn-pop-ask'),
  btnPopAttach: document.getElementById('btn-pop-attach'),
  askModal: document.getElementById('ask-modal'),
  askQuote: document.getElementById('ask-quote'),
  askInput: document.getElementById('ask-input'),
  btnCloseAsk: document.getElementById('btn-close-ask'),
  btnCancelAsk: document.getElementById('btn-cancel-ask'),
  btnSubmitAsk: document.getElementById('btn-submit-ask'),
  folderModal: document.getElementById('folder-modal'),
  btnCloseFolder: document.getElementById('btn-close-folder'),
  btnCancelFolder: document.getElementById('btn-cancel-folder'),
  btnConfirmFolder: document.getElementById('btn-confirm-folder'),
  btnFolderUp: document.getElementById('btn-folder-up'),
  inputBrowsePath: document.getElementById('input-browse-path'),
  btnBrowseGo: document.getElementById('btn-browse-go'),
  folderShortcuts: document.getElementById('folder-shortcuts'),
  folderSubdirs: document.getElementById('folder-subdirs'),
  folderPdfHint: document.getElementById('folder-pdf-hint'),
  pinsLayer: document.getElementById('pins-layer'),
  toast: document.getElementById('toast'),
};

let toastTimer = null;
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2400);
}

function applyTheme(ctx) {
  if (ctx?.theme) {
    applyDocumentTheme(ctx.theme);
    document.documentElement.setAttribute('data-theme', ctx.theme);
  }
  if (ctx?.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
}

function updateCapabilitiesUI() {
  // Keep translation & AI buttons visible in all views; if host lacks message capability (e.g. global view),
  // clicking them will copy the prompt to clipboard and notify the user.
}

function renderFolderUI() {
  el.activeFolderLabel.textContent = state.currentFolder || '未选择文件夹';
  el.activeFolderLabel.title = state.currentFolder || '';
  el.inputFolderPath.value = state.currentFolder || '';
  el.paperCount.textContent = String(state.files.length);

  el.selectRecent.innerHTML = '<option value="">最近文件夹...</option>';
  for (const dir of state.recentFolders || []) {
    const opt = document.createElement('option');
    opt.value = dir;
    opt.textContent = dir;
    el.selectRecent.appendChild(opt);
  }

  renderPaperList();
}

function renderPaperList() {
  const q = el.inputSearchPapers.value.trim().toLowerCase();
  const filtered = state.files.filter((f) =>
    f.relativePath.toLowerCase().includes(q)
  );
  el.paperList.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.padding = '12px';
    empty.textContent = state.currentFolder ? '该文件夹下没有找到 PDF 文件' : '请先选择一个文件夹';
    el.paperList.appendChild(empty);
    return;
  }

  for (const file of filtered) {
    const item = document.createElement('div');
    item.className = 'paper-item' + (file.filePath === state.activeFile ? ' active' : '');

    const title = document.createElement('div');
    title.className = 'paper-item-title';
    title.textContent = file.relativePath;

    const meta = document.createElement('div');
    meta.className = 'paper-item-meta';
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const annCount = file.filePath === state.activeFile ? state.annotations.length : (file.annotationCount || 0);
    meta.innerHTML = `<span>${sizeMB} MB</span><span>${annCount > 0 ? `📝 ${annCount}` : ''}</span>`;

    item.appendChild(title);
    item.appendChild(meta);
    item.addEventListener('click', () => {
      openPdfFile(file.filePath, 1);
      if (window.innerWidth < 680) {
        el.libraryDrawer.classList.add('hidden');
      }
    });
    el.paperList.appendChild(item);
  }
}

function renderNotesList() {
  el.noteCount.textContent = String(state.annotations.length);
  el.notesList.innerHTML = '';

  if (state.annotations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.padding = '12px';
    empty.textContent = '在论文中划词选择文字即可添加高亮与笔记。';
    el.notesList.appendChild(empty);
    return;
  }

  for (const ann of state.annotations) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.style.borderLeftColor = ann.color || '#fde047';

    const quote = document.createElement('div');
    quote.className = 'note-quote';
    quote.textContent = `[P${ann.page}] "${ann.text}"`;
    quote.title = '点击跳转到该页';
    quote.addEventListener('click', () => scrollToPage(ann.page));

    const textarea = document.createElement('textarea');
    textarea.className = 'note-comment';
    textarea.rows = 2;
    textarea.placeholder = '添加阅读笔记...';
    textarea.value = ann.note || '';
    textarea.addEventListener('change', async () => {
      ann.note = textarea.value;
      await saveAnnotation(ann);
    });

    const actions = document.createElement('div');
    actions.className = 'note-actions';

    const btnTrans = document.createElement('button');
    btnTrans.className = 'btn btn-sm btn-accent';
    btnTrans.textContent = '🌐 翻译';
    btnTrans.addEventListener('click', () => {
      translateSelection(ann.text, ann.page, ann.id);
    });
    actions.appendChild(btnTrans);

    const btnAsk = document.createElement('button');
    btnAsk.className = 'btn btn-sm btn-accent';
    btnAsk.textContent = '💬 问 AI';
    btnAsk.addEventListener('click', () => {
      openAskModal(ann.text, ann.page, ann.note);
    });
    actions.appendChild(btnAsk);

    const btnDel = document.createElement('button');
    btnDel.className = 'btn btn-sm';
    btnDel.textContent = '删除';
    btnDel.addEventListener('click', () => deleteAnnotation(ann.id));
    actions.appendChild(btnDel);

    card.appendChild(quote);
    card.appendChild(textarea);
    card.appendChild(actions);
    el.notesList.appendChild(card);
  }
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function fetchPdfBytes(filePath) {
  const chunks = [];
  let offset = 0;
  let totalBytes = 0;
  while (true) {
    const res = await app.callServerTool({
      name: 'app_get_pdf_chunk',
      arguments: { filePath, offset },
    });
    const sc = res?.structuredContent;
    if (sc?.error) throw new Error(sc.error);
    totalBytes = sc.totalBytes || totalBytes;
    if (sc.base64) {
      chunks.push(base64ToUint8Array(sc.base64));
    }
    if (totalBytes > 0) {
      const pct = Math.min(100, Math.round((sc.nextOffset / totalBytes) * 100));
      el.loadingText.textContent = `正在加载论文... ${pct}%`;
    }
    if (sc.done) break;
    offset = sc.nextOffset;
  }

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    combined.set(c, pos);
    pos += c.length;
  }
  return combined;
}

let pageObserver = null;

async function openPdfFile(filePath, targetPage = 1) {
  if (!filePath) return;
  state.activeFile = filePath;
  const fileObj = state.files.find((f) => f.filePath === filePath);
  el.activeFileLabel.textContent = fileObj ? fileObj.name : filePath.split(/[\\/]/).pop();
  el.activeFileLabel.title = filePath;
  renderPaperList();

  el.emptyState.classList.add('hidden');
  el.loadingState.classList.remove('hidden');
  el.loadingText.textContent = '正在读取 PDF...';
  el.pagesWrapper.innerHTML = '';
  el.readerToolbar.classList.add('hidden');

  try {
    const [pdfBytes, annRes] = await Promise.all([
      fetchPdfBytes(filePath),
      app.callServerTool({ name: 'app_get_annotations', arguments: { filePath } }),
    ]);

    state.annotations = annRes?.structuredContent?.annotations || [];
    renderNotesList();

    if (state.pdfDoc) {
      await state.pdfDoc.destroy();
    }
    state.pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    state.numPages = state.pdfDoc.numPages;
    state.currentPage = Math.max(1, Math.min(targetPage, state.numPages));

    el.totalPages.textContent = String(state.numPages);
    el.inputPage.value = String(state.currentPage);
    el.inputPage.max = String(state.numPages);
    el.loadingState.classList.add('hidden');
    el.readerToolbar.classList.remove('hidden');

    await buildPageContainers();
    if (targetPage > 1) {
      scrollToPage(targetPage);
    }
  } catch (err) {
    el.loadingState.classList.add('hidden');
    showToast('加载 PDF 失败: ' + err.message);
  }
}

async function buildPageContainers() {
  if (pageObserver) pageObserver.disconnect();
  state.renderedPages.clear();
  state.renderingPages.clear();
  el.pagesWrapper.innerHTML = '';
  el.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;

  // Use page 1 viewport as initial placeholder size
  const firstPage = await state.pdfDoc.getPage(1);
  const defaultVp = firstPage.getViewport({ scale: state.scale });

  for (let p = 1; p <= state.numPages; p++) {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'pdf-page';
    pageDiv.dataset.page = String(p);
    pageDiv.style.width = `${defaultVp.width}px`;
    pageDiv.style.height = `${defaultVp.height}px`;
    el.pagesWrapper.appendChild(pageDiv);
  }

  pageObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const p = Number(entry.target.dataset.page);
          renderPage(p);
          state.currentPage = p;
          el.inputPage.value = String(p);
        }
      }
    },
    { root: el.viewerContainer, rootMargin: '300px 0px', threshold: 0.15 }
  );

  for (const child of el.pagesWrapper.children) {
    pageObserver.observe(child);
  }
}

async function renderPage(pageNum) {
  if (!state.pdfDoc || state.renderedPages.has(pageNum) || state.renderingPages.has(pageNum)) return;
  const pageDiv = el.pagesWrapper.querySelector(`.pdf-page[data-page="${pageNum}"]`);
  if (!pageDiv) return;

  state.renderingPages.add(pageNum);
  try {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: state.scale });
    const dpr = window.devicePixelRatio || 1;

    pageDiv.style.width = `${viewport.width}px`;
    pageDiv.style.height = `${viewport.height}px`;
    pageDiv.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const highlightLayer = document.createElement('div');
    highlightLayer.className = 'highlight-layer';

    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.setProperty('--scale-factor', String(state.scale));

    pageDiv.appendChild(canvas);
    pageDiv.appendChild(highlightLayer);
    pageDiv.appendChild(textLayerDiv);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textLayerDiv,
      viewport,
    });
    await textLayer.render();

    renderPageHighlights(pageNum, highlightLayer);
    state.renderedPages.add(pageNum);
  } finally {
    state.renderingPages.delete(pageNum);
  }
}

function renderPageHighlights(pageNum, layer) {
  const target = layer || el.pagesWrapper.querySelector(`.pdf-page[data-page="${pageNum}"] .highlight-layer`);
  if (!target) return;
  target.innerHTML = '';
  const pageAnns = state.annotations.filter((a) => a.page === pageNum);
  for (const ann of pageAnns) {
    for (const r of ann.rects || []) {
      const box = document.createElement('div');
      box.className = 'highlight-rect';
      box.style.background = ann.color || '#fde047';
      box.style.left = `${r.left}%`;
      box.style.top = `${r.top}%`;
      box.style.width = `${r.width}%`;
      box.style.height = `${r.height}%`;
      target.appendChild(box);
    }
  }
}

function scrollToPage(pageNum) {
  const p = Math.max(1, Math.min(pageNum, state.numPages));
  const pageDiv = el.pagesWrapper.querySelector(`.pdf-page[data-page="${p}"]`);
  if (pageDiv) {
    pageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    state.currentPage = p;
    el.inputPage.value = String(p);
  }
}

async function saveAnnotation(ann) {
  if (!state.activeFile) return;
  const res = await app.callServerTool({
    name: 'app_save_annotation',
    arguments: { filePath: state.activeFile, annotation: ann },
  });
  if (res?.structuredContent?.annotations) {
    state.annotations = res.structuredContent.annotations;
    renderNotesList();
    renderPageHighlights(ann.page);
    renderPaperList();
  }
}

async function deleteAnnotation(id) {
  if (!state.activeFile) return;
  const target = state.annotations.find((a) => a.id === id);
  const res = await app.callServerTool({
    name: 'app_delete_annotation',
    arguments: { filePath: state.activeFile, id },
  });
  if (res?.structuredContent?.annotations) {
    state.annotations = res.structuredContent.annotations;
    renderNotesList();
    if (target) renderPageHighlights(target.page);
    renderPaperList();
  }
}

// Selection handling for Zotero-like popover
function hidePopover() {
  el.popover.classList.add('hidden');
}

document.addEventListener('mouseup', (e) => {
  if (el.popover.contains(e.target) || el.askModal.contains(e.target)) return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    hidePopover();
    return;
  }

  const text = sel.toString().trim();
  if (!text) {
    hidePopover();
    return;
  }

  const range = sel.getRangeAt(0);
  const anchorNode = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const pageDiv = anchorNode?.closest?.('.pdf-page');
  if (!pageDiv) {
    hidePopover();
    return;
  }

  const pageNum = Number(pageDiv.dataset.page);
  const pageRect = pageDiv.getBoundingClientRect();
  const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);

  const rects = clientRects.map((r) => ({
    left: ((r.left - pageRect.left) / pageRect.width) * 100,
    top: ((r.top - pageRect.top) / pageRect.height) * 100,
    width: (r.width / pageRect.width) * 100,
    height: (r.height / pageRect.height) * 100,
  }));

  state.pendingSelection = { page: pageNum, text, rects };

  const lastRect = clientRects[clientRects.length - 1] || range.getBoundingClientRect();
  el.popover.classList.remove('hidden');
  const popWidth = el.popover.offsetWidth || 240;
  const left = Math.max(8, Math.min(window.innerWidth - popWidth - 8, lastRect.left));
  const top = Math.max(8, lastRect.top - 42);
  el.popover.style.left = `${left}px`;
  el.popover.style.top = `${top}px`;
});

el.popover.querySelectorAll('.color-dot').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!state.pendingSelection) return;
    const ann = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      page: state.pendingSelection.page,
      text: state.pendingSelection.text,
      note: '',
      color: btn.dataset.color,
      rects: state.pendingSelection.rects,
      createdAt: Date.now(),
    };
    window.getSelection()?.removeAllRanges();
    hidePopover();
    await saveAnnotation(ann);
    showToast('已添加高亮');
  });
});

function openAskModal(quoteText, pageNum, noteText = '') {
  state.pendingAsk = { quoteText, pageNum, noteText };
  el.askQuote.textContent = quoteText
    ? `[P${pageNum}] ${quoteText}`
    : `当前论文: ${el.activeFileLabel.textContent}（第 ${pageNum} 页）`;
  el.askInput.value = '';
  el.askModal.classList.remove('hidden');
  el.askInput.focus();
}

async function sendOrCopyPrompt(text, successMsg) {
  if (state.hostCaps?.message) {
    try {
      await app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text }],
      });
      showToast(successMsg);
      return;
    } catch (err) {
      showToast('发送失败: ' + err.message);
      return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('当前视图未绑定对话，已复制内容到剪贴板，请直接粘贴提问');
  } catch {
    showToast('请在右侧扩展栏打开以直接发送到对话');
  }
}

function makeDraggable(card, handle) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    const rect = card.getBoundingClientRect();
    card.classList.add('floating');
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    startX = e.clientX;
    startY = e.clientY;
    origLeft = rect.left;
    origTop = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const maxL = Math.max(4, window.innerWidth - card.offsetWidth - 4);
    const maxT = Math.max(4, window.innerHeight - 40);
    card.style.left = `${Math.max(4, Math.min(maxL, origLeft + dx))}px`;
    card.style.top = `${Math.max(4, Math.min(maxT, origTop + dy))}px`;
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
  });
}

async function runBuiltInTranslate(sourceText, pageNum, annotationId = '') {
  const cleanText = (sourceText || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) {
    showToast('没有可翻译的文本');
    return;
  }

  const card = document.createElement('div');
  card.className = 'pin-card';

  const header = document.createElement('div');
  header.className = 'pin-header';

  const title = document.createElement('span');
  title.className = 'pin-title';
  title.textContent = `📌 P${pageNum} 翻译中...`;

  const actions = document.createElement('div');
  actions.className = 'pin-actions';

  const btnJump = document.createElement('button');
  btnJump.className = 'btn btn-sm';
  btnJump.textContent = '定位';
  btnJump.title = `跳转到第 ${pageNum} 页`;
  btnJump.addEventListener('click', () => scrollToPage(pageNum));

  const btnCopy = document.createElement('button');
  btnCopy.className = 'btn btn-sm';
  btnCopy.textContent = '复制';

  const btnCollapse = document.createElement('button');
  btnCollapse.className = 'btn btn-sm';
  btnCollapse.textContent = '▾';
  btnCollapse.title = '折叠/展开';
  btnCollapse.addEventListener('click', () => {
    card.classList.toggle('collapsed');
    btnCollapse.textContent = card.classList.contains('collapsed') ? '▸' : '▾';
  });

  const btnDelete = document.createElement('button');
  btnDelete.className = 'btn btn-sm';
  btnDelete.textContent = '✕';
  btnDelete.title = '删除此翻译钉子';
  btnDelete.addEventListener('click', () => card.remove());

  actions.appendChild(btnJump);
  actions.appendChild(btnCopy);
  actions.appendChild(btnCollapse);
  actions.appendChild(btnDelete);

  header.appendChild(title);
  header.appendChild(actions);

  const body = document.createElement('div');
  body.className = 'pin-body';
  body.textContent = '正在高速翻译...';

  card.appendChild(header);
  card.appendChild(body);
  el.pinsLayer.appendChild(card);
  makeDraggable(card, header);

  let translatedText = '';
  btnCopy.addEventListener('click', async () => {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      showToast('已复制译文');
    } catch {
      showToast('复制失败');
    }
  });

  try {
    const res = await app.callServerTool({
      name: 'app_translate',
      arguments: { text: cleanText, targetLang: 'zh-CN' },
    });
    const sc = res?.structuredContent;
    if (sc?.error) {
      title.textContent = `📌 P${pageNum} 翻译失败`;
      body.textContent = sc.error;
      return;
    }
    translatedText = sc?.translatedText || '';
    title.textContent = `📌 P${pageNum}${sc?.engine ? ` · ${sc.engine}` : ''}`;
    body.textContent = translatedText || '未返回译文';

    if (annotationId && translatedText) {
      const btnNote = document.createElement('button');
      btnNote.className = 'btn btn-sm btn-accent';
      btnNote.textContent = '存笔记';
      btnNote.addEventListener('click', async () => {
        const ann = state.annotations.find((a) => a.id === annotationId);
        if (!ann) return;
        ann.note = ann.note ? `${ann.note}\n[译文] ${translatedText}` : translatedText;
        await saveAnnotation(ann);
        showToast('已将译文保存到笔记');
      });
      actions.insertBefore(btnNote, btnCollapse);
    }
  } catch (err) {
    title.textContent = `📌 P${pageNum} 翻译失败`;
    body.textContent = '翻译失败: ' + err.message;
  }
}

async function translateSelection(quoteText, pageNum, annotationId = '') {
  if (quoteText) {
    await runBuiltInTranslate(quoteText, pageNum, annotationId);
    return;
  }
  if (!state.pdfDoc) return;
  try {
    const page = await state.pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
    await runBuiltInTranslate(pageText, pageNum);
  } catch (err) {
    showToast('提取当前页文本失败: ' + err.message);
  }
}

el.btnPopTranslate.addEventListener('click', () => {
  if (!state.pendingSelection) return;
  const { text, page } = state.pendingSelection;
  window.getSelection()?.removeAllRanges();
  hidePopover();
  translateSelection(text, page);
});

el.btnTranslatePage.addEventListener('click', () => {
  translateSelection('', state.currentPage);
});

el.btnPopAsk.addEventListener('click', () => {
  if (!state.pendingSelection) return;
  const { text, page } = state.pendingSelection;
  window.getSelection()?.removeAllRanges();
  hidePopover();
  openAskModal(text, page);
});

el.btnPopAttach.addEventListener('click', async () => {
  if (!state.pendingSelection) return;
  const { text, page } = state.pendingSelection;
  window.getSelection()?.removeAllRanges();
  hidePopover();
  try {
    await app.updateModelContext({
      content: [
        {
          type: 'text',
          text: `论文引用（${el.activeFileLabel.textContent}, 路径: ${state.activeFile}, 第 ${page} 页）：\n"${text}"`,
        },
      ],
    });
    showToast('已引用到下一条对话');
  } catch (err) {
    showToast('引用失败: ' + err.message);
  }
});

el.btnAskCurrentPage.addEventListener('click', () => {
  openAskModal('', state.currentPage);
});

el.btnCloseAsk.addEventListener('click', () => el.askModal.classList.add('hidden'));
el.btnCancelAsk.addEventListener('click', () => el.askModal.classList.add('hidden'));

el.btnSubmitAsk.addEventListener('click', async () => {
  const question = el.askInput.value.trim() || '请帮我解读这一部分内容。';
  const { quoteText, pageNum, noteText } = state.pendingAsk || { quoteText: '', pageNum: state.currentPage, noteText: '' };
  el.askModal.classList.add('hidden');

  const lines = [
    `我正在阅读论文《${el.activeFileLabel.textContent}》（文件：\`${state.activeFile}\`，第 ${pageNum} 页）。`,
  ];
  if (quoteText) lines.push(`> ${quoteText}`);
  if (noteText) lines.push(`我的笔记：${noteText}`);
  lines.push(`\n问题：${question}`);

  await sendOrCopyPrompt(lines.join('\n'), '已发送到对话');
});

el.btnSendAllNotes.addEventListener('click', async () => {
  if (state.annotations.length === 0) {
    showToast('当前论文还没有高亮或笔记');
    return;
  }
  const summaryLines = state.annotations.map(
    (a) => `- [第 ${a.page} 页] "${a.text}"${a.note ? `（笔记：${a.note}）` : ''}`
  );
  try {
    await app.sendMessage({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `请结合以下我在论文《${el.activeFileLabel.textContent}》（\`${state.activeFile}\`）中的高亮与笔记，帮我梳理核心要点：\n\n${summaryLines.join('\n')}`,
        },
      ],
    });
    showToast('已将笔记发送到对话');
  } catch (err) {
    showToast('发送失败: ' + err.message);
  }
});

// Built-in Folder Browser Modal
let browsingDir = '';
let browsingParent = '';

async function openFolderBrowser(dirPath) {
  try {
    const res = await app.callServerTool({
      name: 'app_browse_dir',
      arguments: dirPath ? { dirPath } : {},
    });
    const sc = res?.structuredContent;
    if (!sc) return;

    browsingDir = sc.currentDir || '';
    browsingParent = sc.parentDir || '';
    el.inputBrowsePath.value = browsingDir;
    el.btnFolderUp.disabled = !browsingParent;
    el.folderPdfHint.textContent = sc.error
      ? sc.error
      : `当前目录含 ${sc.pdfCountInCurrent || 0} 个 PDF（含子目录）`;

    el.folderShortcuts.innerHTML = '';
    for (const s of sc.shortcuts || []) {
      const chip = document.createElement('button');
      chip.className = 'btn btn-sm';
      chip.textContent = s.label;
      chip.title = s.path;
      chip.addEventListener('click', () => openFolderBrowser(s.path));
      el.folderShortcuts.appendChild(chip);
    }

    el.folderSubdirs.innerHTML = '';
    if (!sc.subdirs || sc.subdirs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.style.padding = '12px';
      empty.textContent = '（此目录下没有子文件夹）';
      el.folderSubdirs.appendChild(empty);
    } else {
      for (const d of sc.subdirs) {
        const row = document.createElement('div');
        row.className = 'folder-entry';
        row.textContent = `📁 ${d.name}`;
        row.addEventListener('click', () => openFolderBrowser(d.path));
        el.folderSubdirs.appendChild(row);
      }
    }

    el.folderModal.classList.remove('hidden');
  } catch (err) {
    showToast('浏览文件夹失败: ' + err.message);
  }
}

el.btnPickFolder.addEventListener('click', () => {
  openFolderBrowser(state.currentFolder || '');
});

el.btnCloseFolder.addEventListener('click', () => el.folderModal.classList.add('hidden'));
el.btnCancelFolder.addEventListener('click', () => el.folderModal.classList.add('hidden'));
el.btnFolderUp.addEventListener('click', () => {
  if (browsingParent) openFolderBrowser(browsingParent);
});
el.btnBrowseGo.addEventListener('click', () => {
  const p = el.inputBrowsePath.value.trim();
  if (p) openFolderBrowser(p);
});
el.inputBrowsePath.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const p = el.inputBrowsePath.value.trim();
    if (p) openFolderBrowser(p);
  }
});
el.btnConfirmFolder.addEventListener('click', async () => {
  const target = el.inputBrowsePath.value.trim() || browsingDir;
  if (!target) return;
  el.folderModal.classList.add('hidden');
  await loadFolderByPath(target);
});

el.btnTogglePath.addEventListener('click', () => {
  el.pathBar.classList.toggle('hidden');
});

async function loadFolderByPath(folderPath) {
  if (!folderPath) return;
  const res = await app.callServerTool({
    name: 'app_set_folder',
    arguments: { folderPath },
  });
  const sc = res?.structuredContent;
  if (sc?.error) {
    showToast(sc.error);
    return;
  }
  applyFolderData(sc);
  el.pathBar.classList.add('hidden');
}

el.btnLoadPath.addEventListener('click', () => loadFolderByPath(el.inputFolderPath.value.trim()));
el.selectRecent.addEventListener('change', () => {
  if (el.selectRecent.value) loadFolderByPath(el.selectRecent.value);
});

function applyFolderData(sc) {
  state.currentFolder = sc.currentFolder || '';
  state.recentFolders = sc.recentFolders || [];
  state.files = sc.files || [];
  state.activeFile = sc.activeFile || '';
  state.annotations = sc.annotations || [];
  renderFolderUI();
  renderNotesList();
  if (state.activeFile) {
    openPdfFile(state.activeFile, sc.targetPage || 1);
  } else {
    el.libraryDrawer.classList.remove('hidden');
  }
}

el.btnToggleLibrary.addEventListener('click', () => {
  el.libraryDrawer.classList.toggle('hidden');
});

el.btnToggleNotes.addEventListener('click', () => {
  el.notesDrawer.classList.toggle('hidden');
});

el.inputSearchPapers.addEventListener('input', renderPaperList);

el.btnPrevPage.addEventListener('click', () => scrollToPage(state.currentPage - 1));
el.btnNextPage.addEventListener('click', () => scrollToPage(state.currentPage + 1));
el.inputPage.addEventListener('change', () => scrollToPage(Number(el.inputPage.value) || 1));

el.btnZoomOut.addEventListener('click', async () => {
  state.scale = Math.max(0.5, Number((state.scale - 0.15).toFixed(2)));
  if (state.pdfDoc) await buildPageContainers();
});

el.btnZoomIn.addEventListener('click', async () => {
  state.scale = Math.min(3.0, Number((state.scale + 0.15).toFixed(2)));
  if (state.pdfDoc) await buildPageContainers();
});

el.btnFitWidth.addEventListener('click', async () => {
  if (!state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(state.currentPage || 1);
  const vp1 = page.getViewport({ scale: 1.0 });
  const availWidth = Math.max(240, el.viewerContainer.clientWidth - 32);
  state.scale = Number((availWidth / vp1.width).toFixed(2));
  await buildPageContainers();
  scrollToPage(state.currentPage);
});

// Register MCP App handlers BEFORE connect()
app.onhostcontextchanged = (ctx) => applyTheme(ctx);

app.ontoolresult = (result) => {
  const sc = result?.structuredContent;
  if (!sc) return;
  applyFolderData(sc);
};

(async () => {
  await app.connect();
  state.hostCaps = app.getHostCapabilities() || {};
  applyTheme(app.getHostContext());
  updateCapabilitiesUI();
})();
