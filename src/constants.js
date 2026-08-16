/**
 * @file constants.js
 * Core configuration, severity levels, regex patterns, and noise filters
 * derived from log_compressor.py and log_splitter.py.
 */

export const DEFAULT_CONTEXT_LINES = 3;
export const DEFAULT_MAX_GROUP = 5;
export const DEFAULT_WINDOW_SEC = 10;
export const DEFAULT_SPLIT_WINDOW_BEFORE = 30;
export const DEFAULT_SPLIT_WINDOW_AFTER = 30;

export const SEVERITY_LEVELS = {
  EXCEPTION: 4,
  ERROR: 3,
  WARNING: 2,
  LOG: 1,
};

export const SEVERITY_ICONS = {
  EXCEPTION: '🔴',
  ERROR: '🟠',
  WARNING: '🟡',
  LOG: '⚪',
};

export const SEVERITY_CLASSES = {
  EXCEPTION: 'sev-exception',
  ERROR: 'sev-error',
  WARNING: 'sev-warning',
  LOG: 'sev-log',
};

/**
 * Event patterns matching log_compressor.py:
 * [regexPattern, severity, category, label]
 */
export const EVENT_PATTERNS = [
  { pattern: /NullReferenceException/i, severity: 'EXCEPTION', category: 'NullRef', label: 'NullReferenceException' },
  { pattern: /MissingReferenceException/i, severity: 'EXCEPTION', category: 'MissingRef', label: 'MissingReferenceException' },
  { pattern: /IndexOutOfRangeException/i, severity: 'EXCEPTION', category: 'IndexOORange', label: 'IndexOutOfRangeException' },
  { pattern: /StackOverflowException/i, severity: 'EXCEPTION', category: 'StackOverflow', label: 'StackOverflowException' },
  { pattern: /OutOfMemoryException/i, severity: 'EXCEPTION', category: 'OOM', label: 'OutOfMemoryException' },
  { pattern: /Object reference not set/i, severity: 'EXCEPTION', category: 'NullRef', label: 'Object reference not set' },
  { pattern: /\[EXCEPTION\]/i, severity: 'EXCEPTION', category: 'Exception', label: '[EXCEPTION]' },
  { pattern: /\[ERROR\]/i, severity: 'ERROR', category: 'Error', label: '[ERROR]' },
  { pattern: /"SetDestination".*NavMesh/i, severity: 'ERROR', category: 'NavMesh', label: 'SetDestination on NavMesh' },
  { pattern: /Failed to create agent/i, severity: 'ERROR', category: 'NavMesh', label: 'Failed to create NavMesh agent' },
  { pattern: /Cannot throw a kinematic/i, severity: 'ERROR', category: 'Physics', label: 'Kinematic rigidbody throw' },
  { pattern: /\[WARNING\].*NULL target/i, severity: 'WARNING', category: 'NullTarget', label: 'NULL target warning' },
  { pattern: /\[WARNING\].*missing[./\\]?null/i, severity: 'WARNING', category: 'MissingNull', label: 'Missing/null warning' },
  { pattern: /\[WARNING\].*Tween startup failed/i, severity: 'WARNING', category: 'Tween', label: 'Tween startup failed' },
  { pattern: /\[WARNING\].*error inside a tween/i, severity: 'WARNING', category: 'Tween', label: 'Error inside tween' },
  { pattern: /\[WARNING\]/i, severity: 'WARNING', category: 'Warning', label: '[WARNING]' },
  { pattern: /\[SceneLoader\] Loaded Scene:/i, severity: 'LOG', category: 'SceneLoad', label: 'Scene loaded' },
  { pattern: /Trying to load the same scene/i, severity: 'WARNING', category: 'SceneReload', label: 'Same scene reload' },
];

/**
 * Noise patterns to strip out (pure stacktrace/utility boilerplate)
 */
export const NOISE_PATTERNS = [
  /^\s*$/,
  /StackTrace:/i,
  /UnityEngine\.Debug/i,
  /UnityEngine\.StackTraceUtility/i,
  /\(at <[0-9a-f]+>\)/i,
  /^\s+at UnityEngine\./i,
  /^\s+at System\./i,
];

export const TIMESTAMP_RE = /^(\d{2}:\d{2}:\d{2})(?:\.(\d+))?/;
export const HTML_TAG_RE = /<[^>]+>/g;
