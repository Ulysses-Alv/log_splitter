"""
log_splitter.py
Auto-detects all .txt files in the same folder and splits each one.

Place log_splitter.py next to your log files:
    root/log_splitter.py
    root/logreport_session01.txt
    root/logreport_session02.txt

Run:
    python log_splitter.py

Generates one folder per log file:
    root/logreport_session01/
        original.txt
        summary.txt
        event_01_scene_load_15h05m27s.txt
        event_02_nullref_15h27m47s.txt
        ...

Optional: custom time window (default: 60s total = 30s before + 30s after)
    python log_splitter.py --window 120
"""

import sys
import re
import os
import shutil
from datetime import datetime, timedelta

# ─── Config ───────────────────────────────────────────────────────────────────

WINDOW_BEFORE = 30  # seconds before the event
WINDOW_AFTER  = 30  # seconds after the event

CRITICAL_PATTERNS = [
    (r'\[ERROR\]',                         'error'),
    (r'NullReferenceException',            'nullref'),
    (r'Object reference not set',          'nullref'),
    (r'\[WARNING\].*NULL target',          'nullref'),
    (r'\[WARNING\].*missing/null',         'nullref'),
    (r'\[WARNING\].*Tween startup failed', 'nullref'),
    (r'\[WARNING\].*error inside a tween', 'nullref'),
    (r'\[SceneLoader\] Loaded Scene:',     'scene_load'),
    (r'Trying to load the same scene',     'scene_reload'),
    (r'"SetDestination".*NavMesh',         'navmesh_error'),
    (r'Failed to create agent',            'navmesh_error'),
    (r'Cannot throw a kinematic',          'physics_error'),
]

# ─── Helpers ──────────────────────────────────────────────────────────────────

TIMESTAMP_RE = re.compile(r'^(\d{2}:\d{2}:\d{2}\.\d+)')

def parse_time(ts_str):
    try:
        base   = ts_str.split('.')[0]
        millis = ts_str.split('.')[1][:3]
        return datetime.strptime(f"{base}.{millis}", "%H:%M:%S.%f")
    except Exception:
        return None

def get_event_label(line):
    for pattern, label in CRITICAL_PATTERNS:
        if re.search(pattern, line, re.IGNORECASE):
            clean = re.sub(r'<[^>]+>', '', line).strip()
            desc  = re.sub(r'[^\w\s\-]', '', clean)[:50].strip()
            desc  = re.sub(r'\s+', '_', desc)
            return label, desc
    return None

def strip_tags(text):
    return re.sub(r'<[^>]+>', '', text).strip()

# ─── Split one file ───────────────────────────────────────────────────────────

def split_log(filepath, window_before, window_after):
    abs_path = os.path.abspath(filepath)
    base_dir = os.path.dirname(abs_path)
    log_name = os.path.splitext(os.path.basename(abs_path))[0]
    out_dir  = os.path.join(base_dir, log_name)

    os.makedirs(out_dir, exist_ok=True)
    shutil.copy2(abs_path, os.path.join(out_dir, 'original.txt'))

    with open(abs_path, 'r', encoding='utf-8') as f:
        raw_lines = f.readlines()

    # Index lines with their timestamp
    indexed    = []
    current_ts = None
    for line in raw_lines:
        m = TIMESTAMP_RE.match(line)
        if m:
            current_ts = parse_time(m.group(1))
        indexed.append((current_ts, line))

    # Detect critical events
    events = []
    for i, (ts, line) in enumerate(indexed):
        result = get_event_label(line)
        if result and ts is not None:
            label, desc = result
            events.append((i, ts, label, desc, line.strip()))

    # Deduplicate: same label within 5s → keep only first
    deduped = []
    for ev in events:
        i, ts, label, desc, raw = ev
        if deduped:
            last_ts, last_label = deduped[-1][1], deduped[-1][2]
            if label == last_label and abs((ts - last_ts).total_seconds()) < 5:
                continue
        deduped.append(ev)
    events = deduped

    summary_lines = [
        "=" * 60,
        "  LOG SPLIT SUMMARY",
        f"  Source : {os.path.basename(abs_path)}",
        f"  Window : -{window_before}s before / +{window_after}s after each event",
        f"  Events : {len(events)} found",
        "=" * 60,
        "",
    ]

    if not events:
        summary_lines.append("  No critical events found.")
        with open(os.path.join(out_dir, 'summary.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(summary_lines))
        print(f"  (no critical events found)")
        return 0

    for idx, (line_i, ts, label, desc, raw_line) in enumerate(events):
        ts_str  = ts.strftime("%H:%M:%S")
        t_start = ts - timedelta(seconds=window_before)
        t_end   = ts + timedelta(seconds=window_after)

        window_lines = [
            line for ts2, line in indexed
            if ts2 is not None and t_start <= ts2 <= t_end
        ]

        ts_tag = ts.strftime("%Hh%Mm%Ss")
        fname  = f"event_{idx+1:02d}_{label}_{ts_tag}.txt"
        fpath  = os.path.join(out_dir, fname)

        with open(fpath, 'w', encoding='utf-8') as out:
            out.write(f"{'='*60}\n")
            out.write(f"  EVENT #{idx+1:02d} — {label.upper()}\n")
            out.write(f"  Time   : {ts_str}\n")
            out.write(f"  Window : {t_start.strftime('%H:%M:%S')} → {t_end.strftime('%H:%M:%S')}\n")
            out.write(f"  Trigger: {strip_tags(raw_line)}\n")
            out.write(f"{'='*60}\n\n")
            out.writelines(window_lines)

        summary_lines.append(f"  [{idx+1:02d}] {ts_str}  [{label}]")
        summary_lines.append(f"       {strip_tags(raw_line)[:80]}")
        summary_lines.append(f"       → {fname}")
        summary_lines.append("")

    with open(os.path.join(out_dir, 'summary.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(summary_lines))

    return len(events)

# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    # Parse optional --window argument
    window = 30
    if '--window' in sys.argv:
        wi = sys.argv.index('--window')
        try:
            window = int(sys.argv[wi + 1]) // 2
        except (IndexError, ValueError):
            print("Invalid --window value, using default 60s.")

    # Find all .txt files in the same folder as this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    txt_files  = [
        f for f in os.listdir(script_dir)
        if f.endswith('.txt') and os.path.isfile(os.path.join(script_dir, f))
    ]

    if not txt_files:
        print("No .txt files found in the script folder.")
        sys.exit(0)

    print(f"Found {len(txt_files)} .txt file(s) to process:\n")

    for filename in sorted(txt_files):
        filepath = os.path.join(script_dir, filename)
        print(f"── {filename}")
        count = split_log(filepath, window_before=window, window_after=window)
        print(f"   ✓ {count} events → {os.path.splitext(filename)[0]}/\n")

    print("All done.")
