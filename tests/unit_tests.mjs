/**
 * @file unit_tests.mjs
 * Comprehensive unit test suite for Unity Log Analyzer.
 * Uses native Node.js test runner (node --test).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseTime,
  cleanLine,
  isNoise,
  matchEvent,
  splitLines,
  formatTime,
  timeDeltaSeconds,
} from '../src/parser.js';

import { analyzeLog } from '../src/analyzer.js';
import { splitLogEvents, getSplitEventLabel } from '../src/splitter.js';
import { renderMarkdown } from '../src/markdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf-8');
}

// ─── 1. Parser Unit Tests ───────────────────────────────────────────────────

test('Parser: parseTime parses valid timestamps correctly', () => {
  const t1 = parseTime('14:02:10.123 [SceneLoader] Loaded Scene: MainMenu');
  assert.notEqual(t1, null);
  assert.equal(t1.hours, 14);
  assert.equal(t1.minutes, 2);
  assert.equal(t1.seconds, 10);
  assert.equal(t1.millis, 123);
  assert.equal(t1.timeStr, '14:02:10');

  const t2 = parseTime('09:15:30 Some log message without millis');
  assert.notEqual(t2, null);
  assert.equal(t2.hours, 9);
  assert.equal(t2.minutes, 15);
  assert.equal(t2.seconds, 30);
  assert.equal(t2.millis, 0);
  assert.equal(t2.timeStr, '09:15:30');
});

test('Parser: parseTime returns null for invalid lines', () => {
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('No timestamp here'), null);
  assert.equal(parseTime('99:99:99.999 Invalid hours'), null);
  assert.equal(parseTime(null), null);
});

test('Parser: cleanLine removes HTML tags and timestamp prefix', () => {
  const line = '14:02:18.512 [WARNING] <color=yellow>[DOTween]</color> <b>NULL target</b>';
  const cleaned = cleanLine(line);
  assert.equal(cleaned, '[WARNING] [DOTween] NULL target');
});

test('Parser: isNoise identifies stack traces and empty lines', () => {
  assert.equal(isNoise(''), true);
  assert.equal(isNoise('   '), true);
  assert.equal(isNoise('  StackTrace:'), true);
  assert.equal(isNoise('UnityEngine.Debug:Log(Object)'), true);
  assert.equal(isNoise('UnityEngine.StackTraceUtility:ExtractStackTrace ()'), true);
  assert.equal(isNoise('  at UnityEngine.GameObject.SendMessage () (at <12345>:0)'), true);
  assert.equal(isNoise('  at System.Action.Invoke ()'), true);
  assert.equal(isNoise('14:02:10.123 [Player] Player spawned'), false);
});

test('Parser: matchEvent detects critical patterns and severities', () => {
  const nullRef = matchEvent('NullReferenceException: Object reference not set');
  assert.deepEqual(nullRef, {
    severity: 'EXCEPTION',
    category: 'NullRef',
    label: 'NullReferenceException',
  });

  const navMesh = matchEvent('"SetDestination" can only be called on NavMesh');
  assert.deepEqual(navMesh, {
    severity: 'ERROR',
    category: 'NavMesh',
    label: 'SetDestination on NavMesh',
  });

  const physics = matchEvent('Cannot throw a kinematic rigidbody');
  assert.deepEqual(physics, {
    severity: 'ERROR',
    category: 'Physics',
    label: 'Kinematic rigidbody throw',
  });

  const tweenWarn = matchEvent('[WARNING] Tween startup failed: missing target');
  assert.deepEqual(tweenWarn, {
    severity: 'WARNING',
    category: 'Tween',
    label: 'Tween startup failed',
  });

  const scene = matchEvent('[SceneLoader] Loaded Scene: Level01');
  assert.deepEqual(scene, {
    severity: 'LOG',
    category: 'SceneLoad',
    label: 'Scene loaded',
  });

  assert.equal(matchEvent('Normal info log message'), null);
});

test('Parser: timeDeltaSeconds handles normal and midnight differences', () => {
  const t1 = parseTime('12:00:00.000');
  const t2 = parseTime('12:00:08.500');
  assert.equal(timeDeltaSeconds(t1, t2), 8.5);

  const midnightBefore = parseTime('23:59:58.000');
  const midnightAfter = parseTime('00:00:03.000');
  assert.equal(timeDeltaSeconds(midnightBefore, midnightAfter), 5);
});

// ─── 2. Analyzer Unit Tests ─────────────────────────────────────────────────

test('Analyzer: processes valid_session fixture with accurate metrics', () => {
  const text = readFixture('valid_session.txt');
  const res = analyzeLog(text, { contextLines: 3, maxGroup: 5, windowSec: 10 });

  assert.equal(res.session.start, '14:02:10');
  assert.equal(res.session.end, '14:02:40'); // Last event time
  assert.equal(res.session.scenes, 3);
  assert.equal(res.sceneEvents.length, 3);
  assert.equal(res.sceneEvents[0].sceneName, 'MainMenu');
  assert.equal(res.sceneEvents[1].sceneName, 'Level01_Forest');
  assert.equal(res.sceneEvents[2].sceneName, 'Level01_BossArena');

  assert.equal(res.session.exceptions, 2); // 2 NullReferenceExceptions
  assert.equal(res.session.errors, 3); // 2 NavMesh + 1 Physics
  assert.equal(res.session.warnings, 2); // 2 Warnings (Null target, Tween startup)
  assert.equal(res.session.logs, 3); // 3 SceneLoads

  // Check causal context for NullReferenceException
  const nullRefGroup = res.groups.NullRef;
  assert.notEqual(nullRefGroup, undefined);
  assert.equal(nullRefGroup.severity, 'EXCEPTION');
  assert.equal(nullRefGroup.count, 2);
  // Causal context should contain preceding lines
  const firstOcc = nullRefGroup.occurrences[0];
  assert.equal(firstOcc.time, '14:02:26');
  assert.ok(firstOcc.context.length > 0);
  assert.ok(firstOcc.context.some((c) => c.includes('Executing ultimate ability')));
});

test('Analyzer: handles empty log fixture gracefully', () => {
  const text = readFixture('empty.txt');
  const res = analyzeLog(text);

  assert.equal(res.session.start, 'N/A');
  assert.equal(res.session.end, 'N/A');
  assert.equal(res.session.total_lines, 0);
  assert.equal(res.session.exceptions, 0);
  assert.equal(res.session.errors, 0);
  assert.equal(res.session.warnings, 0);
  assert.equal(res.session.scenes, 0);
  assert.deepEqual(res.groups, {});
  assert.deepEqual(res.timeline, []);
});

test('Analyzer: handles clean session fixture with zero errors', () => {
  const text = readFixture('clean_session.txt');
  const res = analyzeLog(text);

  assert.equal(res.session.exceptions, 0);
  assert.equal(res.session.errors, 0);
  assert.equal(res.session.warnings, 0);
  assert.equal(res.session.scenes, 4);
  assert.equal(res.timeline.length, 4); // 4 scene loads in timeline
});

test('Analyzer: clusters rapid repeating errors within window (rapid_bursts fixture)', () => {
  const text = readFixture('rapid_bursts.txt');
  const res = analyzeLog(text, { windowSec: 10 });

  const nullRefGroup = res.groups.NullRef;
  assert.notEqual(nullRefGroup, undefined);
  // Total occurrences counted = 6 in first burst + 2 in second burst = 8 total
  assert.equal(nullRefGroup.count, 8);
  // But only 2 distinct non-deduplicated occurrences with full context
  const distinctOcc = nullRefGroup.occurrences.filter((o) => !o.deduped);
  assert.equal(distinctOcc.length, 2);
});

test('Analyzer: handles malformed log without crashing', () => {
  const text = readFixture('malformed.txt');
  const res = analyzeLog(text);

  assert.equal(res.session.exceptions, 1);
  assert.equal(res.session.warnings, 1);
  assert.equal(res.session.scenes, 1);
  assert.equal(res.sceneEvents[0].sceneName, 'CorruptScene');
});

test('Analyzer: processes large session fixture efficiently', () => {
  const text = readFixture('large_session.txt');
  const startMs = Date.now();
  const res = analyzeLog(text);
  const elapsedMs = Date.now() - startMs;

  assert.equal(res.session.total_lines, 5001);
  assert.equal(res.session.scenes, 2);
  assert.equal(res.session.exceptions, 2);
  assert.equal(res.session.errors, 1);
  assert.equal(res.session.warnings, 1);
  assert.ok(elapsedMs < 500, `Large file processed in ${elapsedMs}ms (< 500ms)`);
});

// ─── 3. Splitter Unit Tests ─────────────────────────────────────────────────

test('Splitter: extracts event time windows and generates summary', () => {
  const text = readFixture('valid_session.txt');
  const split = splitLogEvents(text, { windowBefore: 30, windowAfter: 30, filename: 'valid_session.txt' });

  assert.ok(split.events.length > 0);
  assert.ok(split.summaryText.includes('LOG SPLIT SUMMARY'));
  assert.ok(split.summaryText.includes('valid_session.txt'));

  // Slices should contain headers with time and trigger
  const firstSlice = split.events[0];
  assert.ok(firstSlice.content.includes('EVENT #01'));
  assert.ok(firstSlice.content.includes('Time   :'));
  assert.ok(firstSlice.content.includes('Window :'));
  assert.ok(firstSlice.content.includes('Trigger:'));
});

test('Splitter: deduplicates within 5s window on clean session', () => {
  const text = readFixture('clean_session.txt');
  const split = splitLogEvents(text);
  assert.equal(split.events.length, 3); // 4 scene loads, but 08:00:00 and 08:00:03 are within 5s deduplication
});

// ─── 4. Markdown Generator Unit Tests ───────────────────────────────────────

test('Markdown: renders full AI-optimized markdown report matching spec', () => {
  const text = readFixture('valid_session.txt');
  const analysis = analyzeLog(text);
  const md = renderMarkdown(
    'valid_session.txt',
    analysis.session,
    analysis.sceneEvents,
    analysis.groups,
    analysis.timeline,
    5
  );

  assert.ok(md.includes('# Unity Log Analysis — `valid_session.txt`'));
  assert.ok(md.includes('## Session Overview'));
  assert.ok(md.includes('| **Time range** | `14:02:10` → `14:02:40` |'));
  assert.ok(md.includes('## Scene Timeline'));
  assert.ok(md.includes('## Critical Events (Grouped)'));
  assert.ok(md.includes('## Event Timeline'));
  assert.ok(md.includes('## Suggested Prompt'));
});
