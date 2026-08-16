/**
 * @file splitter.js
 * Implementation of time-window event slicing based on log_splitter.py.
 * Extracts time windows around critical events for pinpoint debugging.
 */

import {
  DEFAULT_SPLIT_WINDOW_BEFORE,
  DEFAULT_SPLIT_WINDOW_AFTER,
} from './constants.js';

import {
  parseTime,
  cleanLine,
  splitLines,
  formatTime,
  timeDeltaSeconds,
} from './parser.js';

const SPLIT_CRITICAL_PATTERNS = [
  { pattern: /\[ERROR\]/i, label: 'error' },
  { pattern: /NullReferenceException/i, label: 'nullref' },
  { pattern: /Object reference not set/i, label: 'nullref' },
  { pattern: /\[WARNING\].*NULL target/i, label: 'nullref' },
  { pattern: /\[WARNING\].*missing[./\\]?null/i, label: 'nullref' },
  { pattern: /\[WARNING\].*Tween startup failed/i, label: 'nullref' },
  { pattern: /\[WARNING\].*error inside a tween/i, label: 'nullref' },
  { pattern: /\[SceneLoader\] Loaded Scene:/i, label: 'scene_load' },
  { pattern: /Trying to load the same scene/i, label: 'scene_reload' },
  { pattern: /"SetDestination".*NavMesh/i, label: 'navmesh_error' },
  { pattern: /Failed to create agent/i, label: 'navmesh_error' },
  { pattern: /Cannot throw a kinematic/i, label: 'physics_error' },
];

/**
 * Gets event label and clean description for split analysis.
 * 
 * @param {string} line 
 * @returns {{ label: string, desc: string } | null}
 */
export function getSplitEventLabel(line) {
  if (!line) return null;
  for (const item of SPLIT_CRITICAL_PATTERNS) {
    if (item.pattern.test(line)) {
      const clean = cleanLine(line);
      let desc = clean.replace(/[^\w\s\-]/g, '').slice(0, 50).trim();
      desc = desc.replace(/\s+/g, '_');
      return { label: item.label, desc };
    }
  }
  return null;
}

/**
 * Splits a log into time-windowed event slices.
 * 
 * @param {string[]|string} inputLines 
 * @param {object} [options]
 * @param {number} [options.windowBefore=30] - Seconds before event
 * @param {number} [options.windowAfter=30] - Seconds after event
 * @param {string} [options.filename='log.txt'] - Source filename for headers
 * @returns {object} Split result
 */
export function splitLogEvents(inputLines, options = {}) {
  const windowBefore = options.windowBefore ?? DEFAULT_SPLIT_WINDOW_BEFORE;
  const windowAfter = options.windowAfter ?? DEFAULT_SPLIT_WINDOW_AFTER;
  const sourceName = options.filename ?? 'original_log.txt';

  const rawLines = Array.isArray(inputLines) ? inputLines : splitLines(inputLines);

  // Index lines with their timestamp
  const indexed = [];
  let currentTs = null;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const m = parseTime(line);
    if (m) {
      currentTs = m;
    }
    indexed.push({ ts: currentTs, line, index: i });
  }

  // Detect critical events
  const detectedEvents = [];
  for (let i = 0; i < indexed.length; i++) {
    const { ts, line } = indexed[i];
    const result = getSplitEventLabel(line);
    if (result && ts !== null) {
      detectedEvents.push({
        lineIndex: i,
        ts,
        label: result.label,
        desc: result.desc,
        rawLine: line.trim(),
      });
    }
  }

  // Deduplicate: same label within 5s -> keep only first
  const dedupedEvents = [];
  for (const ev of detectedEvents) {
    if (dedupedEvents.length > 0) {
      const last = dedupedEvents[dedupedEvents.length - 1];
      if (last.label === ev.label && timeDeltaSeconds(ev.ts, last.ts) < 5) {
        continue;
      }
    }
    dedupedEvents.push(ev);
  }

  const summaryLines = [
    '='.repeat(60),
    '  LOG SPLIT SUMMARY',
    `  Source : ${sourceName}`,
    `  Window : -${windowBefore}s before / +${windowAfter}s after each event`,
    `  Events : ${dedupedEvents.length} found`,
    '='.repeat(60),
    '',
  ];

  if (dedupedEvents.length === 0) {
    summaryLines.push('  No critical events found.');
    return {
      events: [],
      summaryText: summaryLines.join('\n'),
      sourceName,
    };
  }

  const eventSlices = [];

  for (let idx = 0; idx < dedupedEvents.length; idx++) {
    const { lineIndex, ts, label, desc, rawLine } = dedupedEvents[idx];
    const tsStr = formatTime(ts);

    // Compute window boundaries in seconds
    const startSec = ts.totalSeconds - windowBefore;
    const endSec = ts.totalSeconds + windowAfter;

    const windowLines = [];
    for (const item of indexed) {
      if (item.ts !== null && item.ts.totalSeconds >= startSec && item.ts.totalSeconds <= endSec) {
        windowLines.push(item.line);
      }
    }

    const pad2 = (n) => String(n).padStart(2, '0');
    const startH = Math.max(0, Math.floor((startSec % 86400) / 3600));
    const startM = Math.max(0, Math.floor((startSec % 3600) / 60));
    const startS = Math.max(0, Math.floor(startSec % 60));
    const endH = Math.min(23, Math.floor((endSec % 86400) / 3600));
    const endM = Math.min(59, Math.floor((endSec % 3600) / 60));
    const endS = Math.min(59, Math.floor(endSec % 60));

    const tStartStr = `${pad2(startH)}:${pad2(startM)}:${pad2(startS)}`;
    const tEndStr = `${pad2(endH)}:${pad2(endM)}:${pad2(endS)}`;
    const tsTag = `${pad2(ts.hours)}h${pad2(ts.minutes)}m${pad2(ts.seconds)}s`;
    const fname = `event_${pad2(idx + 1)}_${label}_${tsTag}.txt`;

    const cleanTrigger = cleanLine(rawLine);

    const header = [
      '='.repeat(60),
      `  EVENT #${pad2(idx + 1)} — ${label.toUpperCase()}`,
      `  Time   : ${tsStr}`,
      `  Window : ${tStartStr} → ${tEndStr}`,
      `  Trigger: ${cleanTrigger}`,
      '='.repeat(60),
      '',
    ].join('\n');

    const sliceContent = `${header}\n${windowLines.join('\n')}`;

    eventSlices.push({
      id: idx + 1,
      lineIndex,
      label,
      desc,
      ts,
      timeStr: tsStr,
      timeTag: tsTag,
      tStartStr,
      tEndStr,
      trigger: cleanTrigger,
      rawLine,
      filename: fname,
      content: sliceContent,
      linesCount: windowLines.length,
    });

    summaryLines.push(`  [${pad2(idx + 1)}] ${tsStr}  [${label}]`);
    summaryLines.push(`       ${cleanTrigger.slice(0, 80)}`);
    summaryLines.push(`       → ${fname}`);
    summaryLines.push('');
  }

  return {
    events: eventSlices,
    summaryText: summaryLines.join('\n'),
    sourceName,
  };
}
