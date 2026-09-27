import json
import os
from pathlib import Path
import subprocess
import sys
import time


WRITER = """
import json, sys, time
from pathlib import Path
from pixiv_pbd_manager.paths import write_json_atomic
from pixiv_pbd_manager.recovery.session import RecoverySession
root, number, field, value = sys.argv[1:]
root = Path(root)
with RecoverySession({'_base_dir': str(root)}, 'settings.save', lambda _: None) as session:
    values = json.loads(session.settings.read_text(encoding='utf-8'))
    (root / ('ready-' + number)).touch()
    deadline = time.monotonic() + 15
    while not (root / 'start').exists():
        if time.monotonic() > deadline:
            raise TimeoutError('test start signal missing')
        time.sleep(0.01)
    values[field] = value
    write_json_atomic(session.settings, values)
"""


def test_separate_processes_merge_nonconflicting_writes(tmp_path):
    data = tmp_path / '.pixiv-pbd-manager'
    data.mkdir()
    settings = data / 'gui_settings.json'
    settings.write_text(json.dumps({'theme': 'light', 'language': 'zh'}), encoding='utf-8')
    env = {**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parents[1])}
    processes = []
    try:
        for number, field, value in [(0, 'theme', 'dark'), (1, 'language', 'en')]:
            processes.append(subprocess.Popen(
                [sys.executable, '-c', WRITER, str(tmp_path), str(number), field, value],
                cwd=tmp_path, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            ))
        deadline = time.monotonic() + 15
        while not all((tmp_path / f'ready-{number}').exists() for number in range(2)):
            assert time.monotonic() < deadline, 'writer failed to initialize'
            time.sleep(0.02)
        (tmp_path / 'start').touch()
        for process in processes:
            output, error = process.communicate(timeout=20)
            assert process.returncode == 0, (output, error)
        assert json.loads(settings.read_text(encoding='utf-8')) == {'theme': 'dark', 'language': 'en'}
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.wait()
