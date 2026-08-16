/**
 * @file worker.js
 * Dedicated Web Worker for analyzing large Unity log files off the main UI thread.
 */

import { analyzeLog } from './analyzer.js';
import { splitLogEvents } from './splitter.js';
import { renderMarkdown } from './markdown.js';

self.onmessage = function (e) {
  const { type, payload } = e.data;

  if (type === 'ANALYZE_ALL') {
    try {
      const { text, filename, options } = payload;

      self.postMessage({ type: 'PROGRESS', payload: { percent: 20, stage: 'Parsing lines and timestamps...' } });

      const analysis = analyzeLog(text, options);

      self.postMessage({ type: 'PROGRESS', payload: { percent: 60, stage: 'Extracting causal context and timeline...' } });

      const markdown = renderMarkdown(
        filename || 'log.txt',
        analysis.session,
        analysis.sceneEvents,
        analysis.groups,
        analysis.timeline,
        options?.maxGroup ?? 5
      );

      self.postMessage({ type: 'PROGRESS', payload: { percent: 80, stage: 'Slicing event time-windows...' } });

      const splitResult = splitLogEvents(text, {
        windowBefore: options?.splitWindowBefore ?? 30,
        windowAfter: options?.splitWindowAfter ?? 30,
        filename: filename || 'log.txt',
      });

      self.postMessage({ type: 'PROGRESS', payload: { percent: 100, stage: 'Analysis complete.' } });

      self.postMessage({
        type: 'RESULT',
        payload: {
          analysis,
          markdown,
          splitResult,
        },
      });
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        payload: {
          message: err?.message || String(err),
          stack: err?.stack,
        },
      });
    }
  }
};
