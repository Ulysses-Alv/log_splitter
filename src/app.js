/**
 * @file app.js
 * Main frontend application orchestrator for Unity Log Analyzer.
 * Manages state, file ingestion, Web Worker lifecycle, UI rendering, and export utilities.
 */

import { analyzeLog } from './analyzer.js';
import { splitLogEvents } from './splitter.js';
import { renderMarkdown } from './markdown.js';
import { splitLines, formatTime } from './parser.js';
import { SAMPLE_LOGS } from './samples.js';
import {
  DEFAULT_CONTEXT_LINES,
  DEFAULT_MAX_GROUP,
  DEFAULT_WINDOW_SEC,
  DEFAULT_SPLIT_WINDOW_BEFORE,
  DEFAULT_SPLIT_WINDOW_AFTER,
  SEVERITY_ICONS,
  SEVERITY_CLASSES,
} from './constants.js';

// Application State
const state = {
  fileName: '',
  fileSize: 0,
  rawText: '',
  rawLines: [],
  analysis: null,
  markdown: '',
  splitResult: null,
  activeTab: 'groups',
  timelineFilter: 'ALL',
  selectedSplitId: 1,
  config: {
    contextLines: DEFAULT_CONTEXT_LINES,
    maxGroup: DEFAULT_MAX_GROUP,
    windowSec: DEFAULT_WINDOW_SEC,
    splitWindowBefore: DEFAULT_SPLIT_WINDOW_BEFORE,
    splitWindowAfter: DEFAULT_SPLIT_WINDOW_AFTER,
  },
  worker: null,
};

// DOM Element References
const elements = {};

function initDomReferences() {
  elements.dropzone = document.getElementById('dropzone');
  elements.fileInput = document.getElementById('fileInput');
  elements.btnSelectFile = document.getElementById('btnSelectFile');
  elements.ingestionSection = document.getElementById('ingestionSection');
  elements.processingCard = document.getElementById('processingCard');
  elements.progressBarFill = document.getElementById('progressBarFill');
  elements.processingStage = document.getElementById('processingStage');
  elements.resultsSection = document.getElementById('resultsSection');

  // KPI elements
  elements.kpiFileName = document.getElementById('kpiFileName');
  elements.kpiFileSize = document.getElementById('kpiFileSize');
  elements.kpiTimeRange = document.getElementById('kpiTimeRange');
  elements.kpiLines = document.getElementById('kpiLines');
  elements.kpiExceptions = document.getElementById('kpiExceptions');
  elements.kpiErrors = document.getElementById('kpiErrors');
  elements.kpiWarnings = document.getElementById('kpiWarnings');
  elements.kpiScenes = document.getElementById('kpiScenes');
  elements.kpiCompression = document.getElementById('kpiCompression');

  // Action buttons
  elements.btnCopyMarkdown = document.getElementById('btnCopyMarkdown');
  elements.btnDownloadMarkdown = document.getElementById('btnDownloadMarkdown');
  elements.btnDownloadSplitSummary = document.getElementById('btnDownloadSplitSummary');
  elements.btnReset = document.getElementById('btnReset');
  elements.btnApplyConfig = document.getElementById('btnApplyConfig');

  // Config inputs
  elements.inputContextLines = document.getElementById('inputContextLines');
  elements.inputMaxGroup = document.getElementById('inputMaxGroup');
  elements.inputWindowSec = document.getElementById('inputWindowSec');

  // Tab buttons and panes
  elements.tabButtons = document.querySelectorAll('.tab-btn');
  elements.tabPanes = document.querySelectorAll('.tab-pane');
  elements.tabBadgeGroups = document.getElementById('tabBadgeGroups');
  elements.tabBadgeTimeline = document.getElementById('tabBadgeTimeline');
  elements.tabBadgeSplit = document.getElementById('tabBadgeSplit');

  // Tab Content containers
  elements.groupsContainer = document.getElementById('groupsContainer');
  elements.timelineContainer = document.getElementById('timelineContainer');
  elements.timelineFilterBtns = document.querySelectorAll('.timeline-filter-btn');
  elements.splitSidebar = document.getElementById('splitSidebar');
  elements.splitPreviewTitle = document.getElementById('splitPreviewTitle');
  elements.splitPreviewCode = document.getElementById('splitPreviewCode');
  elements.btnCopySplitSlice = document.getElementById('btnCopySplitSlice');
  elements.btnDownloadSplitSlice = document.getElementById('btnDownloadSplitSlice');
  elements.markdownCodeArea = document.getElementById('markdownCodeArea');
  elements.btnCopyMarkdownTab = document.getElementById('btnCopyMarkdownTab');

  // Raw log elements
  elements.rawLogViewer = document.getElementById('rawLogViewer');
  elements.rawLogSearch = document.getElementById('rawLogSearch');

  // Toast
  elements.toast = document.getElementById('toast');
  elements.toastMessage = document.getElementById('toastMessage');

  // Sample Buttons
  elements.sampleBtns = document.querySelectorAll('[data-sample]');
}

// Web Worker Initialization with Fallback
function initWorker() {
  try {
    const workerUrl = new URL('./worker.js', import.meta.url);
    state.worker = new Worker(workerUrl, { type: 'module' });

    state.worker.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'PROGRESS') {
        updateProgress(payload.percent, payload.stage);
      } else if (type === 'RESULT') {
        onAnalysisComplete(payload);
      } else if (type === 'ERROR') {
        console.error('Worker error:', payload);
        fallbackDirectAnalysis();
      }
    };

    state.worker.onerror = (err) => {
      console.warn('Worker initialization or runtime error, switching to direct execution:', err);
      state.worker = null;
    };
  } catch (err) {
    console.warn('Web Worker not supported or restricted by environment, using direct execution:', err);
    state.worker = null;
  }
}

// Update progress bar
function updateProgress(percent, stage) {
  if (elements.progressBarFill) {
    elements.progressBarFill.style.width = `${percent}%`;
  }
  if (elements.processingStage) {
    elements.processingStage.textContent = stage;
  }
}

// Show Toast notification
function showToast(message) {
  if (!elements.toast) return;
  elements.toastMessage.textContent = message;
  elements.toast.classList.add('show');
  setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 2500);
}

// File Ingestion Handler
export function handleFile(file) {
  if (!file) return;

  state.fileName = file.name;
  state.fileSize = file.size;

  showProcessingState();

  const reader = new FileReader();

  reader.onprogress = (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 20);
      updateProgress(percent, `Reading file (${formatBytes(e.loaded)} / ${formatBytes(e.total)})...`);
    }
  };

  reader.onload = (e) => {
    state.rawText = e.target.result;
    processLogContent();
  };

  reader.onerror = (err) => {
    alert('Failed to read file: ' + err);
    hideProcessingState();
  };

  reader.readAsText(file);
}

// Process Text Content via Worker or Direct Fallback
function processLogContent() {
  updateProgress(25, 'Starting analysis engine...');

  if (state.worker) {
    state.worker.postMessage({
      type: 'ANALYZE_ALL',
      payload: {
        text: state.rawText,
        filename: state.fileName,
        options: state.config,
      },
    });
  } else {
    fallbackDirectAnalysis();
  }
}

// Synchronous Direct Execution Fallback
function fallbackDirectAnalysis() {
  setTimeout(() => {
    try {
      updateProgress(40, 'Parsing lines and extracting events...');
      const analysis = analyzeLog(state.rawText, state.config);

      updateProgress(70, 'Rendering AI Markdown report...');
      const markdown = renderMarkdown(
        state.fileName || 'log.txt',
        analysis.session,
        analysis.sceneEvents,
        analysis.groups,
        analysis.timeline,
        state.config.maxGroup
      );

      updateProgress(85, 'Extracting time-window slices...');
      const splitResult = splitLogEvents(state.rawText, {
        windowBefore: state.config.splitWindowBefore,
        windowAfter: state.config.splitWindowAfter,
        filename: state.fileName || 'log.txt',
      });

      updateProgress(100, 'Done!');
      onAnalysisComplete({ analysis, markdown, splitResult });
    } catch (err) {
      alert('Error analyzing log: ' + (err?.message || err));
      hideProcessingState();
    }
  }, 50);
}

// Handle Analysis Complete
function onAnalysisComplete({ analysis, markdown, splitResult }) {
  state.analysis = analysis;
  state.markdown = markdown;
  state.splitResult = splitResult;
  state.rawLines = splitLines(state.rawText);

  renderAllViews();
  hideProcessingState();
  showResultsState();
}

// View Switching States
function showProcessingState() {
  elements.ingestionSection.style.display = 'none';
  elements.resultsSection.style.display = 'none';
  elements.processingCard.style.display = 'block';
  updateProgress(5, 'Initializing...');
}

function hideProcessingState() {
  elements.processingCard.style.display = 'none';
}

function showResultsState() {
  elements.ingestionSection.style.display = 'none';
  elements.resultsSection.style.display = 'flex';
}

function resetToIngestion() {
  state.rawText = '';
  state.rawLines = [];
  state.analysis = null;
  state.markdown = '';
  state.splitResult = null;
  elements.fileInput.value = '';

  elements.resultsSection.style.display = 'none';
  elements.processingCard.style.display = 'none';
  elements.ingestionSection.style.display = 'flex';
}

// Format Helper: Bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Main Render Function
function renderAllViews() {
  renderKpis();
  renderGroupedEvents();
  renderTimeline();
  renderSplitView();
  renderMarkdownView();
  renderRawLog();
}

// Render KPI Cards and Header
function renderKpis() {
  const { session } = state.analysis;
  elements.kpiFileName.textContent = state.fileName || 'log.txt';
  elements.kpiFileSize.textContent = `${formatBytes(state.fileSize || state.rawText.length)} • ${session.total_lines.toLocaleString()} lines`;
  elements.kpiTimeRange.textContent = `${session.start} → ${session.end}`;
  elements.kpiLines.textContent = session.total_lines.toLocaleString();
  elements.kpiExceptions.textContent = session.exceptions;
  elements.kpiErrors.textContent = session.errors;
  elements.kpiWarnings.textContent = session.warnings;
  elements.kpiScenes.textContent = session.scenes;

  const rawBytes = Math.max(state.rawText.length, 1);
  const mdBytes = state.markdown.length;
  const compressionRatio = Math.max(0, Math.round((1 - mdBytes / rawBytes) * 100));
  elements.kpiCompression.textContent = `${compressionRatio}%`;

  // Update tab badges
  const groupCount = Object.keys(state.analysis.groups).length;
  elements.tabBadgeGroups.textContent = groupCount;
  elements.tabBadgeTimeline.textContent = state.analysis.timeline.length;
  elements.tabBadgeSplit.textContent = state.splitResult?.events?.length || 0;
}

// Render Tab 1: Grouped Events
function renderGroupedEvents() {
  const container = elements.groupsContainer;
  container.innerHTML = '';

  const groups = Object.values(state.analysis.groups);
  if (groups.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
        <p style="font-size: 1.1rem; font-weight: 600; color: var(--text-secondary);">No critical events detected</p>
        <p style="font-size: 0.85rem;">This log session contains zero exceptions, errors, or warnings.</p>
      </div>
    `;
    return;
  }

  // Sort groups by severity weight desc, then by occurrences length desc
  const severityWeight = { EXCEPTION: 4, ERROR: 3, WARNING: 2, LOG: 1 };
  groups.sort((a, b) => {
    const swA = severityWeight[a.severity] || 0;
    const swB = severityWeight[b.severity] || 0;
    if (swB !== swA) return swB - swA;
    return b.occurrences.length - a.occurrences.length;
  });

  for (const grp of groups) {
    const card = document.createElement('div');
    card.className = 'group-card';

    const sevClass = SEVERITY_CLASSES[grp.severity] || 'sev-log';
    const sevIcon = SEVERITY_ICONS[grp.severity] || '⚪';

    const timesWithData = grp.occurrences.filter((o) => o.time);
    const firstTs = timesWithData.length > 0 ? timesWithData[0].time : 'N/A';
    const lastTs = timesWithData.length > 0 ? timesWithData[timesWithData.length - 1].time : 'N/A';
    const timeRange = firstTs === lastTs ? firstTs : `${firstTs} → ${lastTs}`;

    const occurrencesWithContext = grp.occurrences.filter((o) => !o.deduped);
    const dedupedCount = grp.occurrences.filter((o) => o.deduped).length;

    let occurrencesHtml = '';
    let countShown = 0;
    for (const occ of occurrencesWithContext) {
      if (countShown >= state.config.maxGroup) break;

      const triggerText = occ.clean || cleanLine(occ.raw) || occ.raw || grp.label;

      let contextHtml = '';
      if (occ.context && occ.context.length > 0) {
        contextHtml = `
          <div class="occurrence-context-section">
            <div class="context-section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
              Preceding Causal Context (${occ.context.length} ${occ.context.length === 1 ? 'line' : 'lines'} before):
            </div>
            <div class="context-box">
              ${occ.context.map((c) => `<span class="context-line">${escapeHtml(c)}</span>`).join('')}
            </div>
          </div>
        `;
      } else {
        contextHtml = `
          <div class="occurrence-context-section">
            <div class="context-box"><span class="context-line context-line-muted">No preceding non-noise context lines</span></div>
          </div>
        `;
      }

      occurrencesHtml += `
        <div class="occurrence-item">
          <div class="occurrence-header">
            <span class="occurrence-meta">
              <strong class="time-tag">@ ${occ.time}</strong>
              <span class="line-badge">Line #${occ.index + 1}</span>
            </span>
          </div>
          <div class="occurrence-trigger-box">
            <span class="trigger-tag">EVENT</span>
            <span class="trigger-text">${escapeHtml(triggerText)}</span>
          </div>
          ${contextHtml}
        </div>
      `;
      countShown++;
    }

    if (grp.occurrences.length > countShown) {
      occurrencesHtml += `
        <div style="font-size: 0.8rem; color: var(--text-muted); padding: 0.5rem; text-align: center;">
          <em>...and ${grp.occurrences.length - countShown} more occurrences (omitted for brevity, ${dedupedCount} clustered rapid repeats)</em>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="group-header">
        <div class="group-title-area">
          <span class="group-sev-pill ${sevClass}">${sevIcon} ${grp.severity}</span>
          <span class="group-label">${escapeHtml(grp.label)}</span>
        </div>
        <div class="group-meta">
          <span>Category: <code>${grp.category}</code></span>
          <span>When: <code>${timeRange}</code></span>
          <span class="badge" style="font-weight: 700;">${grp.occurrences.length} ${grp.occurrences.length === 1 ? 'occurrence' : 'occurrences'}</span>
        </div>
      </div>
      <div class="group-body">
        ${occurrencesHtml}
      </div>
    `;

    container.appendChild(card);
  }
}

// Render Tab 2: Timeline
function renderTimeline() {
  const container = elements.timelineContainer;
  container.innerHTML = '';

  const { timeline } = state.analysis;
  if (timeline.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
        <p>No timeline events recorded.</p>
      </div>
    `;
    return;
  }

  const filtered = timeline.filter((item) => {
    if (state.timelineFilter === 'ALL') return true;
    if (state.timelineFilter === 'SceneLoad') return item.category === 'SceneLoad';
    return item.severity === state.timelineFilter;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">
        <p>No events match the selected filter (${state.timelineFilter}).</p>
      </div>
    `;
    return;
  }

  const list = document.createElement('div');
  list.className = 'timeline-list';

  for (const ev of filtered) {
    const item = document.createElement('div');
    item.className = 'timeline-item';

    const isScene = ev.category === 'SceneLoad';
    const dotClass = isScene ? 'sev-scene' : (SEVERITY_CLASSES[ev.severity] || 'sev-log');
    const sevPillClass = isScene ? 'sev-scene' : (SEVERITY_CLASSES[ev.severity] || 'sev-log');
    const sevLabel = isScene ? 'SCENE LOAD' : ev.severity;
    const sevIcon = isScene ? '🗺️' : (SEVERITY_ICONS[ev.severity] || '⚪');

    item.innerHTML = `
      <div class="timeline-dot ${dotClass}"></div>
      <div class="timeline-content-card">
        <div class="timeline-content-header">
          <div>
            <span class="group-sev-pill ${sevPillClass}" style="font-size: 0.7rem; padding: 0.1rem 0.45rem;">${sevIcon} ${sevLabel}</span>
            <strong class="timeline-title" style="margin-left: 0.4rem;">${escapeHtml(ev.label)}</strong>
          </div>
          <span class="timeline-timestamp">${ev.time}</span>
        </div>
        <div class="timeline-snippet">${escapeHtml(ev.clean)}</div>
      </div>
    `;

    list.appendChild(item);
  }

  container.appendChild(list);
}

// Render Tab 3: Split View
function renderSplitView() {
  const sidebar = elements.splitSidebar;
  sidebar.innerHTML = '';

  const events = state.splitResult?.events || [];
  if (events.length === 0) {
    sidebar.innerHTML = `
      <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No critical events found to split.
      </div>
    `;
    elements.splitPreviewTitle.textContent = 'No Event Selected';
    elements.splitPreviewCode.textContent = state.splitResult?.summaryText || 'No events.';
    return;
  }

  events.forEach((ev, idx) => {
    const btn = document.createElement('button');
    btn.className = `split-item-btn ${ev.id === state.selectedSplitId ? 'active' : ''}`;
    btn.innerHTML = `
      <div class="split-item-header">
        <span class="badge" style="font-size: 0.7rem;">#${String(ev.id).padStart(2, '0')}</span>
        <span style="font-family: var(--font-mono); color: var(--text-link);">${ev.timeStr}</span>
      </div>
      <div class="split-item-title">${ev.label.toUpperCase()}</div>
      <div class="split-item-trigger" title="${escapeHtml(ev.trigger)}">${escapeHtml(ev.trigger)}</div>
    `;

    btn.addEventListener('click', () => {
      state.selectedSplitId = ev.id;
      renderSplitView();
    });

    sidebar.appendChild(btn);
  });

  const selectedEvent = events.find((e) => e.id === state.selectedSplitId) || events[0];
  if (selectedEvent) {
    elements.splitPreviewTitle.textContent = `${selectedEvent.filename} (${selectedEvent.linesCount} lines, window ${selectedEvent.tStartStr} → ${selectedEvent.tEndStr})`;
    elements.splitPreviewCode.textContent = selectedEvent.content;
  }
}

// Render Tab 4: Markdown View
function renderMarkdownView() {
  elements.markdownCodeArea.textContent = state.markdown;
}

// Render Tab 5: Raw Log
function renderRawLog() {
  const viewer = elements.rawLogViewer;
  viewer.innerHTML = '';

  const filter = (elements.rawLogSearch.value || '').toLowerCase();
  const maxRender = 1000;
  let renderedCount = 0;

  const fragment = document.createDocumentFragment();

  for (let i = 0; i < state.rawLines.length; i++) {
    const line = state.rawLines[i];
    if (filter && !line.toLowerCase().includes(filter)) {
      continue;
    }

    if (renderedCount >= maxRender) {
      const notice = document.createElement('div');
      notice.style.padding = '1rem';
      notice.style.color = 'var(--text-muted)';
      notice.style.textAlign = 'center';
      notice.innerHTML = `<em>...rendering capped at ${maxRender} lines for performance. Use the search filter to narrow down.</em>`;
      fragment.appendChild(notice);
      break;
    }

    const lineDiv = document.createElement('div');
    lineDiv.className = 'raw-line';

    const numSpan = document.createElement('span');
    numSpan.className = 'raw-line-num';
    numSpan.textContent = i + 1;

    const contentSpan = document.createElement('span');
    contentSpan.className = 'raw-line-content';
    contentSpan.textContent = line;

    lineDiv.appendChild(numSpan);
    lineDiv.appendChild(contentSpan);
    fragment.appendChild(lineDiv);

    renderedCount++;
  }

  if (renderedCount === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '2rem';
    empty.style.textAlign = 'center';
    empty.style.color = 'var(--text-muted)';
    empty.textContent = 'No matching lines found.';
    fragment.appendChild(empty);
  }

  viewer.appendChild(fragment);
}

// Utilities: HTML escape
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Utilities: Download File
function downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// Bind Event Listeners
function bindEvents() {
  // Dropzone drag & drop
  const dropzone = elements.dropzone;
  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  });

  // File Picker
  elements.fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  elements.btnSelectFile.addEventListener('click', () => {
    elements.fileInput.click();
  });

  // Sample Log Buttons
  elements.sampleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const sampleKey = btn.getAttribute('data-sample');
      const sample = SAMPLE_LOGS[sampleKey];
      if (sample) {
        state.fileName = sample.name;
        state.fileSize = sample.content.length;
        state.rawText = sample.content;
        showProcessingState();
        setTimeout(() => processLogContent(), 50);
      }
    });
  });

  // Navigation Tabs
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      state.activeTab = targetTab;

      elements.tabButtons.forEach((b) => b.classList.remove('active'));
      elements.tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const activePane = document.getElementById(`tab-${targetTab}`);
      if (activePane) activePane.classList.add('active');
    });
  });

  // Timeline Filter Buttons
  elements.timelineFilterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      elements.timelineFilterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.timelineFilter = btn.getAttribute('data-filter');
      renderTimeline();
    });
  });

  // Copy Markdown
  const copyMdHandler = () => {
    navigator.clipboard.writeText(state.markdown).then(() => {
      showToast('AI Markdown copied to clipboard!');
    }).catch(() => {
      showToast('Copied to clipboard');
    });
  };
  elements.btnCopyMarkdown.addEventListener('click', copyMdHandler);
  elements.btnCopyMarkdownTab.addEventListener('click', copyMdHandler);

  // Download Markdown
  elements.btnDownloadMarkdown.addEventListener('click', () => {
    downloadFile('analysis.md', state.markdown, 'text/markdown;charset=utf-8');
  });

  // Download Split Summary
  elements.btnDownloadSplitSummary.addEventListener('click', () => {
    if (state.splitResult) {
      downloadFile('summary.txt', state.splitResult.summaryText);
    }
  });

  // Copy & Download Split Slice
  elements.btnCopySplitSlice.addEventListener('click', () => {
    const selected = state.splitResult?.events?.find((e) => e.id === state.selectedSplitId);
    if (selected) {
      navigator.clipboard.writeText(selected.content).then(() => {
        showToast(`Copied ${selected.filename} to clipboard!`);
      });
    }
  });

  elements.btnDownloadSplitSlice.addEventListener('click', () => {
    const selected = state.splitResult?.events?.find((e) => e.id === state.selectedSplitId);
    if (selected) {
      downloadFile(selected.filename, selected.content);
    }
  });

  // Re-analyze on Config Apply
  elements.btnApplyConfig.addEventListener('click', () => {
    state.config.contextLines = parseInt(elements.inputContextLines.value, 10) || DEFAULT_CONTEXT_LINES;
    state.config.maxGroup = parseInt(elements.inputMaxGroup.value, 10) || DEFAULT_MAX_GROUP;
    state.config.windowSec = parseInt(elements.inputWindowSec.value, 10) || DEFAULT_WINDOW_SEC;

    if (state.rawText) {
      showProcessingState();
      setTimeout(() => processLogContent(), 50);
    }
  });

  // Reset Button
  elements.btnReset.addEventListener('click', () => {
    resetToIngestion();
  });

  // Raw Log Search
  elements.rawLogSearch.addEventListener('input', () => {
    renderRawLog();
  });
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  initDomReferences();
  initWorker();
  bindEvents();
});
