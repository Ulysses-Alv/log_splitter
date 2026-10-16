/**
 * @file analyzer.js
 * Core analysis engine implementing the 5-pass Unity log analysis algorithm
 * aligned with log_compressor.py with evidence-preserving grouping and temporal context,
 * session summary metrics, and timeline aggregation.
 */

import {
  DEFAULT_CONTEXT_LINES,
  DEFAULT_MAX_GROUP,
  DEFAULT_WINDOW_SEC,
} from './constants.js';

import {
  parseTime,
  cleanLine,
  isNoise,
  matchEvent,
  splitLines,
  formatTime,
  timeDeltaSeconds,
  originalSeverity, normalizeMessage, eventType, isStackFrame,
} from './parser.js';

/**
 * Analyzes Unity log lines according to configured window and context rules.
 * 
 * @param {string[]|string} inputLines - Raw text or array of string lines
 * @param {object} [options]
 * @param {number} [options.contextLines=3] - Raw lines of context before/after each event
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

  // Parse event boundaries before collecting evidence. Stack frames never become events.
  for (const item of parsed) {
    item.frame = isStackFrame(item.raw);
    item.match = !item.frame && !isNoise(item.raw) ? matchEvent(item.raw) : null;
  }
  const rawEvents = [];
  const sceneEvents = [];
  let scene = '(unknown scene)';
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item.match) continue;
    const { severity, category, label } = item.match;
    if (category === 'SceneLoad') {
      scene = item.clean.replace(/^.*?Loaded Scene:\s*/i, '').trim();
      sceneEvents.push({ time: formatTime(item.time), sceneName: scene,
        totalSeconds: item.time?.totalSeconds ?? null });
    }
    const sourceSeverity = originalSeverity(item.raw) || 'UNKNOWN';
    const type = eventType(item.raw, item.match);
    const normalizedMessage = normalizeMessage(item.raw);
    const groupKey = JSON.stringify([scene, category, normalizedMessage, sourceSeverity, type, severity]);
    rawEvents.push({ index: i, time: item.time, severity, category, label,
      clean: item.clean, raw: item.raw, scene, originalSeverity: sourceSeverity,
      eventType: type, normalizedMessage, groupKey });
  }

  const groups = {};
  const lastByKey = new Map();
  for (const ev of rawEvents) {
    const { index, time, severity, category, groupKey } = ev;
    if (!groups[groupKey]) groups[groupKey] = {
      category, severity, label: ev.normalizedMessage, scene: ev.scene,
      originalSeverity: ev.originalSeverity, eventType: ev.eventType,
      normalizedMessage: ev.normalizedMessage, occurrences: [], times: [], count: 0,
      representativeStack: [], detailedCount: 0,
    };
    const group = groups[groupKey];
    const previous = lastByKey.get(groupKey);
    const deduped = Boolean(time && previous && timeDeltaSeconds(time, previous) <= windowSec
      && category !== 'SceneLoad' && category !== 'SceneReload');
    // Keep one complete stack even if the first useful stack belongs to a rapid repeat.
    const stack = [];
    let end = index + 1;
    while (end < parsed.length && (parsed[end].frame || !parsed[end].raw.trim())) {
      if (parsed[end].frame) stack.push(parsed[end].raw);
      end++;
    }
    if (!group.representativeStack.length && stack.length) group.representativeStack = stack;
    const context = [];
    const contextAfter = [];
    const keepDetails = !deduped && group.detailedCount < maxGroup;
    if (keepDetails) {
      group.detailedCount++;
      for (let c = Math.max(0, index - contextLines); c < index; c++) {
        const p = parsed[c];
        if (p.clean && !p.frame && !isNoise(p.raw)) context.push(p.clean);
      }
      for (let c = end; c < Math.min(parsed.length, end + contextLines); c++) {
        const p = parsed[c];
        if (p.clean && !p.frame && !isNoise(p.raw)) contextAfter.push(p.clean);
      }
    }
    group.occurrences.push({ time: formatTime(time), index, deduped, detailed: keepDetails,
      context, contextAfter, ...(keepDetails ? { clean: ev.clean, raw: ev.raw } : {}) });
    group.times.push(time);
    group.count++;
    lastByKey.set(groupKey, time);
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
    const key = `${ev.groupKey}_${hhmm}`;

    if (!seenCatsInWindow.has(key) || ev.category === 'SceneLoad') {
      timeline.push({
        time: formatTime(ev.time),
        severity: ev.severity,
        label: ev.label,
        category: ev.category,
        scene: ev.scene, originalSeverity: ev.originalSeverity, eventType: ev.eventType,
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
