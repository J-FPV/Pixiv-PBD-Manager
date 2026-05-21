from __future__ import annotations

import json
import queue
import threading
from pathlib import Path
from typing import Callable

import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

from .browser import open_urls
from .consent import is_cookie_consent_recorded, record_cookie_consent, revoke_cookie_consent
from .cookie_store import clear_cookie, load_cookie, save_cookie
from .database import DEFAULT_DB, ArtistDatabase
from .i18n import LANGUAGE_LABELS, language_or_default, text
from .models import ArtistRecord, utc_now
from .operations import (
    DownloadUpdatesResult,
    ScanResult,
    UpdateCheckResult,
    check_artist_updates,
    download_artist_updates,
    scan_into_database,
)
from .resolver import PixivResolveError, fetch_user_profile


DEFAULT_SETTINGS = Path(".pixiv-pbd-manager") / "gui_settings.json"


def load_settings(path: Path = DEFAULT_SETTINGS) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_settings(settings: dict, path: Path = DEFAULT_SETTINGS) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class PixivPbdManagerApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.settings = load_settings()
        self.language = language_or_default(self.settings.get("language"))
        self.title(self.t("app_title"))
        self.geometry("1180x800")
        self.minsize(980, 660)

        self.message_queue: queue.Queue[tuple[str, object]] = queue.Queue()
        self.watch_stop: threading.Event | None = None
        self.watch_thread: threading.Thread | None = None
        self.worker_thread: threading.Thread | None = None
        self.current_task_label: str | None = None

        self.db_var = tk.StringVar(value=self.settings.get("database", str(DEFAULT_DB)))
        self.browser_var = tk.StringVar(value=self.settings.get("browser", ""))
        self.user_data_dir_var = tk.StringVar(value=self.settings.get("user_data_dir", ""))
        self.delay_var = tk.DoubleVar(value=float(self.settings.get("delay", 1.0)))
        self.limit_var = tk.IntVar(value=int(self.settings.get("limit", 10)))
        self.watch_interval_var = tk.IntVar(value=int(self.settings.get("watch_interval", 30)))
        self.resolve_online_var = tk.BooleanVar(value=bool(self.settings.get("resolve_online", True)))
        self.resolve_limit_var = tk.IntVar(value=int(self.settings.get("resolve_limit", 3)))
        self.fuzzy_search_var = tk.BooleanVar(value=bool(self.settings.get("fuzzy_search", False)))
        self.fuzzy_min_score_var = tk.DoubleVar(value=float(self.settings.get("fuzzy_min_score", 0.35)))
        self.ssl_fallback_var = tk.BooleanVar(value=bool(self.settings.get("ssl_fallback", True)))
        self.cookie_consent_var = tk.BooleanVar(value=is_cookie_consent_recorded())
        legacy_cookie = self.settings.pop("pixiv_cookie", None)
        if self.cookie_consent_var.get():
            stored_cookie = load_cookie()
            if legacy_cookie and not stored_cookie:
                save_cookie(legacy_cookie)
                stored_cookie = legacy_cookie
        else:
            clear_cookie()
            stored_cookie = None
        self.pixiv_cookie_var = tk.StringVar(value=stored_cookie or "")
        self.show_cookie_var = tk.BooleanVar(value=False)
        self.search_var = tk.StringVar()
        self.language_var = tk.StringVar(value=self.language)
        self.status_var = tk.StringVar(value=self.t("ready"))
        self.checked_artist_ids: set[str] = set()
        self.checkbox_images: dict[str, tk.PhotoImage] = {}

        self.root_listbox: tk.Listbox
        self.exclude_listbox: tk.Listbox
        self.artist_tree: ttk.Treeview
        self.log_text: tk.Text
        self.context_menu: tk.Menu
        self.scan_button: ttk.Button
        self.watch_button: ttk.Button
        self.stop_watch_button: ttk.Button
        self.pixiv_cookie_entry: ttk.Entry

        self._build_ui()
        self._load_download_roots()
        self._load_exclude_roots()
        self.refresh_artists()
        self.after(100, self._drain_queue)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def t(self, key: str, **kwargs) -> str:
        return text(self.language, key, **kwargs)

    @property
    def db_path(self) -> Path:
        return Path(self.db_var.get() or DEFAULT_DB)

    def _create_checkbox_images(self) -> None:
        self.checkbox_images = {
            "checked": self._make_checkbox_image(True),
            "unchecked": self._make_checkbox_image(False),
        }

    def _make_checkbox_image(self, checked: bool) -> tk.PhotoImage:
        image = tk.PhotoImage(width=16, height=16)
        fill = "#0078d4" if checked else "#ffffff"
        border = "#005a9e" if checked else "#8a8a8a"
        image.put(fill, to=(2, 2, 14, 14))
        image.put(border, to=(2, 1, 14, 2))
        image.put(border, to=(2, 14, 14, 15))
        image.put(border, to=(1, 2, 2, 14))
        image.put(border, to=(14, 2, 15, 14))
        if checked:
            for x, y in ((4, 8), (5, 9), (6, 10), (7, 10), (8, 9), (9, 8), (10, 7), (11, 6)):
                image.put("#ffffff", to=(x, y, x + 2, y + 2))
        return image

    def _build_ui(self) -> None:
        self.title(self.t("app_title"))
        self._create_checkbox_images()
        self._build_menu()
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        top = ttk.Frame(self, padding=(12, 10, 12, 6))
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        ttk.Label(top, text=self.t("database")).grid(row=0, column=0, sticky="w")
        ttk.Entry(top, textvariable=self.db_var).grid(row=0, column=1, sticky="ew", padx=(8, 8))
        ttk.Button(top, text=self.t("choose"), command=self.choose_database).grid(row=0, column=2, sticky="e")

        body = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        body.grid(row=1, column=0, sticky="nsew", padx=12, pady=(0, 8))

        left = ttk.Frame(body, padding=(0, 0, 10, 0))
        left.columnconfigure(0, weight=1)
        left.rowconfigure(1, weight=1)
        left.rowconfigure(4, weight=1)
        body.add(left, weight=1)

        ttk.Label(left, text=self.t("download_folders")).grid(row=0, column=0, sticky="w")
        self.root_listbox = tk.Listbox(left, height=6, activestyle="dotbox", exportselection=False)
        self.root_listbox.grid(row=1, column=0, sticky="nsew", pady=(6, 6))

        root_buttons = ttk.Frame(left)
        root_buttons.grid(row=2, column=0, sticky="ew")
        root_buttons.columnconfigure((0, 1, 2), weight=1)
        ttk.Button(root_buttons, text=self.t("add_folder"), command=self.add_download_root).grid(row=0, column=0, sticky="ew", padx=(0, 4))
        ttk.Button(root_buttons, text=self.t("remove"), command=self.remove_download_root).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(root_buttons, text=self.t("save"), command=self.save_current_settings).grid(row=0, column=2, sticky="ew", padx=(4, 0))

        ttk.Label(left, text=self.t("exclude_folders")).grid(row=3, column=0, sticky="w", pady=(12, 0))
        self.exclude_listbox = tk.Listbox(left, height=5, activestyle="dotbox", exportselection=False)
        self.exclude_listbox.grid(row=4, column=0, sticky="nsew", pady=(6, 6))

        exclude_buttons = ttk.Frame(left)
        exclude_buttons.grid(row=5, column=0, sticky="ew")
        exclude_buttons.columnconfigure((0, 1), weight=1)
        ttk.Button(exclude_buttons, text=self.t("add_exclude"), command=self.add_exclude_root).grid(row=0, column=0, sticky="ew", padx=(0, 4))
        ttk.Button(exclude_buttons, text=self.t("remove_exclude"), command=self.remove_exclude_root).grid(row=0, column=1, sticky="ew", padx=(4, 0))

        actions = ttk.LabelFrame(left, text=self.t("actions"), padding=10)
        actions.grid(row=6, column=0, sticky="ew", pady=(12, 0))
        actions.columnconfigure((0, 1), weight=1)

        self.scan_button = ttk.Button(actions, text=self.t("scan"), command=self.scan_once)
        self.scan_button.grid(row=0, column=0, sticky="ew", padx=(0, 4), pady=(0, 6))
        self.watch_button = ttk.Button(actions, text=self.t("start_watch"), command=self.start_watch)
        self.watch_button.grid(row=0, column=1, sticky="ew", padx=(4, 0), pady=(0, 6))
        self.stop_watch_button = ttk.Button(actions, text=self.t("stop_watch"), command=self.stop_watch, state=tk.DISABLED)
        self.stop_watch_button.grid(row=1, column=0, sticky="ew", padx=(0, 4))
        ttk.Button(actions, text=self.t("refresh"), command=self.refresh_artists).grid(row=1, column=1, sticky="ew", padx=(4, 0))

        interval_row = ttk.Frame(actions)
        interval_row.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(10, 0))
        interval_row.columnconfigure(1, weight=1)
        ttk.Label(interval_row, text=self.t("watch_interval")).grid(row=0, column=0, sticky="w")
        ttk.Spinbox(interval_row, from_=5, to=3600, increment=5, textvariable=self.watch_interval_var, width=8).grid(
            row=0, column=1, sticky="w", padx=(8, 4)
        )
        ttk.Label(interval_row, text=self.t("seconds")).grid(row=0, column=2, sticky="w")

        ttk.Checkbutton(
            actions,
            text=self.t("resolve_online"),
            variable=self.resolve_online_var,
            command=self.save_current_settings,
        ).grid(row=3, column=0, columnspan=2, sticky="w", pady=(10, 0))
        ttk.Checkbutton(
            actions,
            text=self.t("fuzzy_search"),
            variable=self.fuzzy_search_var,
            command=self.save_current_settings,
        ).grid(row=4, column=0, columnspan=2, sticky="w", pady=(6, 0))

        pixiv_login = ttk.LabelFrame(left, text=self.t("pixiv_login"), padding=10)
        pixiv_login.grid(row=7, column=0, sticky="ew", pady=(12, 0))
        pixiv_login.columnconfigure(1, weight=1)
        ttk.Checkbutton(
            pixiv_login,
            text=self.t("cookie_consent_label"),
            variable=self.cookie_consent_var,
            command=self.on_cookie_consent_toggle,
        ).grid(row=0, column=0, columnspan=2, sticky="w")
        ttk.Button(
            pixiv_login,
            text=self.t("view_disclaimer"),
            command=lambda: self._show_cookie_disclaimer(view_only=True),
        ).grid(row=0, column=2, sticky="e")
        ttk.Label(pixiv_login, text=self.t("pixiv_cookie_label")).grid(row=1, column=0, sticky="w", pady=(8, 0))
        self.pixiv_cookie_entry = ttk.Entry(
            pixiv_login,
            textvariable=self.pixiv_cookie_var,
            show="" if self.show_cookie_var.get() else "*",
        )
        self.pixiv_cookie_entry.grid(row=1, column=1, sticky="ew", padx=8, pady=(8, 0))
        self.pixiv_cookie_entry.bind("<FocusOut>", lambda _event: self.save_current_settings(log_message=False))
        ttk.Checkbutton(
            pixiv_login,
            text=self.t("show_cookie"),
            variable=self.show_cookie_var,
            command=self.toggle_cookie_visibility,
        ).grid(row=1, column=2, sticky="e", pady=(8, 0))
        ttk.Label(
            pixiv_login,
            text=self.t("pixiv_cookie_hint"),
            wraplength=320,
            foreground="#666666",
            justify="left",
        ).grid(row=2, column=0, columnspan=3, sticky="w", pady=(6, 0))
        self.pixiv_cookie_entry.configure(state="normal" if self.cookie_consent_var.get() else "disabled")

        add_box = ttk.LabelFrame(left, text=self.t("manual_add"), padding=10)
        add_box.grid(row=8, column=0, sticky="ew", pady=(12, 0))
        add_box.columnconfigure((0, 1), weight=1)
        ttk.Button(add_box, text=self.t("add_artist"), command=self.add_artist).grid(row=0, column=0, sticky="ew", padx=(0, 4))
        ttk.Button(add_box, text=self.t("export_urls"), command=self.export_urls).grid(row=0, column=1, sticky="ew", padx=(4, 0))

        right = ttk.Frame(body)
        right.columnconfigure(0, weight=1)
        right.rowconfigure(1, weight=1)
        right.rowconfigure(3, weight=1)
        body.add(right, weight=4)

        toolbar = ttk.Frame(right)
        toolbar.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        toolbar.columnconfigure(1, weight=1)
        ttk.Label(toolbar, text=self.t("filter")).grid(row=0, column=0, sticky="w")
        search = ttk.Entry(toolbar, textvariable=self.search_var)
        search.grid(row=0, column=1, sticky="ew", padx=8)
        search.bind("<KeyRelease>", lambda _event: self.refresh_artists())
        ttk.Button(toolbar, text=self.t("select_all"), command=self.select_all_visible_artists).grid(row=0, column=2, padx=(0, 6))
        ttk.Button(toolbar, text=self.t("clear_selection"), command=self.clear_checked_artists).grid(row=0, column=3, padx=(0, 6))
        ttk.Button(toolbar, text=self.t("check_updates"), command=self.check_updates).grid(row=0, column=4, padx=(0, 6))
        ttk.Button(toolbar, text=self.t("open_updated"), command=self.open_updated_artists).grid(row=0, column=5, padx=(0, 6))
        ttk.Button(toolbar, text=self.t("download_updated"), command=self.download_updated_artists).grid(row=0, column=6, padx=(0, 6))
        ttk.Button(toolbar, text=self.t("open_selected"), command=self.open_selected_artists).grid(row=0, column=7, padx=(0, 6))
        ttk.Button(toolbar, text=self.t("open_all"), command=self.open_all_artists).grid(row=0, column=8, padx=(0, 6))
        ttk.Button(toolbar, text=self.t("copy_urls"), command=self.copy_urls).grid(row=0, column=9)

        columns = ("id", "name", "works", "new_works", "save_paths", "last_seen", "last_opened")
        self.artist_tree = ttk.Treeview(right, columns=columns, show="tree headings", selectmode="extended")
        self.artist_tree.heading("#0", text=self.t("checked"))
        self.artist_tree.heading("id", text=self.t("artist_id"))
        self.artist_tree.heading("name", text=self.t("artist_name"))
        self.artist_tree.heading("works", text=self.t("works"))
        self.artist_tree.heading("new_works", text=self.t("new_works"))
        self.artist_tree.heading("save_paths", text=self.t("save_paths"))
        self.artist_tree.heading("last_seen", text=self.t("last_seen"))
        self.artist_tree.heading("last_opened", text=self.t("last_opened"))
        self.artist_tree.column("#0", width=62, anchor="center", stretch=False)
        self.artist_tree.column("id", width=110, anchor="w")
        self.artist_tree.column("name", width=180, anchor="w")
        self.artist_tree.column("works", width=70, anchor="e")
        self.artist_tree.column("new_works", width=70, anchor="e")
        self.artist_tree.column("save_paths", width=260, anchor="w")
        self.artist_tree.column("last_seen", width=190, anchor="w")
        self.artist_tree.column("last_opened", width=190, anchor="w")
        self.artist_tree.grid(row=1, column=0, sticky="nsew")
        self.artist_tree.bind("<Button-1>", self.on_artist_tree_click)
        self.artist_tree.bind("<Double-1>", self.open_double_clicked_artist)
        self.artist_tree.bind("<Button-3>", self.show_artist_context_menu)
        self.artist_tree.tag_configure("checked", background="#e8f2ff")
        self.artist_tree.tag_configure("unchecked", background="")
        self.context_menu = tk.Menu(self, tearoff=False)
        self.context_menu.add_command(label=self.t("edit_artist_id"), command=self.edit_selected_artist_id)
        self.context_menu.add_command(label=self.t("edit_save_path"), command=self.edit_selected_save_path)

        tree_scroll = ttk.Scrollbar(right, orient=tk.VERTICAL, command=self.artist_tree.yview)
        tree_scroll.grid(row=1, column=1, sticky="ns")
        self.artist_tree.configure(yscrollcommand=tree_scroll.set)

        ttk.Label(right, text=self.t("log")).grid(row=2, column=0, sticky="w", pady=(10, 4))
        self.log_text = tk.Text(right, height=8, wrap="word")
        self.log_text.grid(row=3, column=0, sticky="nsew")
        log_scroll = ttk.Scrollbar(right, orient=tk.VERTICAL, command=self.log_text.yview)
        log_scroll.grid(row=3, column=1, sticky="ns")
        self.log_text.configure(yscrollcommand=log_scroll.set)

        bottom = ttk.Frame(self, padding=(12, 0, 12, 10))
        bottom.grid(row=2, column=0, sticky="ew")
        bottom.columnconfigure(0, weight=1)
        ttk.Label(bottom, textvariable=self.status_var).grid(row=0, column=0, sticky="w")

    def _load_download_roots(self) -> None:
        for item in self.settings.get("download_roots", []):
            self.root_listbox.insert(tk.END, item)

    def _load_exclude_roots(self) -> None:
        for item in self.settings.get("exclude_roots", []):
            self.exclude_listbox.insert(tk.END, item)

    def _download_roots(self) -> list[Path]:
        return [Path(self.root_listbox.get(index)) for index in range(self.root_listbox.size())]

    def _exclude_roots(self) -> list[Path]:
        return [Path(self.exclude_listbox.get(index)) for index in range(self.exclude_listbox.size())]

    def _selected_artists(self) -> list[str]:
        return [str(item) for item in self.artist_tree.selection()]

    def _pixiv_cookie(self) -> str | None:
        if not is_cookie_consent_recorded():
            return None
        value = self.pixiv_cookie_var.get().strip()
        return value or None

    def toggle_cookie_visibility(self) -> None:
        self.pixiv_cookie_entry.configure(show="" if self.show_cookie_var.get() else "*")

    def _apply_cookie_consent_state(self, accepted: bool) -> None:
        self.pixiv_cookie_entry.configure(state="normal" if accepted else "disabled")

    def _show_cookie_disclaimer(self, *, view_only: bool = False) -> bool:
        dialog = tk.Toplevel(self)
        dialog.title(self.t("disclaimer_title"))
        dialog.transient(self)
        dialog.resizable(False, False)

        body = tk.Text(dialog, wrap="word", width=70, height=18, padx=12, pady=10, borderwidth=0)
        body.insert("1.0", self.t("disclaimer_body"))
        body.configure(state="disabled")
        body.pack(fill="both", expand=True, padx=12, pady=(12, 6))

        outcome = {"accepted": False}
        button_row = ttk.Frame(dialog)
        button_row.pack(fill="x", padx=12, pady=(6, 12))

        def on_accept() -> None:
            outcome["accepted"] = True
            dialog.destroy()

        def on_decline() -> None:
            outcome["accepted"] = False
            dialog.destroy()

        if view_only:
            ttk.Button(button_row, text=self.t("disclaimer_close"), command=on_decline).pack(side="right")
        else:
            ttk.Button(button_row, text=self.t("disclaimer_decline"), command=on_decline).pack(side="right", padx=(6, 0))
            ttk.Button(button_row, text=self.t("disclaimer_accept"), command=on_accept).pack(side="right")

        dialog.protocol("WM_DELETE_WINDOW", on_decline)
        dialog.update_idletasks()
        try:
            parent_x = self.winfo_rootx()
            parent_y = self.winfo_rooty()
            parent_w = self.winfo_width()
            parent_h = self.winfo_height()
            x = parent_x + max(0, (parent_w - dialog.winfo_width()) // 2)
            y = parent_y + max(0, (parent_h - dialog.winfo_height()) // 2)
            dialog.geometry(f"+{x}+{y}")
        except tk.TclError:
            pass
        dialog.grab_set()
        self.wait_window(dialog)
        return outcome["accepted"]

    def on_cookie_consent_toggle(self) -> None:
        new_state = self.cookie_consent_var.get()
        if new_state:
            if is_cookie_consent_recorded():
                self._apply_cookie_consent_state(True)
                return
            if self._show_cookie_disclaimer(view_only=False):
                record_cookie_consent()
                self._apply_cookie_consent_state(True)
                self.log(self.t("consent_accepted_log"))
            else:
                self.cookie_consent_var.set(False)
                self._apply_cookie_consent_state(False)
            return

        if not messagebox.askyesno(
            self.t("consent_revoke_title"),
            self.t("consent_revoke_body"),
            parent=self,
        ):
            self.cookie_consent_var.set(True)
            self._apply_cookie_consent_state(True)
            return

        revoke_cookie_consent()
        self.pixiv_cookie_var.set("")
        clear_cookie()
        self._apply_cookie_consent_state(False)
        self.log(self.t("consent_revoked_log"))

    def _target_artist_ids(self) -> list[str]:
        return sorted(self.checked_artist_ids) if self.checked_artist_ids else self._selected_artists()

    def _visible_artist_ids(self) -> list[str]:
        return [str(item) for item in self.artist_tree.get_children("")]

    def select_all_visible_artists(self) -> None:
        artist_ids = self._visible_artist_ids()
        if not artist_ids:
            return
        self.checked_artist_ids.update(artist_ids)
        self.refresh_artists()
        self.log(self.t("selected_artists", count=len(artist_ids)))

    def clear_checked_artists(self) -> None:
        count = len(self.checked_artist_ids)
        if not count:
            return
        self.checked_artist_ids.clear()
        self.refresh_artists()
        self.log(self.t("cleared_checked_artists", count=count))

    def _save_settings_dict(self) -> dict:
        return {
            "language": self.language,
            "database": self.db_var.get(),
            "download_roots": [str(path) for path in self._download_roots()],
            "exclude_roots": [str(path) for path in self._exclude_roots()],
            "browser": self.browser_var.get(),
            "user_data_dir": self.user_data_dir_var.get(),
            "delay": self.delay_var.get(),
            "limit": self.limit_var.get(),
            "watch_interval": self.watch_interval_var.get(),
            "resolve_online": self.resolve_online_var.get(),
            "resolve_limit": self.resolve_limit_var.get(),
            "fuzzy_search": self.fuzzy_search_var.get(),
            "fuzzy_min_score": self.fuzzy_min_score_var.get(),
            "ssl_fallback": self.ssl_fallback_var.get(),
        }

    def save_current_settings(self, *, log_message: bool = True) -> None:
        self.settings = self._save_settings_dict()
        save_settings(self.settings)
        cookie_value = self.pixiv_cookie_var.get().strip()
        if cookie_value and is_cookie_consent_recorded():
            save_cookie(cookie_value)
        else:
            clear_cookie()
        if log_message and hasattr(self, "log_text"):
            self.log(self.t("settings_saved"))

    def on_language_change(self, _event=None) -> None:
        self.language = language_or_default(self.language_var.get())
        self.status_var.set(self.t("ready"))
        self.settings = self._save_settings_dict()
        save_settings(self.settings)
        for child in self.winfo_children():
            child.destroy()
        self.configure(menu="")
        self._build_ui()
        self._load_download_roots()
        self._load_exclude_roots()
        self.refresh_artists()

    def _build_menu(self) -> None:
        menubar = tk.Menu(self)
        settings_menu = tk.Menu(menubar, tearoff=False)
        language_submenu = tk.Menu(settings_menu, tearoff=False)
        for code in ("zh", "en"):
            language_submenu.add_radiobutton(
                label=LANGUAGE_LABELS[code],
                value=code,
                variable=self.language_var,
                command=self.on_language_change,
            )
        settings_menu.add_cascade(label=self.t("language_menu"), menu=language_submenu)
        settings_menu.add_separator()
        settings_menu.add_command(label=self.t("preferences_menu"), command=self.open_preferences)
        menubar.add_cascade(label=self.t("settings_menu"), menu=settings_menu)
        self.configure(menu=menubar)

    def open_preferences(self) -> None:
        snapshot = {
            "browser": self.browser_var.get(),
            "user_data_dir": self.user_data_dir_var.get(),
            "delay": float(self.delay_var.get()),
            "limit": int(self.limit_var.get()),
            "resolve_limit": int(self.resolve_limit_var.get()),
            "fuzzy_min_score": float(self.fuzzy_min_score_var.get()),
            "ssl_fallback": bool(self.ssl_fallback_var.get()),
        }

        dialog = tk.Toplevel(self)
        dialog.title(self.t("preferences_title"))
        dialog.transient(self)
        dialog.resizable(False, False)

        container = ttk.Frame(dialog, padding=14)
        container.grid(row=0, column=0, sticky="nsew")
        container.columnconfigure(1, weight=1)

        scan_box = ttk.LabelFrame(container, text=self.t("scan_options"), padding=10)
        scan_box.grid(row=0, column=0, columnspan=3, sticky="ew")
        scan_box.columnconfigure(1, weight=1)
        ttk.Label(scan_box, text=self.t("resolve_limit")).grid(row=0, column=0, sticky="w")
        ttk.Spinbox(scan_box, from_=1, to=10, increment=1, textvariable=self.resolve_limit_var, width=8).grid(
            row=0, column=1, sticky="w", padx=(8, 0)
        )
        ttk.Label(scan_box, text=self.t("fuzzy_min_score")).grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Spinbox(scan_box, from_=0.1, to=1.0, increment=0.05, textvariable=self.fuzzy_min_score_var, width=8).grid(
            row=1, column=1, sticky="w", padx=(8, 0), pady=(8, 0)
        )
        ttk.Checkbutton(
            scan_box,
            text=self.t("ssl_fallback"),
            variable=self.ssl_fallback_var,
        ).grid(row=2, column=0, columnspan=2, sticky="w", pady=(10, 0))

        browser_box = ttk.LabelFrame(container, text=self.t("browser"), padding=10)
        browser_box.grid(row=1, column=0, columnspan=3, sticky="ew", pady=(12, 0))
        browser_box.columnconfigure(1, weight=1)
        ttk.Label(browser_box, text=self.t("program")).grid(row=0, column=0, sticky="w")
        ttk.Entry(browser_box, textvariable=self.browser_var, width=42).grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Button(browser_box, text=self.t("choose"), command=self.choose_browser).grid(row=0, column=2)
        ttk.Label(browser_box, text=self.t("user_data")).grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Entry(browser_box, textvariable=self.user_data_dir_var, width=42).grid(row=1, column=1, sticky="ew", padx=8, pady=(8, 0))
        ttk.Button(browser_box, text=self.t("choose"), command=self.choose_user_data_dir).grid(row=1, column=2, pady=(8, 0))
        ttk.Button(browser_box, text=self.t("clear"), command=self.clear_user_data_dir).grid(row=1, column=3, padx=(6, 0), pady=(8, 0))
        open_row = ttk.Frame(browser_box)
        open_row.grid(row=2, column=0, columnspan=4, sticky="ew", pady=(10, 0))
        ttk.Label(open_row, text=self.t("open_delay")).grid(row=0, column=0, sticky="w")
        ttk.Spinbox(open_row, from_=0, to=30, increment=0.5, textvariable=self.delay_var, width=7).grid(row=0, column=1, padx=(8, 4))
        ttk.Label(open_row, text=self.t("seconds")).grid(row=0, column=2, sticky="w")
        ttk.Label(open_row, text=self.t("open_limit")).grid(row=0, column=3, sticky="w", padx=(16, 4))
        ttk.Spinbox(open_row, from_=1, to=9999, increment=1, textvariable=self.limit_var, width=7).grid(row=0, column=4, sticky="w")

        button_row = ttk.Frame(container)
        button_row.grid(row=2, column=0, columnspan=3, sticky="e", pady=(14, 0))

        def revert() -> None:
            self.browser_var.set(snapshot["browser"])
            self.user_data_dir_var.set(snapshot["user_data_dir"])
            self.delay_var.set(snapshot["delay"])
            self.limit_var.set(snapshot["limit"])
            self.resolve_limit_var.set(snapshot["resolve_limit"])
            self.fuzzy_min_score_var.set(snapshot["fuzzy_min_score"])
            self.ssl_fallback_var.set(snapshot["ssl_fallback"])

        def on_save() -> None:
            self.save_current_settings(log_message=False)
            dialog.destroy()

        def on_cancel() -> None:
            revert()
            dialog.destroy()

        ttk.Button(button_row, text=self.t("cancel"), command=on_cancel).pack(side="right", padx=(6, 0))
        ttk.Button(button_row, text=self.t("save"), command=on_save).pack(side="right")
        dialog.protocol("WM_DELETE_WINDOW", on_cancel)
        dialog.update_idletasks()
        try:
            x = self.winfo_rootx() + max(0, (self.winfo_width() - dialog.winfo_width()) // 2)
            y = self.winfo_rooty() + max(0, (self.winfo_height() - dialog.winfo_height()) // 2)
            dialog.geometry(f"+{x}+{y}")
        except tk.TclError:
            pass
        dialog.grab_set()
        self.wait_window(dialog)

    def choose_database(self) -> None:
        path = filedialog.asksaveasfilename(
            title=self.t("select_database"),
            defaultextension=".json",
            filetypes=[("JSON", "*.json"), (self.t("all_files"), "*.*")],
            initialfile=Path(self.db_var.get()).name,
        )
        if path:
            self.db_var.set(path)
            self.save_current_settings()
            self.refresh_artists()

    def choose_browser(self) -> None:
        path = filedialog.askopenfilename(
            title=self.t("select_browser"),
            filetypes=[(self.t("executable_files"), "*.exe"), (self.t("all_files"), "*.*")],
        )
        if path:
            self.browser_var.set(path)
            self.save_current_settings()

    def choose_user_data_dir(self) -> None:
        path = filedialog.askdirectory(title=self.t("select_user_data"))
        if path:
            if not self._is_safe_browser_user_data_dir(Path(path)):
                self.user_data_dir_var.set("")
                self.save_current_settings()
                messagebox.showwarning(self.t("unsafe_user_data_title"), self.t("unsafe_user_data_body"))
                return
            self.user_data_dir_var.set(path)
            self.save_current_settings()

    def clear_user_data_dir(self) -> None:
        self.user_data_dir_var.set("")
        self.save_current_settings()

    def _is_path_inside(self, path: Path, parent: Path) -> bool:
        try:
            path.resolve().relative_to(parent.resolve())
        except ValueError:
            return False
        return True

    def _is_safe_browser_user_data_dir(self, user_data_dir: Path | None = None) -> bool:
        raw_value = str(user_data_dir) if user_data_dir is not None else self.user_data_dir_var.get().strip()
        if not raw_value:
            return True
        value = Path(raw_value)
        for root in self._download_roots():
            if value.resolve() == root.resolve() or self._is_path_inside(value, root):
                return False
        return True

    def add_download_root(self) -> None:
        path = filedialog.askdirectory(title=self.t("select_download_folder"))
        if not path:
            return
        current = set(self.root_listbox.get(index) for index in range(self.root_listbox.size()))
        if path not in current:
            self.root_listbox.insert(tk.END, path)
            self.save_current_settings()

    def remove_download_root(self) -> None:
        for index in reversed(self.root_listbox.curselection()):
            self.root_listbox.delete(index)
        self.save_current_settings()

    def add_exclude_root(self) -> None:
        path = filedialog.askdirectory(title=self.t("select_exclude_folder"))
        if not path:
            return
        current = set(self.exclude_listbox.get(index) for index in range(self.exclude_listbox.size()))
        if path not in current:
            self.exclude_listbox.insert(tk.END, path)
            self.save_current_settings()

    def remove_exclude_root(self) -> None:
        for index in reversed(self.exclude_listbox.curselection()):
            self.exclude_listbox.delete(index)
        self.save_current_settings()

    def _run_worker(self, label: str, work: Callable[[], object]) -> None:
        if self.worker_thread and self.worker_thread.is_alive():
            messagebox.showinfo(
                self.t("running_title"),
                self.t("running_body", task=self.current_task_label or self.status_var.get() or label),
            )
            return

        def target() -> None:
            if label == self.t("scan"):
                status = self.t("scanning")
            elif label == self.t("check_updates"):
                status = self.t("checking_updates")
            elif label == self.t("download_updated"):
                status = self.t("downloading_updates")
            else:
                status = f"{label}..."
            self.message_queue.put(("status", status))
            try:
                result = work()
            except Exception as exc:  # noqa: BLE001
                self.message_queue.put(("error", str(exc)))
            else:
                self.message_queue.put(("worker_done", (label, result)))

        self.current_task_label = label
        self.worker_thread = threading.Thread(target=target, daemon=True)
        self.worker_thread.start()

    def _progress_callback(self, key: str, payload: dict[str, object]) -> None:
        self.message_queue.put(("progress", (key, payload)))

    def _validate_roots(self, roots: list[Path]) -> bool:
        if not roots:
            messagebox.showwarning(self.t("missing_folder_title"), self.t("missing_folder_body"))
            return False
        missing = [str(path) for path in roots if not path.exists()]
        if missing:
            messagebox.showerror(self.t("folder_not_found"), "\n".join(missing))
            return False
        return True

    def scan_once(self) -> None:
        roots = self._download_roots()
        if not self._validate_roots(roots):
            return
        exclude_roots = self._exclude_roots()
        self.save_current_settings()
        pixiv_cookie = self._pixiv_cookie()
        self._run_worker(
            self.t("scan"),
            lambda: scan_into_database(
                roots,
                self.db_path,
                resolve_online=self.resolve_online_var.get(),
                resolve_limit=self.resolve_limit_var.get(),
                pixiv_cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=self.ssl_fallback_var.get(),
                exclude_roots=exclude_roots,
                fuzzy_search_names=self.fuzzy_search_var.get(),
                fuzzy_min_score=float(self.fuzzy_min_score_var.get()),
                progress_callback=self._progress_callback,
            ),
        )

    def start_watch(self) -> None:
        roots = self._download_roots()
        if not self._validate_roots(roots):
            return
        if self.watch_thread and self.watch_thread.is_alive():
            return

        exclude_roots = self._exclude_roots()
        self.save_current_settings()
        self.watch_stop = threading.Event()
        interval = max(5, int(self.watch_interval_var.get()))
        db_path = self.db_path
        resolve_online = self.resolve_online_var.get()
        resolve_limit = self.resolve_limit_var.get()
        ssl_fallback = self.ssl_fallback_var.get()
        fuzzy_search = self.fuzzy_search_var.get()
        fuzzy_min_score = float(self.fuzzy_min_score_var.get())
        pixiv_cookie = self._pixiv_cookie()

        def target() -> None:
            self.message_queue.put(("status", self.t("watching")))
            while self.watch_stop and not self.watch_stop.is_set():
                try:
                    result = scan_into_database(
                        roots,
                        db_path,
                        resolve_online=resolve_online,
                        resolve_limit=resolve_limit,
                        pixiv_cookie=pixiv_cookie,
                        allow_insecure_ssl_fallback=ssl_fallback,
                        exclude_roots=exclude_roots,
                        fuzzy_search_names=fuzzy_search,
                        fuzzy_min_score=fuzzy_min_score,
                        progress_callback=self._progress_callback,
                    )
                except Exception as exc:  # noqa: BLE001
                    self.message_queue.put(("error", str(exc)))
                    break
                self.message_queue.put(("watch_scan", result))
                if self.watch_stop.wait(interval):
                    break
            self.message_queue.put(("watch_stopped", None))

        self.watch_thread = threading.Thread(target=target, daemon=True)
        self.watch_thread.start()
        self.watch_button.configure(state=tk.DISABLED)
        self.stop_watch_button.configure(state=tk.NORMAL)
        self.log(self.t("watch_started", seconds=interval))

    def stop_watch(self) -> None:
        if self.watch_stop:
            self.watch_stop.set()
        self.status_var.set(self.t("stopping_watch"))

    def add_artist(self) -> None:
        artist_id = simpledialog.askstring(self.t("add_artist_title"), self.t("artist_id_prompt"), parent=self)
        if not artist_id:
            return
        artist_id = artist_id.strip()
        if not artist_id.isdigit():
            messagebox.showerror(self.t("format_error"), self.t("artist_id_digits"))
            return
        name = simpledialog.askstring(self.t("add_artist_title"), self.t("artist_name_prompt"), parent=self)
        db = ArtistDatabase.load(self.db_path)
        changed = db.upsert(artist_id, name=(name or "").strip() or None, source="manual")
        db.save()
        self.refresh_artists()
        self.log(f"{artist_id} {self.t('updated') if changed else self.t('already_present')}")

    def show_artist_context_menu(self, event) -> None:
        item = self.artist_tree.identify_row(event.y)
        if item:
            if item not in self.artist_tree.selection():
                self.artist_tree.selection_set(item)
            self.context_menu.tk_popup(event.x_root, event.y_root)

    def edit_selected_artist_id(self) -> None:
        selected = self._selected_artists()
        if not selected:
            return
        old_id = selected[0]
        new_id = simpledialog.askstring(
            self.t("edit_artist_id"),
            self.t("new_artist_id_prompt"),
            parent=self,
            initialvalue=old_id,
        )
        if not new_id:
            return
        new_id = new_id.strip()
        if not new_id.isdigit():
            messagebox.showerror(self.t("format_error"), self.t("artist_id_digits"))
            return
        try:
            db = ArtistDatabase.load(self.db_path)
            changed = db.rename_artist_id(old_id, new_id)
            if new_id in db.artists:
                try:
                    profile = fetch_user_profile(
                        new_id,
                        cookie=self._pixiv_cookie(),
                        allow_insecure_ssl_fallback=self.ssl_fallback_var.get(),
                    )
                    if profile.name and profile.name != new_id:
                        db.artists[new_id].name = profile.name
                        self.log(self.t("artist_name_auto_updated", name=profile.name))
                except PixivResolveError as exc:
                    self.log(self.t("artist_name_auto_update_failed", error=exc))
            db.save()
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror(self.t("format_error"), self.t("artist_id_change_failed", error=exc))
            return
        if old_id in self.checked_artist_ids:
            self.checked_artist_ids.remove(old_id)
            self.checked_artist_ids.add(new_id)
        self.refresh_artists()
        if changed:
            self.log(self.t("artist_id_changed", old_id=old_id, new_id=new_id))

    def edit_selected_save_path(self) -> None:
        selected = self._selected_artists()
        if not selected:
            return
        artist_id = selected[0]
        db = ArtistDatabase.load(self.db_path)
        artist = db.artists.get(artist_id)
        initial_dir = artist.save_paths[0] if artist and artist.save_paths else ""
        path = filedialog.askdirectory(title=self.t("select_save_path"), initialdir=initial_dir or None)
        if not path:
            return
        try:
            changed = db.set_artist_save_path(artist_id, path)
            db.save()
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror(self.t("format_error"), self.t("save_path_change_failed", error=exc))
            return
        self.refresh_artists()
        if changed:
            self.log(self.t("save_path_changed", artist=artist.name if artist and artist.name else artist_id, path=path))

    def _load_artists(self) -> list[ArtistRecord]:
        try:
            db = ArtistDatabase.load(self.db_path)
        except Exception as exc:  # noqa: BLE001
            self.log(self.t("db_read_failed", error=exc))
            return []
        artists = db.get_many()
        keyword = self.search_var.get().strip().lower()
        if not keyword:
            return artists
        return [
            artist
            for artist in artists
            if keyword in artist.id.lower() or keyword in (artist.name or "").lower()
        ]

    def refresh_artists(self) -> None:
        selected = set(self._selected_artists())
        self.artist_tree.delete(*self.artist_tree.get_children())
        artists = self._load_artists()
        for artist in artists:
            is_checked = artist.id in self.checked_artist_ids
            self.artist_tree.insert(
                "",
                tk.END,
                iid=artist.id,
                text="",
                image=self.checkbox_images["checked" if is_checked else "unchecked"],
                tags=("checked",) if is_checked else (),
                values=(
                    artist.id,
                    artist.name or "",
                    len(artist.work_ids),
                    len(artist.new_work_ids),
                    "; ".join(artist.save_paths),
                    artist.last_seen,
                    artist.last_opened or "",
                ),
            )
        for artist_id in selected:
            if self.artist_tree.exists(artist_id):
                self.artist_tree.selection_add(artist_id)
        self.status_var.set(self.t("artist_count", count=len(artists)))

    def on_artist_tree_click(self, event):
        region = self.artist_tree.identify_region(event.x, event.y)
        if region not in {"tree", "cell"}:
            return None
        if self.artist_tree.identify_column(event.x) != "#0":
            return None
        item = self.artist_tree.identify_row(event.y)
        if not item:
            return "break"
        if item in self.checked_artist_ids:
            self.checked_artist_ids.remove(item)
        else:
            self.checked_artist_ids.add(item)
        self.refresh_artists()
        return "break"

    def open_double_clicked_artist(self, event):
        artist_id = self.artist_tree.identify_row(event.y)
        if not artist_id:
            return "break"
        self.artist_tree.focus(artist_id)
        self.artist_tree.selection_set(artist_id)
        self._open_artist_ids([str(artist_id)])
        return "break"

    def _open_artist_ids(self, artist_ids: list[str]) -> None:
        if not artist_ids:
            messagebox.showinfo(self.t("no_selection_title"), self.t("no_selection_body"))
            return
        if not self._is_safe_browser_user_data_dir():
            self.user_data_dir_var.set("")
            self.save_current_settings()
            messagebox.showwarning(self.t("unsafe_user_data_title"), self.t("unsafe_user_data_body"))
            return

        self.save_current_settings()

        def target() -> None:
            try:
                busy = bool(self.worker_thread and self.worker_thread.is_alive())
                db = ArtistDatabase.load(self.db_path)
                artists = db.get_many(artist_ids)
                open_urls(
                    [artist.pixiv_url for artist in artists],
                    browser=self.browser_var.get().strip() or None,
                    user_data_dir=self.user_data_dir_var.get().strip() or None,
                    delay_seconds=max(0.0, float(self.delay_var.get())),
                )
                if not busy:
                    now = utc_now()
                    for artist in artists:
                        artist.last_opened = now
                    db.save()
                self.message_queue.put(("open_done", len(artists)))
            except Exception as exc:  # noqa: BLE001
                self.message_queue.put(("error", str(exc)))

        threading.Thread(target=target, daemon=True).start()

    def open_selected_artists(self) -> None:
        self._open_artist_ids(self._target_artist_ids())

    def open_all_artists(self) -> None:
        db = ArtistDatabase.load(self.db_path)
        artists = db.get_many()
        limit = max(1, int(self.limit_var.get()))
        self._open_artist_ids([artist.id for artist in artists[:limit]])

    def open_updated_artists(self) -> None:
        db = ArtistDatabase.load(self.db_path)
        selected = self._target_artist_ids()
        artists = db.get_many(selected or None)
        artist_ids = [artist.id for artist in artists if artist.new_work_ids]
        if not artist_ids:
            messagebox.showinfo(self.t("no_data_title"), self.t("no_updated_artists"))
            return
        self._open_artist_ids(artist_ids)

    def check_updates(self) -> None:
        selected = self._target_artist_ids()
        pixiv_cookie = self._pixiv_cookie()

        def work() -> UpdateCheckResult:
            return check_artist_updates(
                self.db_path,
                artist_ids=selected or None,
                pixiv_cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=self.ssl_fallback_var.get(),
                progress_callback=self._progress_callback,
            )

        self.save_current_settings()
        self._run_worker(self.t("check_updates"), work)

    def download_updated_artists(self) -> None:
        db = ArtistDatabase.load(self.db_path)
        selected = self._target_artist_ids()
        artists = db.get_many(selected or None)
        artist_ids = [artist.id for artist in artists if artist.new_work_ids]
        if not artist_ids:
            messagebox.showinfo(self.t("no_data_title"), self.t("no_updated_artists"))
            return

        pixiv_cookie = self._pixiv_cookie()

        def work() -> DownloadUpdatesResult:
            return download_artist_updates(
                self.db_path,
                artist_ids=artist_ids,
                pixiv_cookie=pixiv_cookie,
                allow_insecure_ssl_fallback=self.ssl_fallback_var.get(),
                progress_callback=self._progress_callback,
            )

        self.save_current_settings()
        self._run_worker(self.t("download_updated"), work)

    def _current_or_all_urls(self) -> list[str]:
        db = ArtistDatabase.load(self.db_path)
        selected = self._target_artist_ids()
        artists = db.get_many(selected or None)
        return [artist.pixiv_url for artist in artists]

    def copy_urls(self) -> None:
        urls = self._current_or_all_urls()
        if not urls:
            return
        self.clipboard_clear()
        self.clipboard_append("\n".join(urls))
        self.log(self.t("copied_urls", count=len(urls)))

    def export_urls(self) -> None:
        urls = self._current_or_all_urls()
        if not urls:
            messagebox.showinfo(self.t("no_data_title"), self.t("no_export_body"))
            return
        path = filedialog.asksaveasfilename(
            title=self.t("export_urls"),
            defaultextension=".txt",
            filetypes=[(self.t("text_files"), "*.txt"), (self.t("all_files"), "*.*")],
            initialfile="pbd_update_urls.txt",
        )
        if not path:
            return
        output = Path(path)
        output.write_text("\n".join(urls) + "\n", encoding="utf-8")
        self.log(self.t("exported_urls", count=len(urls), path=output))

    def _format_scan_result(self, label: str, result: ScanResult) -> str:
        message = self.t(
            "scan_result",
            label=label,
            files=result.summary.files_seen,
            excluded=result.summary.excluded_dirs,
            matched=result.summary.files_matched,
            artists=len(result.summary.artists),
            name_only=len(result.summary.name_only_artists),
            resolved=result.resolved_name_only,
            changed=result.changed,
        )
        if result.ssl_fallback_used:
            message += self.t("ssl_retry_count", count=result.ssl_fallback_used)
        if result.fuzzy_resolved_name_only:
            message += self.t("fuzzy_resolved_count", count=result.fuzzy_resolved_name_only)
        if result.resolve_errors:
            message += self.t("resolve_error_count", count=len(result.resolve_errors))
        return message

    def _format_update_result(self, result: UpdateCheckResult) -> str:
        message = self.t(
            "update_check_result",
            checked=result.checked,
            artists=result.artists_with_updates,
            works=result.new_works,
        )
        if result.ssl_fallback_used:
            message += self.t("ssl_retry_count", count=result.ssl_fallback_used)
        if result.errors:
            message += self.t("resolve_error_count", count=len(result.errors))
        return message

    def _format_download_result(self, result: DownloadUpdatesResult) -> str:
        message = self.t(
            "download_result",
            artists=result.artists,
            artworks=result.artworks,
            pages=result.pages_saved,
            skipped=result.files_skipped,
        )
        if result.ssl_fallback_used:
            message += self.t("ssl_retry_count", count=result.ssl_fallback_used)
        if result.errors:
            message += self.t("resolve_error_count", count=len(result.errors))
        return message

    def _handle_worker_done(self, label: str, result: object) -> None:
        if isinstance(result, ScanResult):
            self.log(self._format_scan_result(label, result))
            for error in result.resolve_errors:
                self.log(self.t("resolve_failed", error=error))
        elif isinstance(result, int):
            self.log(self.t("opened_artists", label=label, count=result))
        elif isinstance(result, UpdateCheckResult):
            self.log(self._format_update_result(result))
            for error in result.errors:
                self.log(self.t("update_check_failed", error=error))
        elif isinstance(result, DownloadUpdatesResult):
            self.log(self._format_download_result(result))
            for error in result.errors:
                self.log(self.t("download_failed", error=error))
        else:
            self.log(self.t("task_done", label=label))
        self.refresh_artists()
        self.status_var.set(self.t("ready"))
        self.current_task_label = None

    def _drain_queue(self) -> None:
        try:
            while True:
                kind, payload = self.message_queue.get_nowait()
                if kind == "status":
                    self.status_var.set(str(payload))
                elif kind == "error":
                    self.log(self.t("error_prefix", error=payload))
                    self.status_var.set(self.t("task_failed"))
                    self.current_task_label = None
                    messagebox.showerror(self.t("task_failed"), str(payload))
                elif kind == "worker_done":
                    label, result = payload  # type: ignore[misc]
                    self._handle_worker_done(str(label), result)
                elif kind == "progress":
                    key, values = payload  # type: ignore[misc]
                    self.log(self.t(str(key), **values))
                elif kind == "open_done":
                    self.log(self.t("browser_opened_background", count=payload))
                    self.refresh_artists()
                elif kind == "watch_scan":
                    result = payload
                    if isinstance(result, ScanResult):
                        self.log(self._format_scan_result(self.t("watch_scan"), result))
                        for error in result.resolve_errors:
                            self.log(self.t("resolve_failed", error=error))
                        self.refresh_artists()
                elif kind == "watch_stopped":
                    self.watch_button.configure(state=tk.NORMAL)
                    self.stop_watch_button.configure(state=tk.DISABLED)
                    self.status_var.set(self.t("ready"))
                    self.current_task_label = None
                    self.log(self.t("watch_stopped"))
        except queue.Empty:
            pass
        self.after(100, self._drain_queue)

    def log(self, message: str) -> None:
        self.log_text.insert(tk.END, f"{message}\n")
        self.log_text.see(tk.END)

    def _on_close(self) -> None:
        self.save_current_settings(log_message=False)
        if self.watch_stop:
            self.watch_stop.set()
        self.destroy()


def main() -> int:
    app = PixivPbdManagerApp()
    app.mainloop()
    return 0
