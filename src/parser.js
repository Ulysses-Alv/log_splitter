/**
 * @file parser.js
 * Parses raw Unity log lines, normalizes timestamps, cleans tags, and detects events/noise.
 */

import {
  EVENT_PATTERNS,
  NOISE_PATTERNS,
  TIMESTAMP_RE,
  HTML_TAG_RE,
} from './constants.js';

/**
 * Parses timestamp string from beginning of line.
 * Matches "HH:MM:SS.mmm" or "HH:MM:SS".
 * Returns a time object { hours, minutes, seconds, millis, totalSeconds, timeStr } or null.
 * 
 * @param {string} line 
 * @returns {{ hours: number, minutes: number, seconds: number, millis: number, totalSeconds: number, timeStr: string } | null}
 */
export function parseTime(line) {
  if (!line || typeof line !== 'string') return null;
  const match = TIMESTAMP_RE.exec(line);
  if (!match) return null;

  const [_, hhmmss, fractional] = match;
  const [hStr, mStr, sStr] = hhmmss.split(':');
  const hours = parseInt(hStr, 10);
  const minutes = parseInt(mStr, 10);
  const seconds = parseInt(sStr, 10);

  if (
    isNaN(hours) || isNaN(minutes) || isNaN(seconds) ||
    hours < 0 || hours > 23 ||
    minutes < 0 || minutes > 59 ||
    seconds < 0 || seconds > 59
  ) {
    return null;
  }

  let millis = 0;
  if (fractional) {
    millis = parseInt(fractional.slice(0, 3).padEnd(3, '0'), 10);
  }

  const totalSeconds = hours * 3600 + minutes * 60 + seconds + millis / 1000;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return {
    hours,
    minutes,
    seconds,
    millis,
    totalSeconds,
    timeStr,
  };
}

/**
 * Strips HTML tags and timestamp prefix from a line, then trims whitespace.
 * 
 * @param {string} line 
 * @returns {string}
 */
export function cleanLine(line) {
  if (!line) return '';
  let cleaned = line.replace(HTML_TAG_RE, '');
  cleaned = cleaned.replace(TIMESTAMP_RE, '');
  return cleaned.trim();
}

/**
 * Checks if a raw line is pure noise (empty, Unity stack trace frames, etc.)
 * 
 * @param {string} line 
 * @returns {boolean}
 */
export function isNoise(line) {
  if (!line || !line.trim()) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Matches a line against configured critical/warning/scene event patterns.
 * Returns { severity, category, label } or null.
 * 
 * @param {string} line 
 * @returns {{ severity: string, category: string, label: string } | null}
 */
export function matchEvent(line) {
  if (!line) return null;
  for (const item of EVENT_PATTERNS) {
    if (item.pattern.test(line)) {
      return {
        severity: item.severity,
        category: item.category,
        label: item.label,
      };
    }
  }
  return null;
}

/**
 * Splits raw log text into an array of lines, handling \r\n, \n, \r.
 * Avoids phantom empty line on trailing newline, matching Python's readlines().
 * 
 * @param {string} rawContent 
 * @returns {string[]}
 */
export function splitLines(rawContent) {
  if (!rawContent) return [];
  // Strip trailing newline to match Python readlines count
  const trimmed = rawContent.replace(/(?:\r\n|\r|\n)$/, '');
  if (!trimmed) return [];
  return trimmed.split(/\r\n|\r|\n/);
}

/**
 * Formats a time object into "HH:MM:SS" or returns default.
 * 
 * @param {{ timeStr?: string } | null} timeObj 
 * @param {string} fallback 
 * @returns {string}
 */
export function formatTime(timeObj, fallback = '??:??:??') {
  return timeObj?.timeStr || fallback;
}

/**
 * Calculates absolute delta in seconds between two time objects, handling potential midnight wrap.
 * 
 * @param {{ totalSeconds: number }} t1 
 * @param {{ totalSeconds: number }} t2 
 * @returns {number}
 */
export function timeDeltaSeconds(t1, t2) {
  if (!t1 || !t2) return Infinity;
  let diff = Math.abs(t1.totalSeconds - t2.totalSeconds);
  // Handle midnight wrap (e.g. 23:59:59 to 00:00:01)
  if (diff > 43200) {
    diff = 86400 - diff;
  }
  return diff;
}
