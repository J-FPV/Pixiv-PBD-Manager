from __future__ import annotations

import subprocess
import time
import webbrowser
from pathlib import Path


def open_urls(
    urls: list[str],
    *,
    browser: str | None = None,
    user_data_dir: str | None = None,
    delay_seconds: float = 1.0,
) -> None:
    for index, url in enumerate(urls):
        if browser:
            command = [str(Path(browser).expanduser())]
            if user_data_dir:
                command.append(f"--user-data-dir={Path(user_data_dir).expanduser()}")
            command.append(url)
            subprocess.Popen(command)
        else:
            webbrowser.open_new_tab(url)
        if index != len(urls) - 1 and delay_seconds > 0:
            time.sleep(delay_seconds)
