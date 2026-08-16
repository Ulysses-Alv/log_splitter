"""
log_compressor.py
Compresses Unity log files into token-efficient Markdown, optimized for AI analysis.

Place log_compressor.py next to your log files:
    root/log_compressor.py
    root/logreport_session01.txt

Run:
    python log_compressor.py

Generates one folder per log file:
    root/logreport_session01/
        original.txt
        analysis.md          ← paste this into Claude / any AI

Optional:
    python log_compressor.py --context 5      # lines of causal context before each error (default: 3)
    python log_compressor.py --max-group 10   # max lines shown per grouped warning (default: 5)
    python log_compressor.py --window 30      # seconds for timeline clustering (default: 10)
"""

import re
import os
import sys
import shutil
from collections import defaultdict, Counter
from datetime import datetime, timedelta
from pathlib import Path


# ─── Config ───────────────────────────────────────────────────────────────────

DEFAULT_CONTEXT_LINES = 3   # causal lines shown before each error
DEFAULT_MAX_GROUP     = 5   # max representative lines per warning group
DEFAULT_WINDOW_SEC    = 10  # seconds to cluster rapid repeated events

# Severity levels (higher = more critical)
SEVERITY = {
    'EXCEPTION': 4,
    'ERROR':     3,
    'WARNING':   2,
    'LOG':       1,
}

# Patterns → (severity, category, short_label)
EVENT_PATTERNS = [
    (r'NullReferenceException',              'EXCEPTION', 'NullRef',        'NullReferenceException'),
    (r'MissingReferenceException',           'EXCEPTION', 'MissingRef',     'MissingReferenceException'),
    (r'IndexOutOfRangeException',            'EXCEPTION', 'IndexOORange',   'IndexOutOfRangeException'),
    (r'StackOverflowException',              'EXCEPTION', 'StackOverflow',  'StackOverflowException'),
    (r'OutOfMemoryException',                'EXCEPTION', 'OOM',            'OutOfMemoryException'),
    (r'Object reference not set',            'EXCEPTION', 'NullRef',        'Object reference not set'),
    (r'\[EXCEPTION\]',                       'EXCEPTION', 'Exception',      '[EXCEPTION]'),
    (r'\[ERROR\]',                           'ERROR',     'Error',          '[ERROR]'),
    (r'"SetDestination".*NavMesh',           'ERROR',     'NavMesh',        'SetDestination on NavMesh'),
    (r'Failed to create agent',              'ERROR',     'NavMesh',        'Failed to create NavMesh agent'),
    (r'Cannot throw a kinematic',            'ERROR',     'Physics',        'Kinematic rigidbody throw'),
    (r'\[WARNING\].*NULL target',            'WARNING',   'NullTarget',     'NULL target warning'),
    (r'\[WARNING\].*missing.?null',          'WARNING',   'MissingNull',    'Missing/null warning'),
    (r'\[WARNING\].*Tween startup failed',   'WARNING',   'Tween',          'Tween startup failed'),
    (r'\[WARNING\].*error inside a tween',   'WARNING',   'Tween',          'Error inside tween'),
    (r'\[WARNING\]',                         'WARNING',   'Warning',        '[WARNING]'),
    (r'\[SceneLoader\] Loaded Scene:',       'LOG',       'SceneLoad',      'Scene loaded'),
    (r'Trying to load the same scene',       'WARNING',   'SceneReload',    'Same scene reload'),
]

# Lines to strip entirely (pure noise)
NOISE_PATTERNS = [
    r'^\s*$',
    r'StackTrace:',
    r'UnityEngine\.Debug',
    r'UnityEngine\.StackTraceUtility',
    r'\(at <[0-9a-f]+>\)',
    r'^\s+at UnityEngine\.',
    r'^\s+at System\.',
]

TIMESTAMP_RE  = re.compile(r'^(\d{2}:\d{2}:\d{2})\.\d+')
HTML_TAG_RE   = re.compile(r'<[^>]+>')
NOISE_RE      = re.compile('|'.join(NOISE_PATTERNS))


# ─── Helpers ──────────────────────────────────────────────────────────────────

def parse_time(line):
    m = TIMESTAMP_RE.match(line)
    if m:
        try:
            return datetime.strptime(m.group(1), "%H:%M:%S")
        except ValueError:
            pass
    return None

def clean_line(line):
    """Remove HTML tags, timestamps, and leading whitespace."""
    line = HTML_TAG_RE.sub('', line)
    line = TIMESTAMP_RE.sub('', line).strip()
    return line

def is_noise(line):
    return bool(NOISE_RE.search(line))

def match_event(line):
    """Return (severity, category, label) for the first matching pattern, or None."""
    for pattern, severity, category, label in EVENT_PATTERNS:
        if re.search(pattern, line, re.IGNORECASE):
            return severity, category, label
    return None

def format_time(dt):
    return dt.strftime("%H:%M:%S") if dt else "??:??:??"

def plural(n, word):
    return f"{n} {word}{'s' if n != 1 else ''}"


# ─── Core analysis ────────────────────────────────────────────────────────────

def analyze(lines, context_lines, max_group, window_sec):
    """
    Returns:
        session      : dict with start/end time, total counts
        scene_events : list of (time_str, scene_name)
        grouped      : dict category → {severity, label, occurrences: [(time, context_lines)]}
        timeline     : list of (time_str, severity, label, first_line_clean)
    """

    # --- Pass 1: parse everything ---
    parsed = []  # (time|None, raw_line, clean_line)
    current_time = None
    for raw in lines:
        t = parse_time(raw)
        if t:
            current_time = t
        parsed.append((current_time, raw.rstrip(), clean_line(raw)))

    # --- Pass 2: collect events ---
    raw_events   = []  # (index, time, severity, category, label, clean_line)
    scene_events = []

    for i, (t, raw, clean) in enumerate(parsed):
        if is_noise(raw):
            continue
        result = match_event(raw)
        if result:
            sev, cat, label = result
            raw_events.append((i, t, sev, cat, label, clean))
            if cat == 'SceneLoad' and t:
                scene_name = re.sub(r'.*Loaded Scene:\s*', '', clean).strip()
                scene_events.append((format_time(t), scene_name))

    # --- Pass 3: group repeated events, deduplicate within window ---
    groups = defaultdict(lambda: {
        'severity': '',
        'label': '',
        'occurrences': [],
        'times': [],
    })

    last_by_cat = {}  # category → last time seen

    for i, t, sev, cat, label, clean in raw_events:
        # Deduplicate: same category within window_sec → skip
        if cat in last_by_cat and t is not None and last_by_cat[cat] is not None:
            delta = abs((t - last_by_cat[cat]).total_seconds())
            if delta <= window_sec and cat not in ('SceneLoad', 'SceneReload'):
                groups[cat]['occurrences'].append(('', []))  # count but no context
                groups[cat]['times'].append(t)
                last_by_cat[cat] = t
                continue

        # Grab causal context (lines before this event)
        ctx_start = max(0, i - context_lines)
        ctx = [
            p[2] for p in parsed[ctx_start:i]
            if p[2] and not is_noise(p[1]) and not match_event(p[1])
        ]

        groups[cat]['severity'] = sev if SEVERITY.get(sev, 0) > SEVERITY.get(groups[cat]['severity'], 0) else groups[cat]['severity']
        groups[cat]['label']    = label
        groups[cat]['occurrences'].append((format_time(t), ctx))
        groups[cat]['times'].append(t)
        last_by_cat[cat] = t

    # --- Pass 4: session summary ---
    times_all = [t for _, t, *_ in raw_events if t]
    counts = Counter(sev for _, _, sev, *_ in raw_events)

    session = {
        'start':      format_time(times_all[0])  if times_all else 'N/A',
        'end':        format_time(times_all[-1]) if times_all else 'N/A',
        'total_lines': len(lines),
        'exceptions': counts.get('EXCEPTION', 0),
        'errors':     counts.get('ERROR', 0),
        'warnings':   counts.get('WARNING', 0),
        'logs':       counts.get('LOG', 0),
        'scenes':     len(scene_events),
    }

    # --- Pass 5: timeline (one entry per scene load + first of each error burst) ---
    timeline = []
    seen_cats_in_window = set()
    window_start = times_all[0] if times_all else None

    for i, t, sev, cat, label, clean in raw_events:
        if sev == 'LOG' and cat != 'SceneLoad':
            continue
        if t and window_start and (t - window_start).total_seconds() > window_sec:
            seen_cats_in_window.clear()
            window_start = t
        key = (cat, t.strftime("%H:%M") if t else '')
        if key not in seen_cats_in_window or cat == 'SceneLoad':
            timeline.append((format_time(t), sev, label, clean[:100]))
            seen_cats_in_window.add(key)

    return session, scene_events, dict(groups), timeline


# ─── Markdown renderer ────────────────────────────────────────────────────────

def render_md(filename, session, scene_events, groups, timeline, max_group):
    sev_icon = {'EXCEPTION': '🔴', 'ERROR': '🟠', 'WARNING': '🟡', 'LOG': '⚪'}
    lines = []
    W = lines.append

    W(f"# Unity Log Analysis — `{filename}`")
    W("")
    W("<!-- Generated by log_compressor.py — optimized for AI context -->")
    W("")

    # ── Session overview ──
    W("## Session Overview")
    W("")
    W(f"| | |")
    W(f"|---|---|")
    W(f"| **Time range** | `{session['start']}` → `{session['end']}` |")
    W(f"| **Total lines** | {session['total_lines']:,} |")
    W(f"| **Scenes loaded** | {session['scenes']} |")
    W(f"| 🔴 Exceptions | {session['exceptions']} |")
    W(f"| 🟠 Errors | {session['errors']} |")
    W(f"| 🟡 Warnings | {session['warnings']} |")
    W(f"| ⚪ Log events | {session['logs']} |")
    W("")

    # ── Scenes ──
    if scene_events:
        W("## Scene Timeline")
        W("")
        for ts, name in scene_events:
            W(f"- `{ts}` → **{name}**")
        W("")

    # ── Critical events (grouped) ──
    W("## Critical Events (Grouped)")
    W("")
    W("> Each group shows: total occurrences, representative context, and first/last timestamp.")
    W("")

    sorted_groups = sorted(
        groups.items(),
        key=lambda kv: (-SEVERITY.get(kv[1]['severity'], 0), -len(kv[1]['occurrences']))
    )

    for cat, info in sorted_groups:
        sev   = info['severity']
        label = info['label']
        occ   = info['occurrences']
        icon  = sev_icon.get(sev, '⚪')
        count = len(occ)

        # Times for first/last
        times_with_data = [(ts, ctx) for ts, ctx in occ if ts]
        first_ts = times_with_data[0][0]  if times_with_data else 'N/A'
        last_ts  = times_with_data[-1][0] if times_with_data else 'N/A'
        time_range = f"`{first_ts}`" if first_ts == last_ts else f"`{first_ts}` → `{last_ts}`"

        W(f"### {icon} {label} — {plural(count, 'occurrence')}")
        W("")
        W(f"**Category:** `{cat}` | **Severity:** `{sev}` | **When:** {time_range}")
        W("")

        # Show up to max_group representative occurrences that have context
        shown = 0
        for ts, ctx in occ:
            if not ts:
                continue  # deduplicated, no context stored
            if shown >= max_group:
                W(f"_...and {count - shown} more occurrences (omitted for brevity)_")
                break
            if ctx:
                W(f"**Context before** (`{ts}`):")
                W("```")
                for c in ctx:
                    W(c)
                W("```")
            else:
                W(f"- `{ts}` _(no distinct context lines)_")
            shown += 1

        if shown == 0:
            W(f"_All {count} occurrences were rapid repeats within the deduplication window._")

        W("")

    # ── Timeline ──
    W("## Event Timeline")
    W("")
    W("_One entry per scene load + first occurrence of each error type per minute._")
    W("")

    for ts, sev, label, clean in timeline:
        icon = sev_icon.get(sev, '⚪')
        W(f"- `{ts}` {icon} **{label}** — {clean}")

    W("")

    # ── Prompt suggestion ──
    W("---")
    W("")
    W("## Suggested Prompt")
    W("")
    W("> Copy everything above this section and prepend the following:")
    W("")
    W("```")
    W("The following is a compressed Unity runtime log from a game session.")
    W("Repeated events are grouped. Context lines show what happened just before each error.")
    W("")
    W("Please:")
    W("1. Identify the most likely root causes for the critical errors.")
    W("2. Note any error cascades (one error triggering others).")
    W("3. Suggest specific fixes, referencing the context lines where relevant.")
    W("4. Flag any patterns that suggest systemic issues (not one-off bugs).")
    W("```")
    W("")

    return '\n'.join(lines)


# ─── Process one file ─────────────────────────────────────────────────────────

def process_file(filepath, context_lines, max_group, window_sec):
    abs_path = os.path.abspath(filepath)
    base_dir = os.path.dirname(abs_path)
    log_stem  = os.path.splitext(os.path.basename(abs_path))[0]
    out_dir   = os.path.join(base_dir, log_stem)

    os.makedirs(out_dir, exist_ok=True)
    shutil.copy2(abs_path, os.path.join(out_dir, 'original.txt'))

    with open(abs_path, 'r', encoding='utf-8', errors='ignore') as f:
        raw_lines = f.readlines()

    session, scene_events, groups, timeline = analyze(
        raw_lines, context_lines, max_group, window_sec
    )

    md = render_md(
        os.path.basename(abs_path),
        session, scene_events, groups, timeline,
        max_group
    )

    out_md = os.path.join(out_dir, 'analysis.md')
    with open(out_md, 'w', encoding='utf-8') as f:
        f.write(md)

    total_events = session['exceptions'] + session['errors'] + session['warnings']
    compression  = (1 - len(md) / max(len(''.join(raw_lines)), 1)) * 100

    return total_events, len(groups), compression


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    # Parse args
    context_lines = DEFAULT_CONTEXT_LINES
    max_group     = DEFAULT_MAX_GROUP
    window_sec    = DEFAULT_WINDOW_SEC

    args = sys.argv[1:]

    def get_arg(flag, default):
        if flag in args:
            idx = args.index(flag)
            try:
                return int(args[idx + 1])
            except (IndexError, ValueError):
                print(f"Invalid value for {flag}, using default {default}.")
        return default

    context_lines = get_arg('--context',   context_lines)
    max_group     = get_arg('--max-group', max_group)
    window_sec    = get_arg('--window',    window_sec)

    # Find all .txt files in the script's folder
    script_dir = os.path.dirname(os.path.abspath(__file__))
    txt_files  = sorted(
        f for f in os.listdir(script_dir)
        if f.endswith('.txt') and os.path.isfile(os.path.join(script_dir, f))
    )

    if not txt_files:
        print("No .txt files found in the script folder.")
        sys.exit(0)

    print(f"\nlog_compressor.py")
    print(f"  context: {context_lines} lines before each error")
    print(f"  max-group: {max_group} representative examples per group")
    print(f"  window: {window_sec}s deduplication window")
    print(f"\nFound {plural(len(txt_files), '.txt file')}:\n")

    for filename in txt_files:
        filepath = os.path.join(script_dir, filename)
        print(f"  ── {filename}")
        try:
            total_events, group_count, compression = process_file(
                filepath, context_lines, max_group, window_sec
            )
            stem = os.path.splitext(filename)[0]
            print(f"     ✓ {total_events} events → {group_count} groups")
            print(f"     ✓ {compression:.0f}% smaller → {stem}/analysis.md\n")
        except Exception as e:
            print(f"     ✗ Error processing {filename}: {e}\n")

    print("Done. Open analysis.md and paste it directly into your AI chat.")