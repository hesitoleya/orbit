#!/usr/bin/env python3
"""Tests use invented fixtures, not astronomical observations."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('euclid_sample', Path(__file__).with_name('euclid-sample.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
META = dict(release='fixture', table='fixture', endpoint='https://example.invalid/tap',
            query='fixture', retrieved_at='2026-11-16T00:00:00Z', coordinate_frame='ICRS degrees',
            license='fixture', credit='fixture', source_url='https://example.invalid')


class SampleTests(unittest.TestCase):
    def test_preserves_ids_and_direction_only(self):
        result = module.normalize(b'object_id,ra,dec\n1234567890123456789,0,-90\n2,359.9,90\n', META)
        self.assertEqual(result['count'], 2)
        self.assertEqual(result['objects'][0]['object_id'], '1234567890123456789')
        self.assertEqual(result['distance'], 'unknown')
        self.assertEqual(result['classification'], 'unknown')
        self.assertEqual(len(result['source_sha256']), 64)

    def test_reject_invalid_inputs(self):
        cases = [b'object_id,ra,dec\n1,nan,0\n', b'object_id,ra,dec\n1,360,0\n',
                 b'object_id,ra,dec\n1,0,-91\n', b'object_id,ra,dec\n1,0,0\n1,1,1\n',
                 b'object_id,ra,dec\n,0,0\n', b'object_id,ra\n1,0\n',
                 b'object_id,ra,dec,ra\n1,0,0,1\n', b'object_id,ra,dec\n',
                 b'object_id,ra,dec\n1,0,0,extra\n']
        for data in cases:
            with self.subTest(data=data), self.assertRaises(ValueError):
                module.normalize(data, META)

    def test_provenance_and_units_required(self):
        for changes in ({'license': ''}, {'coordinate_frame': 'hours'}, {'query': ''}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                module.normalize(b'object_id,ra,dec\n1,0,0\n', {**META, **changes})

    def test_csv_integrity_and_discarded_columns(self):
        with self.assertRaises(module.csv.Error):
            module.normalize(b'object_id,ra,dec\n1,0,"20\n', META)
        with self.assertRaises(ValueError):
            module.normalize(b'object_id,ra,dec\n" 1 ",0,20\n', META)
        result = module.normalize(b'\xef\xbb\xbfobject_id,ra,dec,quality\n"1",0,20,"good, maybe"\n', META)
        self.assertEqual(result['discarded_columns'], ['quality'])
        self.assertEqual(result['provenance_verification'], 'user-supplied-not-independently-verified')

    def test_provenance_format(self):
        for changes in ({'release': True}, {'source_url': 'invalid'}, {'retrieved_at': '2026-01-01'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                module.normalize(b'object_id,ra,dec\n1,0,0\n', {**META, **changes})

    def test_file_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            target = folder / 'output.json'
            module.publish_new(target, b'first')
            with self.assertRaises(FileExistsError):
                module.publish_new(target, b'second')
            self.assertEqual(target.read_bytes(), b'first')
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ['output.json'])
            with patch.object(module.os, 'link', side_effect=OSError('test failure')):
                with self.assertRaises(OSError):
                    module.publish_new(folder / 'other.json', b'broken')
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ['output.json'])

    def test_cli_rejects_invalid_without_output(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source, metadata, target = folder / 'data.csv', folder / 'meta.json', folder / 'out.json'
            source.write_text('object_id,ra,dec\n1,0,"20\n', encoding='utf-8')
            metadata.write_text(json.dumps(META), encoding='utf-8')
            command = [sys.executable, str(Path(module.__file__)), str(source), str(metadata), str(target)]
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertFalse(target.exists())
            source.write_text('object_id,ra,dec\n1,0,20\n', encoding='utf-8')
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(json.loads(target.read_text(encoding='utf-8'))['count'], 1)
            before = target.read_bytes()
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(target.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
