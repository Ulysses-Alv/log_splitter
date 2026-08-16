# Unity Log Analyzer (Web) ⚡

A static, zero-backend, client-side web application for analyzing Unity runtime logs and compressing them into token-efficient, AI-optimized prompts (Claude, GPT-4, Gemini) and time-window event slices.

Built with **vanilla HTML5, CSS3, and modern JavaScript (ES Modules)**.

---

## 🌟 Key Features

- **100% Client-Side & Private**: All parsing, causal context extraction, and slicing happen in your browser memory. Zero network traffic, zero analytics, zero data storage.
- **AI-Optimized Context Compression**: Generates structured Markdown (`analysis.md`) with session metrics, scene timelines, grouped error clusters, and causal context lines.
- **Interactive Event Time-Window Slicing**: Pinpoints critical events (`NullReferenceException`, `NavMesh`, `Physics`) and slices `-30s / +30s` windows for forensic inspection.
- **Fast Web Worker Pipeline**: Offloads heavy processing of large logs to background threads with live progress meters.
- **Developer-Centric Dark Mode UI**: Crisp typography, KPI cards, collapsible context boxes, severity filterable timelines, and raw log search.
- **Embedded Sample Demos**: 1-click loading of realistic game crash cascades, warnings, and rapid error bursts.
- **GitHub Pages Ready**: Fully static, relative asset paths, zero external CDN dependencies.

---

## 🚀 Getting Started

### 1. Open Directly in Browser
Because this application has zero backend dependencies, you can simply open `index.html` in any modern web browser or serve it with any static web server:

```bash
# Optional: using any local HTTP server
npx serve .
# or Python's built-in server
python -m http.server 8000
```

### 2. Live on GitHub Pages
Deploy directly to GitHub Pages by pushing to `main` (automated GitHub Actions workflow is included in `.github/workflows/deploy.yml`).

---

## 🧪 Testing & Parity Verification

A comprehensive test suite is included to guarantee 100% behavioral parity with the reference Python implementations:

```bash
# Run unit tests
npm test

# Run Python vs JavaScript parity comparison across all fixtures
npm run test:parity

# Run all tests
npm run test:all
```

You can also run tests directly in the browser by opening `tests/test_runner.html`.

---

## 📂 Architecture

```
.
├── index.html                     # Application single-page entrypoint
├── package.json                   # Test scripts & metadata
├── styles/
│   └── main.css                   # Dark mode developer UI design system
├── src/
│   ├── constants.js               # Patterns, severity levels, configuration defaults
│   ├── parser.js                  # Timestamps, HTML tags, noise filtering, line indexing
│   ├── analyzer.js                # 5-pass log analysis & causal context engine
│   ├── splitter.js                # Time-window event slicing (-30s / +30s)
│   ├── markdown.js                # AI prompt & markdown report renderer
│   ├── worker.js                  # Web Worker for background processing
│   ├── samples.js                 # Embedded realistic test datasets
│   └── app.js                     # State management, drag-and-drop, UI controller
├── docs/
│   └── PORTING_NOTES.md           # Python to JS porting decisions & specifications
├── tests/
│   ├── fixtures/                  # 8 realistic & edge-case log fixtures
│   ├── unit_tests.mjs             # Native Node.js test suite
│   ├── validate_parity.py         # Python reference benchmark runner
│   ├── compare_with_python.mjs    # Automated Python vs JS parity validator
│   └── test_runner.html           # In-browser test runner
└── .github/
    └── workflows/
        └── deploy.yml             # GitHub Actions CI/CD for GitHub Pages
```

---

## 📄 License

MIT License
