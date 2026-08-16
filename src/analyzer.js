/**
 * @file analyzer.js
 * Core analysis engine implementing the 5-pass Unity log analysis algorithm
 * faithful to log_compressor.py with full event grouping, causal context extraction,
 * session summary metrics, and timeline aggregation.
 */

import {
  DEFAULT_CONTEXT_LINES,
  DEFAULT_MAX_GROUP,
  DEFAULT_WINDOW_SEC,
  SEVERITY_LEVELS,
} from './constants.js';

import {
  parseTime,
  cleanLine,
  isNoise,
  matchEvent,
  splitLines,
  formatTime,
  timeDeltaSeconds,
} from './parser.js';

/**
 * Analyzes Unity log lines according to configured window and context rules.
 * 
 * @param {string[]|string} inputLines - Raw text or array of string lines
 * @param {object} [options]
 * @param {number} [options.contextLines=3] - Lines of causal context before each error
 * @param {number} [options.maxGroup=5] - Max representative lines shown per group
 * @param {number} [options.windowSec=10] - Seconds to cluster rapid repeated events
 * @returns {object} Analysis result
 */
export function analyzeLog(inputLines, options = {}) {
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const maxGroup = options.maxGroup ?? DEFAULT_MAX_GROUP;
  const windowSec = options.windowSec ?? DEFAULT_WINDOW_SEC;

  const rawLines = Array.isArray(inputLines) ? inputLines : splitLines(inputLines);

  // --- Pass 1: Parse everything ---
  // Array of { time, raw, clean, index }
  const parsed = [];
  let currentTime = null;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const t = parseTime(raw);
    if (t) {
      currentTime = t;
    }
    parsed.push({
      index: i,
      time: currentTime,
      raw: raw.replace(/\r?$/, ''),
      clean: cleanLine(raw),
    });
  }

  // --- Pass 2: Collect events ---
  // Array of { index, time, severity, category, label, clean, raw }
  const rawEvents = [];
  const sceneEvents = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (isNoise(item.raw)) {
      continue;
    }
    const match = matchEvent(item.raw);
    if (match) {
      const { severity, category, label } = match;
      const eventObj = {
        index: i,
        time: item.time,
        severity,
        category,
        label,
        clean: item.clean,
        raw: item.raw,
      };
      rawEvents.push(eventObj);

      if (category === 'SceneLoad' && item.time) {
        const sceneName = item.clean.replace(/^.*?Loaded Scene:\s*/i, '').trim();
        sceneEvents.push({
          time: formatTime(item.time),
          sceneName,
          totalSeconds: item.time.totalSeconds,
        });
      }
    }
  }

  // --- Pass 3: Group repeated events, deduplicate within window ---
  const groups = {};
  const lastByCat = {};

  for (const ev of rawEvents) {
    const { index, time, severity, category, label } = ev;

    if (!groups[category]) {
      groups[category] = {
        category,
        severity: '',
        label,
        occurrences: [],
        times: [],
        count: 0,
      };
    }

    // Deduplicate: same category within windowSec -> skip detailed context
    if (
      lastByCat[category] !== undefined &&
      time &&
      lastByCat[category]
    ) {
      const delta = timeDeltaSeconds(time, lastByCat[category]);
      if (delta <= windowSec && category !== 'SceneLoad' && category !== 'SceneReload') {
        groups[category].occurrences.push({
          time: '',
          context: [],
          index,
          deduped: true,
        });
        groups[category].times.push(time);
        groups[category].count++;
        lastByCat[category] = time;
        continue;
      }
    }

    // Grab causal context (lines before this event)
    const ctxStart = Math.max(0, index - contextLines);
    const ctx = [];
    for (let c = ctxStart; c < index; c++) {
      const p = parsed[c];
      if (p.clean && !isNoise(p.raw) && !matchEvent(p.raw)) {
        ctx.push(p.clean);
      }
    }

    const currentGroupSev = groups[category].severity;
    const currWeight = SEVERITY_LEVELS[currentGroupSev] || 0;
    const newWeight = SEVERITY_LEVELS[severity] || 0;

    groups[category].severity = newWeight > currWeight ? severity : currentGroupSev || severity;
    groups[category].label = label;
    groups[category].occurrences.push({
      time: formatTime(time),
      context: ctx,
      index,
      raw: ev.raw,
      deduped: false,
    });
    groups[category].times.push(time);
    groups[category].count++;
    lastByCat[category] = time;
  }

  // --- Pass 4: Session summary ---
  const timesAll = rawEvents.map((e) => e.time).filter(Boolean);
  const counts = {
    EXCEPTION: 0,
    ERROR: 0,
    WARNING: 0,
    LOG: 0,
  };

  for (const ev of rawEvents) {
    if (counts[ev.severity] !== undefined) {
      counts[ev.severity]++;
    }
  }

  const session = {
    start: timesAll.length > 0 ? formatTime(timesAll[0]) : 'N/A',
    end: timesAll.length > 0 ? formatTime(timesAll[timesAll.length - 1]) : 'N/A',
    total_lines: rawLines.length,
    exceptions: counts.EXCEPTION,
    errors: counts.ERROR,
    warnings: counts.WARNING,
    logs: counts.LOG,
    scenes: sceneEvents.length,
    totalCritical: counts.EXCEPTION + counts.ERROR + counts.WARNING,
  };

  // --- Pass 5: Timeline ---
  const timeline = [];
  const seenCatsInWindow = new Set();
  let windowStartTime = timesAll.length > 0 ? timesAll[0] : null;

  for (const ev of rawEvents) {
    if (ev.severity === 'LOG' && ev.category !== 'SceneLoad') {
      continue;
    }

    if (ev.time && windowStartTime) {
      const deltaFromWindow = timeDeltaSeconds(ev.time, windowStartTime);
      if (deltaFromWindow > windowSec) {
        seenCatsInWindow.clear();
        windowStartTime = ev.time;
      }
    }

    const hhmm = ev.time ? `${String(ev.time.hours).padStart(2, '0')}:${String(ev.time.minutes).padStart(2, '0')}` : '';
    const key = `${ev.category}_${hhmm}`;

    if (!seenCatsInWindow.has(key) || ev.category === 'SceneLoad') {
      timeline.push({
        time: formatTime(ev.time),
        severity: ev.severity,
        label: ev.label,
        category: ev.category,
        clean: ev.clean.slice(0, 100),
        raw: ev.raw,
        index: ev.index,
      });
      seenCatsInWindow.add(key);
    }
  }

  return {
    session,
    sceneEvents,
    groups,
    timeline,
    rawEvents,
    parsedLinesCount: parsed.length,
    options: { contextLines, maxGroup, windowSec },
  };
}
