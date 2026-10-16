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

TIMESTAMP_RE  = re.compile(r'^(\d{2}:\d{2}:\d{2})(?:\.(\d+))?')
HTML_TAG_RE   = re.compile(r'</?(?:color|b|i|size|material)(?:=[^>]*)?>', re.I)
NOISE_RE      = re.compile('|'.join(NOISE_PATTERNS))


# ─── Helpers ──────────────────────────────────────────────────────────────────

def parse_time(line):
    m = TIMESTAMP_RE.match(line)
    if m:
        try:
            return datetime.strptime(m.group(1), '%H:%M:%S').replace(microsecond=int((m.group(2) or '0')[:3].ljust(3, '0')) * 1000)
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

def original_severity(line):
    marker = re.search(r'\[(EXCEPTION|ERROR|WARNING|WARN|LOG|INFO|ASSERT)\]', line, re.I)
    if not marker:
        return None
    sev = marker[1].upper()
    return {'WARN': 'WARNING', 'INFO': 'LOG', 'ASSERT': 'ERROR'}.get(sev, sev)


def match_event(line):
    specific = [p for p in EVENT_PATTERNS if p[2] not in ('Error', 'Warning', 'Exception')]
    for pattern, severity, category, label in specific + EVENT_PATTERNS:
        if re.search(pattern, line, re.I):
            severity = original_severity(line) or ('ERROR' if label == 'Object reference not set' else severity)
            return severity, category, label
    severity = original_severity(line)
    if severity and severity != 'LOG':
        return severity, 'Error', f'[{severity}]'
    return None


def normalize_message(line):
    line = clean_line(line)
    line = re.sub(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', '<id>', line, flags=re.I)
    line = re.sub(r'\b0x[0-9a-f]+\b', '<hex>', line, flags=re.I)
    line = re.sub(r'(?<![\w])[-+]?\d+(?:\.\d+)?\b', '<n>', line)
    return re.sub(r'\s+', ' ', line).strip()


def is_stack_frame(line):
    return bool(re.search(r'^(?:at\s+|--- End of|StackTrace:|[\w.$+`<>]+[.:][\w.$+`<>]+\s*\()', clean_line(line), re.I))


def event_type(severity, category):
    if category == 'SceneLoad':
        return 'scene-load'
    if severity == 'EXCEPTION':
        return 'exception-record'
    return 'logged-error' if severity == 'ERROR' else 'logged-message'


def format_time(dt):
    return dt.strftime("%H:%M:%S") if dt else "??:??:??"

def plural(n, word):
    return f"{n} {word}{'s' if n != 1 else ''}"


# ─── Core analysis ────────────────────────────────────────────────────────────

def analyze(lines, context_lines, max_group, window_sec):
    """Group by scene and normalized message; preserve original severity and evidence.

    Exception records are NOT evidence that an exception was unhandled.
    Returns session, scene_events, groups, timeline (same top-level API).
    """
    import json
    parsed = []
    current_time = None
    for raw in lines:
        current_time = parse_time(raw) or current_time
        raw = raw.rstrip('\r\n')
        frame = is_stack_frame(raw)
        parsed.append(dict(time=current_time, raw=raw, clean=clean_line(raw), frame=frame,
                           match=match_event(raw) if not frame and not is_noise(raw) else None))
    events, scene_events = [], []
    scene = '(unknown scene)'
    for i, item in enumerate(parsed):
        if not item['match']:
            continue
        sev, cat, label = item['match']
        if cat == 'SceneLoad':
            scene = re.sub(r'^.*?Loaded Scene:\s*', '', item['clean'], flags=re.I).strip()
            scene_events.append((format_time(item['time']), scene))
        source = original_severity(item['raw']) or 'UNKNOWN'
        kind = event_type(sev, cat)
        normalized = normalize_message(item['raw'])
        key = json.dumps([scene, cat, normalized, source, kind, sev], ensure_ascii=False, separators=(',', ':'))
        events.append(dict(index=i, time=item['time'], severity=sev, category=cat, label=label,
                           scene=scene, originalSeverity=source, eventType=kind,
                           normalizedMessage=normalized, groupKey=key, raw=item['raw'], clean=item['clean']))
    groups, last_by_key = {}, {}
    for ev in events:
        key, i, t = ev['groupKey'], ev['index'], ev['time']
        if key not in groups:
            groups[key] = dict(category=ev['category'], severity=ev['severity'], label=ev['normalizedMessage'],
                               scene=ev['scene'], originalSeverity=ev['originalSeverity'], eventType=ev['eventType'],
                               normalizedMessage=ev['normalizedMessage'], occurrences=[], times=[], count=0,
                               representativeStack=[], detailedCount=0)
        group = groups[key]
        prev = last_by_key.get(key)
        delta = abs((t - prev).total_seconds()) if t and prev else float('inf')
        if t and prev and delta > 43200:
            delta = 86400 - delta
        deduped = delta <= window_sec and ev['category'] not in ('SceneLoad', 'SceneReload')
        stack, end = [], i + 1
        while end < len(parsed) and (parsed[end]['frame'] or not parsed[end]['raw'].strip()):
            if parsed[end]['frame']:
                stack.append(parsed[end]['raw'])
            end += 1
        if not group['representativeStack'] and stack:
            group['representativeStack'] = stack
        detailed = not deduped and group['detailedCount'] < max_group
        context, after = [], []
        if detailed:
            group['detailedCount'] += 1
            context = [p['clean'] for p in parsed[max(0, i-context_lines):i]
                       if p['clean'] and not p['frame'] and not is_noise(p['raw'])]
            after = [p['clean'] for p in parsed[end:end+context_lines]
                     if p['clean'] and not p['frame'] and not is_noise(p['raw'])]
        occ = dict(time=format_time(t), index=i, deduped=deduped, detailed=detailed, context=context, contextAfter=after)
        if detailed:
            occ.update(clean=ev['clean'], raw=ev['raw'])
        group['occurrences'].append(occ)
        group['times'].append(t)
        group['count'] += 1
        last_by_key[key] = t
    times = [ev['time'] for ev in events if ev['time']]
    counts = Counter(ev['severity'] for ev in events)
    session = dict(start=format_time(times[0]) if times else 'N/A', end=format_time(times[-1]) if times else 'N/A',
                   total_lines=len(lines), exceptions=counts['EXCEPTION'], errors=counts['ERROR'],
                   warnings=counts['WARNING'], logs=counts['LOG'], scenes=len(scene_events))
    timeline, seen = [], set()
    window_start = times[0] if times else None
    for ev in events:
        t = ev['time']
        if ev['severity'] == 'LOG' and ev['category'] != 'SceneLoad':
            continue
        delta = abs((t-window_start).total_seconds()) if t and window_start else 0
        if delta > 43200:
            delta = 86400 - delta
        if delta > window_sec:
            seen.clear()
            window_start = t
        key = (ev['groupKey'], t.strftime('%H:%M') if t else '')
        if key not in seen or ev['category'] == 'SceneLoad':
            timeline.append((format_time(t), ev['severity'], ev['label'], ev['clean'][:100], ev['scene']))
            seen.add(key)
    return session, scene_events, groups, timeline


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
        times_with_data = [(o['time'], o['context']) for o in occ if o['time']]
        first_ts = times_with_data[0][0]  if times_with_data else 'N/A'
        last_ts  = times_with_data[-1][0] if times_with_data else 'N/A'
        time_range = f"`{first_ts}`" if first_ts == last_ts else f"`{first_ts}` → `{last_ts}`"

        W(f"### {icon} {label} — {plural(count, 'occurrence')}")
        W("")
        W(f"**Category:** `{info['category']}` | **Severity:** `{sev}` | **When:** {time_range}")
        W(f"**Scene:** {info['scene']} | **Original severity:** `{info['originalSeverity']}` | **Type:** `{info['eventType']}`")
        if info['representativeStack']:
            W('**Representative stack trace** (complete captured frame block, not proof of an unhandled exception):')
            W('````')
            lines.extend(info['representativeStack'])
            W('````')
        W("")

        # Show up to max_group representative occurrences that have context
        shown = 0
        for o in occ:
            ts, ctx = o['time'], o['context']
            if not o['detailed']:
                continue  # deduplicated, no context stored
            if shown >= max_group:
                W(f"_...and {count - shown} more occurrences (omitted for brevity)_")
                break
            W(f"**Event** (`{ts}`, line {o['index'] + 1}):")
            W('````')
            W(o.get('raw', o.get('clean', '')))
            W('````')
            if ctx:
                W(f"**Context before** (`{ts}`):")
                W("```")
                for c in ctx:
                    W(c)
                W("```")
            else:
                W(f"- `{ts}` _(no distinct context lines)_")
            if o['contextAfter']:
                W('**Context after** (temporal proximity, not proven causality):')
                W('````')
                lines.extend(o['contextAfter'])
                W('````')
            shown += 1

        if count > shown:
            W(f'_{count - shown} occurrences not expanded; totals and first/last times include repeats._')

        W("")

    # ── Timeline ──
    W("## Event Timeline")
    W("")
    W("_Scene loads plus distinct message/scene/type groups per clustering window and minute._")
    W("")

    for ts, sev, label, clean, scene in timeline:
        icon = sev_icon.get(sev, '⚪')
        W(f"- `{ts}` {icon} [{scene}] **{label}** — {clean}")

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
    W("Events are grouped by scene and normalized message. Context is temporal evidence, not proof of causality. Exception records do not prove an unhandled exception.")
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
