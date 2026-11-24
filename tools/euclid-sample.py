#!/usr/bin/env python3
"""Validate a small Euclid TAP CSV export; never infer distances or classifications."""
import argparse
import csv
import hashlib
import io
import json
import math
import os
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 10000


def normalize(raw, metadata):
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError('CSV is empty or exceeds 5 MiB')
    required = ('release', 'table', 'endpoint', 'query', 'retrieved_at', 'coordinate_frame', 'license', 'credit', 'source_url')
    if not isinstance(metadata, dict) or not all(isinstance(metadata.get(k), str) and metadata[k].strip() for k in required):
        raise ValueError('complete string provenance metadata is required')
    for key in ('endpoint', 'source_url'):
        parsed = urlparse(metadata[key])
        if parsed.scheme != 'https' or not parsed.netloc:
            raise ValueError(f'{key} must be an HTTPS URL')
    try:
        timestamp = datetime.fromisoformat(metadata['retrieved_at'].replace('Z', '+00:00'))
        if timestamp.utcoffset() is None:
            raise ValueError('timezone required')
    except ValueError:
        raise ValueError('retrieved_at must be an ISO timestamp with timezone') from None
    if metadata['coordinate_frame'] != 'ICRS degrees':
        raise ValueError('coordinate_frame must explicitly be ICRS degrees')
    reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig'), newline=''), strict=True)
    if not reader.fieldnames or not {'object_id', 'ra', 'dec'}.issubset(reader.fieldnames):
        raise ValueError('CSV must contain object_id, ra and dec')
    if len(reader.fieldnames) != len(set(reader.fieldnames)):
        raise ValueError('duplicate CSV column names')
    objects, seen = [], set()
    for row in reader:
        if len(objects) >= MAX_ROWS:
            raise ValueError('sample exceeds 10000 rows')
        if None in row:
            raise ValueError('CSV row has extra fields')
        ident = row.get('object_id') or ''
        if not ident or ident != ident.strip() or ident in seen:
            raise ValueError('missing, padded or duplicate object_id')
        try:
            ra, dec = float(row['ra']), float(row['dec'])
        except (ValueError, TypeError):
            raise ValueError('invalid coordinates') from None
        if not math.isfinite(ra) or not math.isfinite(dec) or not (0 <= ra < 360 and -90 <= dec <= 90):
            raise ValueError('coordinates outside valid range')
        seen.add(ident)
        objects.append({'object_id': ident, 'ra_deg': ra, 'dec_deg': dec})
    if not objects:
        raise ValueError('no data rows')
    return {'format': 'orbit-observed-directions-v1', 'representation': 'sky-direction-only',
            'distance': 'unknown', 'classification': 'unknown',
            'provenance': dict(metadata), 'provenance_verification': 'user-supplied-not-independently-verified',
            'source_sha256': hashlib.sha256(raw).hexdigest(),
            'source_columns': reader.fieldnames,
            'discarded_columns': [c for c in reader.fieldnames if c not in ('object_id', 'ra', 'dec')],
            'count': len(objects), 'objects': objects}


def publish_new(output, content):
    # Write and flush a temporary file before atomically linking it without replacing a target.
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(mode='wb', dir=output.parent, prefix='.euclid-', suffix='.tmp', delete=False) as f:
            temp_name = f.name
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.link(temp_name, output)
    finally:
        if temp_name is not None:
            os.unlink(temp_name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path, help='Unmodified CSV response from a verified TAP query')
    parser.add_argument('metadata', type=Path, help='JSON provenance supplied after checking official metadata')
    parser.add_argument('output', type=Path, help='New output JSON path; existing files are not overwritten')
    args = parser.parse_args()
    if args.csv.stat().st_size > MAX_BYTES:
        parser.error('CSV exceeds 5 MiB')
    def reject_constant(value):
        raise ValueError(f'non-standard JSON constant: {value}')
    metadata = json.loads(args.metadata.read_text(encoding='utf-8'), parse_constant=reject_constant)
    result = normalize(args.csv.read_bytes(), metadata)
    content = (json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
    publish_new(args.output, content)
    print(f"Validated {result['count']} sky directions; source SHA-256 {result['source_sha256']}")


if __name__ == '__main__':
    main()
