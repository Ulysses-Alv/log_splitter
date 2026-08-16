"""
validate_parity.py
Runs the original log_compressor.py and log_splitter.py against all test fixtures,
outputting JSON metrics and markdown so we can verify exact parity with the JS implementation.
"""

import os
import sys
import json
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Import original python scripts
import log_compressor
import log_splitter

def test_all_fixtures():
    fixtures_dir = Path(__file__).parent / 'fixtures'
    results = {}

    for fixture in sorted(fixtures_dir.glob('*.txt')):
        with open(fixture, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        session, scene_events, groups, timeline = log_compressor.analyze(
            lines,
            context_lines=log_compressor.DEFAULT_CONTEXT_LINES,
            max_group=log_compressor.DEFAULT_MAX_GROUP,
            window_sec=log_compressor.DEFAULT_WINDOW_SEC
        )

        md = log_compressor.render_md(
            fixture.name,
            session,
            scene_events,
            groups,
            timeline,
            max_group=log_compressor.DEFAULT_MAX_GROUP
        )

        # Convert groups to serializable
        clean_groups = {}
        for cat, data in groups.items():
            clean_groups[cat] = {
                'severity': data['severity'],
                'label': data['label'],
                'occurrences_count': len(data['occurrences']),
                'first_context': data['occurrences'][0][1] if data['occurrences'] else [],
            }

        results[fixture.name] = {
            'session': session,
            'scene_events_count': len(scene_events),
            'groups': clean_groups,
            'timeline_count': len(timeline),
            'md_length': len(md),
        }

    print(json.dumps(results, indent=2))

if __name__ == '__main__':
    test_all_fixtures()
