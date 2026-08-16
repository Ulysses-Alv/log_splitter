# Porting Notes: Python to Static JavaScript

This document details the architectural port from the Python reference implementations (`log_compressor.py` and `log_splitter.py`) to the static, client-side vanilla JavaScript web application (`Unity Log Analyzer`).

---

## 1. What the Python Implementation Did

The Python codebase contained two CLI utilities:

### `log_compressor.py`
1. **5-Pass Log Processing**:
   - **Pass 1**: Indexed timestamps (`HH:MM:SS.mmm`) and forward-filled timestamps across multiline stack traces while cleaning HTML tags and whitespace.
   - **Pass 2**: Filtered out noise lines (empty lines, Unity stack trace frames, `UnityEngine.Debug` boilerplate) and matched critical event patterns using regular expressions.
   - **Pass 3**: Grouped critical events by category with time-window deduplication (default: 10s) and extracted 3 lines of causal context before each error.
   - **Pass 4**: Aggregated session metadata (start time, end time, total line count, exceptions, errors, warnings, scene loads).
   - **Pass 5**: Constructed a chronological event timeline (scene loads + first occurrence of each error type per minute).
2. **Markdown Generation (`render_md`)**:
   - Output an AI-optimized markdown document (`analysis.md`) structured with a session overview table, scene timeline, grouped critical events with formatted context codeblocks, event timeline, and prompt suggestions for LLMs.

### `log_splitter.py`
1. **Critical Event Slicing**:
   - Detected critical events (`NullReferenceException`, `NavMesh`, `Physics`, scene loads/reloads).
   - Deduplicated events of the same label occurring within 5 seconds.
   - For each detected event, extracted a surrounding temporal window (default: -30s before to +30s after) of raw log lines.
   - Wrote individual event files (`event_XX_label_timestamp.txt`) and a `summary.txt` manifest.

---

## 2. JavaScript Implementation Architecture

The JavaScript implementation ports and unifies both capabilities into a zero-dependency static web application:

- **`src/constants.js`**: Centralized configuration constants, severity hierarchy, regex patterns for events and noise filters, and time window defaults.
- **`src/parser.js`**: Clean, modular parsing functions (`parseTime`, `cleanLine`, `isNoise`, `matchEvent`, `splitLines`, `timeDeltaSeconds`).
- **`src/analyzer.js`**: Complete 5-pass log analysis engine (`analyzeLog`) returning structured session metrics, scene events, grouped occurrences with causal context, and timeline entries.
- **`src/splitter.js`**: Time-window slicing engine (`splitLogEvents`) computing exact event bounds and extracting temporal windows for interactive inspection or download.
- **`src/markdown.js`**: Markdown generator (`renderMarkdown`) reproducing the AI prompt format.
- **`src/worker.js`**: Dedicated Web Worker offloading heavy parsing and analysis of large multi-megabyte log files to a background thread.
- **`src/samples.js`**: Embedded realistic sample logs for instant 1-click testing in the browser.
- **`src/app.js`**: State manager, drag-and-drop / file picker controller, UI tab manager, and client-side exporter.
- **`index.html` & `styles/main.css`**: Responsive developer UI in dark mode with KPI metric cards, collapsible context boxes, filterable timelines, and raw log inspector.

---

## 3. Detailed Comparison & Differences

| Dimension | Python Reference | JavaScript Implementation | Rationale & Impact |
| :--- | :--- | :--- | :--- |
| **Runtime & Execution** | CLI script using Python standard library (`re`, `datetime`, `collections`, `shutil`). | Client-side JavaScript (ES Modules) in browser with Web Worker support & Node.js CLI compatibility. | Enables 100% private, zero-backend execution directly in user's browser or on GitHub Pages. |
| **File Ingestion** | Local filesystem batch search (`os.listdir`, `f.readlines()`). | HTML5 Drag-and-Drop, `FileReader` API, and pasted text support. | Interactive single-file or multi-file workflow without disk access restrictions. |
| **Concurrency & Responsiveness** | Synchronous, blocks console during execution. | Dedicated Web Worker with progress callbacks (`postMessage`) and synchronous fallback. | Prevents browser UI freezes on logs with tens of thousands of lines. |
| **Time Parsing & Arithmetic** | `datetime.strptime(..., "%H:%M:%S")` (base year 1900). | Structured `{ hours, minutes, seconds, millis, totalSeconds, timeStr }` object with range validation (`0-23`h, `0-59`m, `0-59`s). | High-speed numeric calculations without Date instantiation overhead; rejects impossible timestamps like `99:99:99`. |
| **Midnight Rollover** | In Python, crossing midnight (e.g. `23:59:50` to `00:00:10`) causes `(t - last).total_seconds()` to yield ~86360s. | `timeDeltaSeconds` detects differences > 43200s and wraps modulo 86400s (e.g. 20s delta). | Seamless deduplication and window slicing across midnight boundary sessions. |
| **Newline Handling** | `f.readlines()` retains `\n` on each element; trailing `\n` does not add an extra empty line. | `splitLines` strips trailing `\r?\n` before splitting to prevent phantom empty lines. | Guarantees exact line count match between Python and JavaScript. |
| **Interactive Visualization** | Static text and `.md` files written to subfolders. | Interactive UI with KPI cards, timeline filter by severity, search in raw log, and 1-click clipboard copy. | Vastly superior developer experience for debugging live game sessions. |

---

## 4. Intentional Behavioral Enhancements

1. **Unified Tooling**:
   - `log_compressor.py` and `log_splitter.py` were previously separate scripts. The JS implementation seamlessly integrates both: users get both grouped AI analysis and time-window slice extraction in a single view.
2. **Interactive Event Slice Preview**:
   - Rather than forcing the user to download files to see sliced windows, users can browse each `-30s / +30s` window interactively in the Web UI and download only if needed.
3. **Graceful Fallback**:
   - If Web Workers are unavailable (e.g. specific local browser policies), the application transparently falls back to chunked main-thread execution.
4. **Parity Validation**:
   - Automated test suite (`tests/compare_with_python.mjs`) validates that `analyzeLog` output matches `log_compressor.py` across 100% of fixtures.

---

## 5. Security and Privacy Guarantees

- **Zero Network Egress**: The application contains no `fetch`, `XMLHttpRequest`, analytics, or tracking scripts.
- **Offline-Ready**: The site can be cached via Service Worker or opened directly offline from local files.
- **Client-Side Processing**: All log data remains strictly in the browser's memory and is discarded on tab close.
