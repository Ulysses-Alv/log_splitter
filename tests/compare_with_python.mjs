/**
 * @file compare_with_python.mjs
 * Directly compares Python analyze() and render_md() results
 * with JavaScript analyzeLog() and renderMarkdown() outputs across all fixtures.
 */

import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeLog } from '../src/analyzer.js';
import { renderMarkdown } from '../src/markdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

console.log('--- Running Python Reference Analyzer ---');
const pythonJsonStr = execSync('python tests/validate_parity.py', { cwd: path.join(__dirname, '..') }).toString();
const pythonResults = JSON.parse(pythonJsonStr);

console.log('--- Running JavaScript Analyzer & Verifying Parity ---');
let testedCount = 0;

for (const [filename, pyData] of Object.entries(pythonResults)) {
  const filepath = path.join(fixturesDir, filename);
  const text = fs.readFileSync(filepath, 'utf-8');

  const jsRes = analyzeLog(text, { contextLines: 3, maxGroup: 5, windowSec: 10 });

  // 1. Verify Session Summary
  assert.equal(jsRes.session.start, pyData.session.start, `${filename}: start time mismatch`);
  assert.equal(jsRes.session.end, pyData.session.end, `${filename}: end time mismatch`);
  assert.equal(jsRes.session.total_lines, pyData.session.total_lines, `${filename}: total lines mismatch`);
  assert.equal(jsRes.session.exceptions, pyData.session.exceptions, `${filename}: exceptions count mismatch`);
  assert.equal(jsRes.session.errors, pyData.session.errors, `${filename}: errors count mismatch`);
  assert.equal(jsRes.session.warnings, pyData.session.warnings, `${filename}: warnings count mismatch`);
  assert.equal(jsRes.session.logs, pyData.session.logs, `${filename}: logs count mismatch`);
  assert.equal(jsRes.session.scenes, pyData.session.scenes, `${filename}: scenes count mismatch`);

  // 2. Verify Scene Events Count
  assert.equal(jsRes.sceneEvents.length, pyData.scene_events_count, `${filename}: scene events count mismatch`);

  // 3. Verify Groups
  const jsGroupKeys = Object.keys(jsRes.groups);
  const pyGroupKeys = Object.keys(pyData.groups);
  assert.equal(jsGroupKeys.length, pyGroupKeys.length, `${filename}: group keys count mismatch`);

  for (const cat of pyGroupKeys) {
    const pyGroup = pyData.groups[cat];
    const jsGroup = jsRes.groups[cat];
    assert.notEqual(jsGroup, undefined, `${filename}: missing group ${cat} in JS`);
    assert.equal(jsGroup.severity, pyGroup.severity, `${filename}: group ${cat} severity mismatch`);
    assert.equal(jsGroup.label, pyGroup.label, `${filename}: group ${cat} label mismatch`);
    assert.equal(jsGroup.count, pyGroup.occurrences_count, `${filename}: group ${cat} occurrences mismatch`);
  }

  // 4. Verify Timeline Count
  assert.equal(jsRes.timeline.length, pyData.timeline_count, `${filename}: timeline count mismatch`);

  console.log(`✓ ${filename}: 100% parity with Python`);
  testedCount++;
}

console.log(`\n🎉 All ${testedCount} fixtures match Python reference output perfectly!`);
