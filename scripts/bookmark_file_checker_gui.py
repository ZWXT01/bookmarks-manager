#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Win11 书签文件有效性检查 / 删除工具。

特性：
- 标准库实现，无第三方依赖；Windows Python 3.10+ 可直接运行。
- 支持浏览器导出的 Netscape HTML、项目 JSON 导出、普通文本 URL 列表。
- 检查逻辑尽量贴近本项目 src/checker.ts：
  1) 无协议时先尝试 https://，再尝试 http://；
  2) 先 HEAD，遇到 405/501/403/503/429 再 GET；
  3) 2xx/3xx 视为可用，其他 HTTP 状态视为失效；
  4) 使用浏览器风格请求头、超时、重试、并发。
- 检查完成后默认只显示失效书签，可勾选后删除；删除前自动生成 .bak 备份。
"""

from __future__ import annotations

import csv
import json
import os
import queue
import re
import shutil
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from html import escape as html_escape
from html import unescape as html_unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable, Iterable, Literal

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
    _TKINTER_IMPORT_ERROR: ImportError | None = None
except ImportError as exc:  # pragma: no cover - tkinter availability depends on Python install.
    # 允许无 tkinter 的环境导入本文件中的解析/渲染函数；真正启动 GUI 时再报错。
    tk = None  # type: ignore[assignment]
    filedialog = None  # type: ignore[assignment]
    messagebox = None  # type: ignore[assignment]
    ttk = None  # type: ignore[assignment]
    _TKINTER_IMPORT_ERROR = exc


CHECK_FALLBACK_HTTP_CODES = {405, 501, 403, 503, 429}
OK_HTTP_MIN = 200
OK_HTTP_MAX_EXCLUSIVE = 400
TRACKING_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "gclid",
    "fbclid",
}
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,"
    "image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-CH-UA": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

CheckStatus = Literal["pending", "checking", "ok", "fail", "skipped"]
ParsedFormat = Literal["netscape_html", "json", "text"]


@dataclass
class CheckResult:
    ok: bool
    http_code: int | None
    error: str | None
    final_url: str | None = None


@dataclass
class BookmarkEntry:
    uid: int
    url: str
    title: str
    category: str | None = None
    attrs: list[tuple[str, str | None]] = field(default_factory=list)
    line_index: int | None = None
    json_obj_id: int | None = None
    json_path: tuple[str | int, ...] | None = None
    status: CheckStatus = "pending"
    http_code: int | None = None
    error: str | None = None
    final_url: str | None = None


@dataclass
class FolderNode:
    name: str
    attrs: list[tuple[str, str | None]] = field(default_factory=list)
    items: list["FolderNode | BookmarkEntry"] = field(default_factory=list)


@dataclass
class ParsedBookmarkFile:
    path: Path
    format: ParsedFormat
    entries: list[BookmarkEntry]
    original_text: str
    root: FolderNode | None = None
    json_data: Any = None
    lines: list[str] | None = None
    newline: str = "\n"


class UrlCheckError(Exception):
    """Internal marker for URL check exceptions."""


def normalize_url_input(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return trimmed
    if re.match(r"^https?://", trimmed, re.IGNORECASE):
        return trimmed
    return f"https://{trimmed}"


def canonicalize_url(value: str) -> tuple[bool, str | None, str | None, str | None]:
    """Return (ok, canonical_url, normalized_url, reason). Mirrors src/url.ts."""
    normalized_url = normalize_url_input(value)
    try:
        parsed = urllib.parse.urlsplit(normalized_url)
    except ValueError:
        return False, None, None, "URL格式无效"

    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return False, None, None, "URL格式无效"

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return False, None, None, "URL格式无效"

    try:
        port = parsed.port
    except ValueError:
        return False, None, None, "URL格式无效"
    netloc = f"[{hostname}]" if ":" in hostname and not hostname.startswith("[") else hostname
    if parsed.username or parsed.password:
        userinfo = ""
        if parsed.username:
            userinfo += urllib.parse.quote(urllib.parse.unquote(parsed.username), safe="")
        if parsed.password:
            userinfo += ":" + urllib.parse.quote(urllib.parse.unquote(parsed.password), safe="")
        netloc = f"{userinfo}@{netloc}"
    if port and not ((parsed.scheme == "http" and port == 80) or (parsed.scheme == "https" and port == 443)):
        netloc = f"{netloc}:{port}"

    query_pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    kept_pairs = [(k, v) for k, v in query_pairs if k.lower() not in TRACKING_PARAMS]
    kept_pairs.sort(key=lambda pair: (pair[0], pair[1]))
    query = urllib.parse.urlencode(kept_pairs, doseq=True)

    path = parsed.path or ""
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    canonical = urllib.parse.urlunsplit((parsed.scheme.lower(), netloc, path, query, ""))
    return True, canonical, normalized_url, None


def build_url_candidates(raw_url: str) -> list[str]:
    raw = str(raw_url or "").strip()
    if not raw:
        return []

    ok, _canonical, normalized, _reason = canonicalize_url(raw)
    has_scheme = re.match(r"^https?://", raw, re.IGNORECASE) is not None
    candidates: list[str] = [normalized if ok and normalized else raw]
    if not has_scheme:
        http_candidate = f"http://{raw}"
        if http_candidate not in candidates:
            candidates.append(http_candidate)
    return candidates


def request_status(url: str, method: Literal["HEAD", "GET"], timeout_seconds: float) -> tuple[int, str | None]:
    request = urllib.request.Request(url, method=method, headers=BROWSER_HEADERS)
    # 使用系统 CA；不主动忽略证书错误，和项目 fetch 默认安全行为保持一致。
    context = ssl.create_default_context()
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds, context=context) as response:
            status = int(getattr(response, "status", response.getcode()))
            return status, response.geturl()
    except urllib.error.HTTPError as exc:
        # urllib 对 4xx/5xx 抛异常，但项目 fetch 会拿到 Response；这里转回状态码。
        return int(exc.code), exc.geturl()
    except TimeoutError as exc:
        raise UrlCheckError("超时") from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", None)
        if isinstance(reason, TimeoutError):
            raise UrlCheckError("超时") from exc
        if isinstance(reason, ssl.SSLError):
            raise UrlCheckError("TLS证书错误") from exc
        raise UrlCheckError("网络错误") from exc
    except ssl.SSLError as exc:
        raise UrlCheckError("TLS证书错误") from exc
    except Exception as exc:
        raise UrlCheckError("网络错误") from exc


def check_once(candidate: str, timeout_seconds: float) -> CheckResult:
    head_status, head_final_url = request_status(candidate, "HEAD", timeout_seconds)
    if head_status in CHECK_FALLBACK_HTTP_CODES:
        get_status, get_final_url = request_status(candidate, "GET", timeout_seconds)
        ok = OK_HTTP_MIN <= get_status < OK_HTTP_MAX_EXCLUSIVE
        return CheckResult(ok=ok, http_code=get_status, error=None if ok else f"HTTP {get_status}", final_url=get_final_url)

    ok = OK_HTTP_MIN <= head_status < OK_HTTP_MAX_EXCLUSIVE
    return CheckResult(ok=ok, http_code=head_status, error=None if ok else f"HTTP {head_status}", final_url=head_final_url)


def check_url(url: str, timeout_ms: int) -> CheckResult:
    raw = str(url or "").strip()
    if not raw:
        return CheckResult(ok=False, http_code=None, error="URL为空")

    candidates = build_url_candidates(raw)
    if not candidates:
        return CheckResult(ok=False, http_code=None, error="URL格式无效")

    timeout_seconds = max(0.1, timeout_ms / 1000)
    last = CheckResult(ok=False, http_code=None, error="网络错误")

    for candidate in candidates:
        try:
            result = check_once(candidate, timeout_seconds)
            last = result
            if result.ok:
                return result
        except UrlCheckError as exc:
            last = CheckResult(ok=False, http_code=None, error=str(exc))
        except ValueError:
            last = CheckResult(ok=False, http_code=None, error="URL格式无效")

    return last


def check_url_with_retry(url: str, timeout_ms: int, retries: int, retry_delay_ms: int) -> CheckResult:
    attempts = max(1, min(6, int(retries) + 1))
    last = CheckResult(ok=False, http_code=None, error="未知错误")
    for attempt in range(attempts):
        last = check_url(url, timeout_ms)
        if last.ok:
            return last
        if attempt < attempts - 1 and retry_delay_ms > 0:
            time.sleep(retry_delay_ms / 1000)
    return last


class NetscapeBookmarkParser(HTMLParser):
    def __init__(self, uid_factory: Callable[[], int]) -> None:
        super().__init__(convert_charrefs=False)
        self.uid_factory = uid_factory
        self.root = FolderNode(name="")
        self.stack: list[FolderNode] = [self.root]
        self.entries: list[BookmarkEntry] = []
        self._collecting: Literal["h3", "a"] | None = None
        self._text_parts: list[str] = []
        self._pending_h3_attrs: list[tuple[str, str | None]] = []
        self._pending_a_attrs: list[tuple[str, str | None]] = []
        self._pending_a_href: str = ""

    @property
    def current_node(self) -> FolderNode:
        return self.stack[-1]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_lower = tag.lower()
        if tag_lower == "h3":
            self._collecting = "h3"
            self._text_parts = []
            self._pending_h3_attrs = attrs[:]
        elif tag_lower == "a":
            href = ""
            for key, value in attrs:
                if key and key.lower() == "href" and value:
                    href = html_unescape(value.strip())
                    break
            self._collecting = "a"
            self._text_parts = []
            self._pending_a_attrs = attrs[:]
            self._pending_a_href = href

    def handle_endtag(self, tag: str) -> None:
        tag_lower = tag.lower()
        if tag_lower == "h3" and self._collecting == "h3":
            name = html_unescape("".join(self._text_parts)).strip()
            if name:
                node = FolderNode(name=name, attrs=self._pending_h3_attrs[:])
                self.current_node.items.append(node)
                self.stack.append(node)
            self._collecting = None
            self._text_parts = []
            self._pending_h3_attrs = []
        elif tag_lower == "a" and self._collecting == "a":
            title = html_unescape("".join(self._text_parts)).strip() or self._pending_a_href
            if self._pending_a_href:
                entry = BookmarkEntry(
                    uid=self.uid_factory(),
                    url=self._pending_a_href,
                    title=title,
                    category=self.current_category(),
                    attrs=self._pending_a_attrs[:],
                )
                self.current_node.items.append(entry)
                self.entries.append(entry)
            self._collecting = None
            self._text_parts = []
            self._pending_a_attrs = []
            self._pending_a_href = ""
        elif tag_lower == "dl":
            # 根 DL 没有对应 H3，不弹出 root。
            if len(self.stack) > 1:
                self.stack.pop()

    def handle_data(self, data: str) -> None:
        if self._collecting:
            self._text_parts.append(data)

    def handle_entityref(self, name: str) -> None:
        if self._collecting:
            self._text_parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if self._collecting:
            self._text_parts.append(f"&#{name};")

    def current_category(self) -> str | None:
        names = [node.name for node in self.stack[1:] if node.name]
        return "/".join(names) if names else None


def safe_title(title: str, url: str) -> str:
    title = (title or "").strip()
    return title or url


def is_probably_netscape_html(text: str) -> bool:
    return bool(re.search(r"NETSCAPE-Bookmark-file-1", text, re.IGNORECASE)) or bool(
        re.search(r"<DL\b", text, re.IGNORECASE) and re.search(r"<A\b[^>]*\bHREF\s*=", text, re.IGNORECASE)
    )


def is_probably_json(text: str) -> bool:
    stripped = text.lstrip("\ufeff\r\n\t ")
    return stripped.startswith("[") or stripped.startswith("{")


def detect_newline(text: str) -> str:
    if "\r\n" in text:
        return "\r\n"
    if "\r" in text:
        return "\r"
    return "\n"


def read_text_file(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def make_uid_factory() -> Callable[[], int]:
    next_uid = 1

    def uid() -> int:
        nonlocal next_uid
        value = next_uid
        next_uid += 1
        return value

    return uid


def parse_netscape_html(path: Path, text: str, uid_factory: Callable[[], int]) -> ParsedBookmarkFile:
    parser = NetscapeBookmarkParser(uid_factory)
    parser.feed(text)
    parser.close()
    return ParsedBookmarkFile(
        path=path,
        format="netscape_html",
        entries=parser.entries,
        original_text=text,
        root=parser.root,
        newline=detect_newline(text),
    )


def iter_json_bookmarks(data: Any, uid_factory: Callable[[], int]) -> list[BookmarkEntry]:
    entries: list[BookmarkEntry] = []

    def walk(node: Any, category_stack: list[str], path: tuple[str | int, ...]) -> None:
        if isinstance(node, list):
            for index, item in enumerate(node):
                walk(item, category_stack, path + (index,))
            return

        if not isinstance(node, dict):
            return

        raw_url = node.get("url") if isinstance(node.get("url"), str) else node.get("href")
        if isinstance(raw_url, str) and raw_url.strip():
            title = node.get("title") if isinstance(node.get("title"), str) else node.get("name")
            category = None
            for key in ("category_name", "categoryName", "category"):
                if isinstance(node.get(key), str) and node.get(key).strip():
                    category = node.get(key).strip()
                    break
            if category is None and category_stack:
                category = "/".join(category_stack)
            entries.append(
                BookmarkEntry(
                    uid=uid_factory(),
                    url=raw_url.strip(),
                    title=safe_title(str(title or ""), raw_url.strip()),
                    category=category,
                    json_obj_id=id(node),
                    json_path=path,
                )
            )

        # 支持项目 JSON、部分通用书签 JSON、Chrome Bookmarks JSON 的递归结构。
        next_stack = category_stack
        node_type = node.get("type")
        name = node.get("name") if isinstance(node.get("name"), str) else node.get("title")
        if node_type == "folder" and isinstance(name, str) and name.strip():
            next_stack = category_stack + [name.strip()]

        for child_key in ("bookmarks", "children"):
            children = node.get(child_key)
            if isinstance(children, list):
                walk(children, next_stack, path + (child_key,))

        roots = node.get("roots")
        if isinstance(roots, dict):
            for key, value in roots.items():
                walk(value, category_stack, path + ("roots", key))

    walk(data, [], ())
    return entries


def parse_json_file(path: Path, text: str, uid_factory: Callable[[], int]) -> ParsedBookmarkFile:
    data = json.loads(text)
    entries = iter_json_bookmarks(data, uid_factory)
    return ParsedBookmarkFile(path=path, format="json", entries=entries, original_text=text, json_data=data, newline=detect_newline(text))


def parse_text_lines(path: Path, text: str, uid_factory: Callable[[], int]) -> ParsedBookmarkFile:
    newline = detect_newline(text)
    # splitlines(True) 保留换行，便于删除后尽量保持原文件风格。
    lines = text.splitlines(keepends=True)
    if text and not lines:
        lines = [text]
    entries: list[BookmarkEntry] = []
    url_re = re.compile(r"https?://[^\s<>'\"]+", re.IGNORECASE)

    for index, line in enumerate(lines):
        trimmed = line.strip()
        if not trimmed:
            continue
        match = url_re.search(trimmed)
        if match:
            url = match.group(0)
            title = safe_title((trimmed[: match.start()] + trimmed[match.end() :]).strip(" -\t"), url)
        else:
            url = trimmed
            title = trimmed
        entries.append(BookmarkEntry(uid=uid_factory(), url=url, title=title, line_index=index))

    return ParsedBookmarkFile(path=path, format="text", entries=entries, original_text=text, lines=lines, newline=newline)


def parse_bookmark_file(path: Path) -> ParsedBookmarkFile:
    text = read_text_file(path)
    uid_factory = make_uid_factory()
    if is_probably_netscape_html(text):
        parsed = parse_netscape_html(path, text, uid_factory)
    elif is_probably_json(text):
        parsed = parse_json_file(path, text, uid_factory)
    else:
        parsed = parse_text_lines(path, text, uid_factory)

    if not parsed.entries:
        raise ValueError("未在文件中识别到书签 URL")
    return parsed


def render_attrs(attrs: Iterable[tuple[str, str | None]], forced: dict[str, str] | None = None) -> str:
    forced = {k.lower(): v for k, v in (forced or {}).items()}
    parts: list[str] = []
    seen: set[str] = set()
    for raw_key, raw_value in attrs:
        if not raw_key:
            continue
        key = raw_key.upper() if raw_key.lower() in {"href", "add_date", "last_modified", "icon", "icon_uri"} else raw_key
        lower = raw_key.lower()
        value = forced.get(lower, raw_value)
        seen.add(lower)
        if value is None:
            parts.append(html_escape(key, quote=True))
        else:
            parts.append(f'{html_escape(key, quote=True)}="{html_escape(str(value), quote=True)}"')
    for lower, value in forced.items():
        if lower not in seen:
            key = lower.upper() if lower == "href" else lower
            parts.insert(0 if lower == "href" else len(parts), f'{html_escape(key, quote=True)}="{html_escape(str(value), quote=True)}"')
    return (" " + " ".join(parts)) if parts else ""


def node_has_remaining_bookmarks(node: FolderNode, deleted_uids: set[int]) -> bool:
    for item in node.items:
        if isinstance(item, BookmarkEntry):
            if item.uid not in deleted_uids:
                return True
        elif node_has_remaining_bookmarks(item, deleted_uids):
            return True
    return False


def render_netscape_node(node: FolderNode, deleted_uids: set[int], indent: str) -> str:
    out: list[str] = []
    for item in node.items:
        if isinstance(item, BookmarkEntry):
            if item.uid in deleted_uids:
                continue
            attrs = render_attrs(item.attrs, {"href": item.url})
            out.append(f"{indent}<DT><A{attrs}>{html_escape(item.title)}</A>\n")
        else:
            if not node_has_remaining_bookmarks(item, deleted_uids):
                continue
            attrs = render_attrs(item.attrs)
            out.append(f"{indent}<DT><H3{attrs}>{html_escape(item.name)}</H3>\n")
            out.append(f"{indent}<DL><p>\n")
            out.append(render_netscape_node(item, deleted_uids, indent + "  "))
            out.append(f"{indent}</DL><p>\n")
    return "".join(out)


def render_netscape_html(parsed: ParsedBookmarkFile, deleted_uids: set[int]) -> str:
    if parsed.root is None:
        raise ValueError("Netscape HTML 内部结构缺失")
    out = [
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n",
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n',
        "<TITLE>Bookmarks</TITLE>\n",
        "<H1>Bookmarks</H1>\n",
        "<DL><p>\n",
        render_netscape_node(parsed.root, deleted_uids, "  "),
        "</DL><p>\n",
    ]
    text = "".join(out)
    if parsed.newline != "\n":
        text = text.replace("\n", parsed.newline)
    return text


def render_json_file(parsed: ParsedBookmarkFile, deleted_uids: set[int]) -> str:
    delete_paths = {
        entry.json_path
        for entry in parsed.entries
        if entry.uid in deleted_uids and entry.json_path is not None
    }
    data_copy = json.loads(json.dumps(parsed.json_data, ensure_ascii=False))

    delete_marker = object()

    def prune(node: Any, path: tuple[str | int, ...]) -> Any:
        if path in delete_paths:
            return delete_marker
        if isinstance(node, list):
            next_items = []
            for index, child in enumerate(node):
                pruned_child = prune(child, path + (index,))
                if pruned_child is delete_marker:
                    continue
                next_items.append(pruned_child)
            return next_items
        if isinstance(node, dict):
            next_obj: dict[str, Any] = {}
            for key, value in node.items():
                pruned_value = prune(value, path + (key,))
                if pruned_value is delete_marker:
                    continue
                next_obj[key] = pruned_value
            return next_obj
        return node

    pruned = prune(data_copy, ())
    text = json.dumps(pruned, ensure_ascii=False, indent=2)
    return text + parsed.newline


def render_text_file(parsed: ParsedBookmarkFile, deleted_uids: set[int]) -> str:
    if parsed.lines is None:
        raise ValueError("文本文件内部结构缺失")
    delete_line_indexes = {entry.line_index for entry in parsed.entries if entry.uid in deleted_uids and entry.line_index is not None}
    return "".join(line for index, line in enumerate(parsed.lines) if index not in delete_line_indexes)


def render_clean_file(parsed: ParsedBookmarkFile, deleted_uids: set[int]) -> str:
    if parsed.format == "netscape_html":
        return render_netscape_html(parsed, deleted_uids)
    if parsed.format == "json":
        return render_json_file(parsed, deleted_uids)
    return render_text_file(parsed, deleted_uids)


def backup_path_for(path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return path.with_name(f"{path.name}.bak-{stamp}")


def format_code(code: int | None) -> str:
    return "" if code is None else str(code)


def format_category(category: str | None) -> str:
    return category or ""


def short_text(value: str, max_len: int = 500) -> str:
    value = value or ""
    if len(value) <= max_len:
        return value
    return value[: max_len - 1] + "…"


class BookmarkCheckerApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("书签文件有效性检查管理工具")
        self.root.geometry("1180x720")
        self.root.minsize(960, 600)

        self.parsed: ParsedBookmarkFile | None = None
        self.entries_by_uid: dict[int, BookmarkEntry] = {}
        self.item_uid_by_iid: dict[str, int] = {}
        self.checked_uids: set[int] = set()
        self.result_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
        self.executor: ThreadPoolExecutor | None = None
        self.cancel_event = threading.Event()
        self.is_running = False
        self.processed_count = 0
        self.ok_count = 0
        self.fail_count = 0
        self._sort_reverse: dict[str, bool] = {}

        self.file_path_var = tk.StringVar(value="未选择文件")
        self.summary_var = tk.StringVar(value="请选择书签文件。")
        self.status_var = tk.StringVar(value="就绪")
        self.timeout_var = tk.StringVar(value="5000")
        self.retries_var = tk.StringVar(value="1")
        self.retry_delay_var = tk.StringVar(value="500")
        self.concurrency_var = tk.StringVar(value="30")
        self.show_all_var = tk.BooleanVar(value=False)
        self.search_var = tk.StringVar(value="")

        self._build_ui()
        self.root.after(100, self._poll_result_queue)

    def _build_ui(self) -> None:
        outer = ttk.Frame(self.root, padding=10)
        outer.pack(fill=tk.BOTH, expand=True)

        file_frame = ttk.LabelFrame(outer, text="1. 选择书签文件", padding=8)
        file_frame.pack(fill=tk.X)
        ttk.Label(file_frame, textvariable=self.file_path_var).pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(file_frame, text="打开文件...", command=self.open_file).pack(side=tk.RIGHT, padx=(8, 0))

        options = ttk.LabelFrame(outer, text="2. 检查参数（默认与项目接近）", padding=8)
        options.pack(fill=tk.X, pady=(8, 0))
        self._labeled_entry(options, "超时(ms)", self.timeout_var, 8).pack(side=tk.LEFT, padx=(0, 12))
        self._labeled_entry(options, "重试", self.retries_var, 5).pack(side=tk.LEFT, padx=(0, 12))
        self._labeled_entry(options, "重试延迟(ms)", self.retry_delay_var, 8).pack(side=tk.LEFT, padx=(0, 12))
        self._labeled_entry(options, "并发", self.concurrency_var, 5).pack(side=tk.LEFT, padx=(0, 12))
        ttk.Button(options, text="开始检查", command=self.start_check).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(options, text="取消", command=self.cancel_check).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Checkbutton(options, text="显示全部（否则仅失效）", variable=self.show_all_var, command=self.refresh_tree).pack(
            side=tk.RIGHT
        )

        filter_frame = ttk.Frame(outer)
        filter_frame.pack(fill=tk.X, pady=(8, 0))
        ttk.Label(filter_frame, text="搜索：").pack(side=tk.LEFT)
        search_entry = ttk.Entry(filter_frame, textvariable=self.search_var, width=36)
        search_entry.pack(side=tk.LEFT, padx=(4, 8))
        search_entry.bind("<KeyRelease>", lambda _event: self.refresh_tree())
        ttk.Button(filter_frame, text="清空搜索", command=self.clear_search).pack(side=tk.LEFT)
        ttk.Label(filter_frame, textvariable=self.summary_var).pack(side=tk.RIGHT)

        table_frame = ttk.Frame(outer)
        table_frame.pack(fill=tk.BOTH, expand=True, pady=(8, 0))
        columns = ("checked", "status", "code", "title", "url", "category", "error")
        self.tree = ttk.Treeview(table_frame, columns=columns, show="headings", selectmode="extended")
        headings = {
            "checked": "勾选",
            "status": "状态",
            "code": "HTTP",
            "title": "标题",
            "url": "URL",
            "category": "分类",
            "error": "错误",
        }
        widths = {
            "checked": 58,
            "status": 76,
            "code": 66,
            "title": 230,
            "url": 380,
            "category": 170,
            "error": 220,
        }
        for col in columns:
            self.tree.heading(col, text=headings[col], command=lambda c=col: self.sort_by_column(c))
            self.tree.column(col, width=widths[col], minwidth=50, anchor=tk.W, stretch=col in {"title", "url", "error"})
        self.tree.tag_configure("ok", foreground="#047857")
        self.tree.tag_configure("fail", foreground="#b91c1c")
        self.tree.tag_configure("pending", foreground="#475569")
        self.tree.bind("<Button-1>", self.on_tree_click)
        self.tree.bind("<space>", self.on_tree_space)
        self.tree.bind("<Double-1>", self.open_selected_url)

        y_scroll = ttk.Scrollbar(table_frame, orient=tk.VERTICAL, command=self.tree.yview)
        x_scroll = ttk.Scrollbar(table_frame, orient=tk.HORIZONTAL, command=self.tree.xview)
        self.tree.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        y_scroll.grid(row=0, column=1, sticky="ns")
        x_scroll.grid(row=1, column=0, sticky="ew")
        table_frame.rowconfigure(0, weight=1)
        table_frame.columnconfigure(0, weight=1)

        action_frame = ttk.Frame(outer)
        action_frame.pack(fill=tk.X, pady=(8, 0))
        ttk.Button(action_frame, text="全选当前失效", command=self.check_visible_failures).pack(side=tk.LEFT)
        ttk.Button(action_frame, text="取消勾选", command=self.uncheck_all).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(action_frame, text="反选当前列表", command=self.invert_visible).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(action_frame, text="删除勾选失效书签", command=self.delete_checked_failures).pack(side=tk.LEFT, padx=(18, 0))
        ttk.Button(action_frame, text="导出失效CSV...", command=self.export_failures_csv).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(action_frame, text="打开选中URL", command=self.open_selected_url).pack(side=tk.LEFT, padx=(8, 0))

        self.progress = ttk.Progressbar(action_frame, mode="determinate")
        self.progress.pack(side=tk.RIGHT, fill=tk.X, expand=True, padx=(12, 0))
        ttk.Label(outer, textvariable=self.status_var).pack(fill=tk.X, pady=(6, 0))

    def _labeled_entry(self, parent: ttk.Frame, label: str, variable: tk.StringVar, width: int) -> ttk.Frame:
        frame = ttk.Frame(parent)
        ttk.Label(frame, text=label).pack(side=tk.LEFT)
        ttk.Entry(frame, textvariable=variable, width=width).pack(side=tk.LEFT, padx=(4, 0))
        return frame

    def open_file(self) -> None:
        if self.is_running:
            messagebox.showwarning("正在检查", "请先取消或等待当前检查完成。")
            return
        filename = filedialog.askopenfilename(
            title="选择书签文件",
            filetypes=[
                ("书签/文本/JSON", "*.html *.htm *.json *.txt *.csv *.md"),
                ("HTML 书签", "*.html *.htm"),
                ("JSON", "*.json"),
                ("文本", "*.txt *.csv *.md"),
                ("所有文件", "*.*"),
            ],
        )
        if not filename:
            return
        path = Path(filename)
        try:
            parsed = parse_bookmark_file(path)
        except Exception as exc:
            messagebox.showerror("读取失败", f"无法解析书签文件：\n{exc}")
            return

        self.parsed = parsed
        self.entries_by_uid = {entry.uid: entry for entry in parsed.entries}
        self.checked_uids.clear()
        self.processed_count = 0
        self.ok_count = 0
        self.fail_count = 0
        self.show_all_var.set(True)
        self.file_path_var.set(str(path))
        self.progress.configure(maximum=len(parsed.entries), value=0)
        self.status_var.set(f"已载入 {len(parsed.entries)} 个书签，格式：{self.format_label(parsed.format)}")
        self.refresh_tree()

    def format_label(self, fmt: ParsedFormat) -> str:
        return {"netscape_html": "Netscape/浏览器 HTML", "json": "JSON", "text": "文本"}.get(fmt, fmt)

    def parse_int_option(self, variable: tk.StringVar, label: str, min_value: int, max_value: int) -> int | None:
        try:
            value = int(variable.get().strip())
        except ValueError:
            messagebox.showwarning("参数错误", f"{label} 必须是整数。")
            return None
        if value < min_value or value > max_value:
            messagebox.showwarning("参数错误", f"{label} 必须在 {min_value} 到 {max_value} 之间。")
            return None
        return value

    def start_check(self) -> None:
        if self.parsed is None:
            messagebox.showwarning("未选择文件", "请先打开书签文件。")
            return
        if self.is_running:
            messagebox.showinfo("正在检查", "检查已在运行。")
            return

        timeout_ms = self.parse_int_option(self.timeout_var, "超时", 1000, 60000)
        retries = self.parse_int_option(self.retries_var, "重试", 0, 5)
        retry_delay_ms = self.parse_int_option(self.retry_delay_var, "重试延迟", 0, 10000)
        concurrency = self.parse_int_option(self.concurrency_var, "并发", 1, 100)
        if None in (timeout_ms, retries, retry_delay_ms, concurrency):
            return

        for entry in self.parsed.entries:
            entry.status = "pending"
            entry.http_code = None
            entry.error = None
            entry.final_url = None
        self.checked_uids.clear()
        self.processed_count = 0
        self.ok_count = 0
        self.fail_count = 0
        self.cancel_event.clear()
        self.is_running = True
        self.show_all_var.set(True)
        self.progress.configure(maximum=len(self.parsed.entries), value=0)
        self.status_var.set("正在检查，请稍候...")
        self.refresh_tree()

        thread = threading.Thread(
            target=self._run_check_worker,
            args=(list(self.parsed.entries), timeout_ms, retries, retry_delay_ms, concurrency),
            daemon=True,
        )
        thread.start()

    def _run_check_worker(
        self,
        entries: list[BookmarkEntry],
        timeout_ms: int,
        retries: int,
        retry_delay_ms: int,
        concurrency: int,
    ) -> None:
        def task(entry: BookmarkEntry) -> tuple[int, CheckResult | None]:
            if self.cancel_event.is_set():
                return entry.uid, None
            self.result_queue.put(("checking", entry.uid))
            result = check_url_with_retry(entry.url, timeout_ms, retries, retry_delay_ms)
            return entry.uid, result

        try:
            with ThreadPoolExecutor(max_workers=concurrency) as executor:
                self.executor = executor
                futures = [executor.submit(task, entry) for entry in entries]
                for future in as_completed(futures):
                    if self.cancel_event.is_set():
                        # 已提交的任务无法安全中断；等待已运行任务自然超时结束，但不再更新成成功。
                        pass
                    try:
                        uid, result = future.result()
                    except Exception as exc:
                        self.result_queue.put(("result", (0, CheckResult(ok=False, http_code=None, error=str(exc) or "网络错误"))))
                        continue
                    self.result_queue.put(("result", (uid, result)))
        finally:
            self.result_queue.put(("done", self.cancel_event.is_set()))

    def cancel_check(self) -> None:
        if not self.is_running:
            return
        self.cancel_event.set()
        self.status_var.set("正在取消：已发出的请求需等待超时或返回。")

    def _poll_result_queue(self) -> None:
        try:
            while True:
                event, payload = self.result_queue.get_nowait()
                if event == "checking":
                    entry = self.entries_by_uid.get(int(payload))
                    if entry and entry.status == "pending":
                        entry.status = "checking"
                        self.update_tree_entry(entry)
                elif event == "result":
                    uid, result = payload
                    entry = self.entries_by_uid.get(int(uid)) if uid else None
                    if entry and result is not None:
                        entry.status = "ok" if result.ok else "fail"
                        entry.http_code = result.http_code
                        entry.error = result.error
                        entry.final_url = result.final_url
                        self.processed_count += 1
                        if result.ok:
                            self.ok_count += 1
                        else:
                            self.fail_count += 1
                        self.progress.configure(value=self.processed_count)
                        self.update_tree_entry(entry)
                        self.update_summary()
                elif event == "done":
                    canceled = bool(payload)
                    self.is_running = False
                    self.executor = None
                    self.show_all_var.set(False)
                    self.refresh_tree()
                    if canceled:
                        self.status_var.set(
                            f"已取消。已完成 {self.processed_count}/{len(self.entries_by_uid)}，失效 {self.fail_count}。"
                        )
                    else:
                        self.status_var.set(
                            f"检查完成。共 {len(self.entries_by_uid)}，可用 {self.ok_count}，失效 {self.fail_count}。"
                        )
                self.result_queue.task_done()
        except queue.Empty:
            pass
        self.root.after(100, self._poll_result_queue)

    def visible_entries(self) -> list[BookmarkEntry]:
        if self.parsed is None:
            return []
        keyword = self.search_var.get().strip().lower()
        entries = self.parsed.entries
        if not self.show_all_var.get():
            entries = [entry for entry in entries if entry.status == "fail"]
        if keyword:
            entries = [
                entry
                for entry in entries
                if keyword in entry.title.lower()
                or keyword in entry.url.lower()
                or keyword in (entry.category or "").lower()
                or keyword in (entry.error or "").lower()
            ]
        return entries

    def refresh_tree(self) -> None:
        self.tree.delete(*self.tree.get_children())
        self.item_uid_by_iid.clear()
        for entry in self.visible_entries():
            self.insert_tree_entry(entry)
        self.update_summary()

    def insert_tree_entry(self, entry: BookmarkEntry) -> None:
        mark = "☑" if entry.uid in self.checked_uids else "☐"
        values = (
            mark,
            self.status_label(entry.status),
            format_code(entry.http_code),
            short_text(entry.title, 240),
            short_text(entry.url, 420),
            short_text(format_category(entry.category), 160),
            short_text(entry.error or "", 260),
        )
        iid = self.tree.insert("", tk.END, values=values, tags=(entry.status,))
        self.item_uid_by_iid[iid] = entry.uid

    def update_tree_entry(self, entry: BookmarkEntry) -> None:
        for iid, uid in list(self.item_uid_by_iid.items()):
            if uid == entry.uid:
                if (not self.show_all_var.get() and entry.status != "fail") or not self.matches_search(entry):
                    self.tree.delete(iid)
                    self.item_uid_by_iid.pop(iid, None)
                else:
                    mark = "☑" if entry.uid in self.checked_uids else "☐"
                    self.tree.item(
                        iid,
                        values=(
                            mark,
                            self.status_label(entry.status),
                            format_code(entry.http_code),
                            short_text(entry.title, 240),
                            short_text(entry.url, 420),
                            short_text(format_category(entry.category), 160),
                            short_text(entry.error or "", 260),
                        ),
                        tags=(entry.status,),
                    )
                return
        # 当前过滤条件下可能尚未展示；必要时插入。
        if (self.show_all_var.get() or entry.status == "fail") and self.matches_search(entry):
            self.insert_tree_entry(entry)

    def matches_search(self, entry: BookmarkEntry) -> bool:
        keyword = self.search_var.get().strip().lower()
        if not keyword:
            return True
        return (
            keyword in entry.title.lower()
            or keyword in entry.url.lower()
            or keyword in (entry.category or "").lower()
            or keyword in (entry.error or "").lower()
        )

    def status_label(self, status: CheckStatus) -> str:
        return {
            "pending": "待检查",
            "checking": "检查中",
            "ok": "可用",
            "fail": "失效",
            "skipped": "跳过",
        }.get(status, status)

    def update_summary(self) -> None:
        total = len(self.entries_by_uid)
        visible = len(self.tree.get_children())
        checked_failures = sum(1 for uid in self.checked_uids if self.entries_by_uid.get(uid, None) and self.entries_by_uid[uid].status == "fail")
        self.summary_var.set(
            f"总数 {total} / 已查 {self.processed_count} / 可用 {self.ok_count} / 失效 {self.fail_count} / 当前显示 {visible} / 已勾选失效 {checked_failures}"
        )

    def on_tree_click(self, event: tk.Event[Any]) -> None:
        region = self.tree.identify("region", event.x, event.y)
        if region != "cell":
            return
        column = self.tree.identify_column(event.x)
        if column != "#1":
            return
        iid = self.tree.identify_row(event.y)
        if iid:
            self.toggle_iid(iid)

    def on_tree_space(self, _event: tk.Event[Any]) -> str:
        for iid in self.tree.selection():
            self.toggle_iid(iid)
        return "break"

    def toggle_iid(self, iid: str) -> None:
        uid = self.item_uid_by_iid.get(iid)
        if uid is None:
            return
        entry = self.entries_by_uid.get(uid)
        if not entry:
            return
        if entry.status != "fail":
            messagebox.showinfo("只能删除失效项", "为避免误删，只有检查结果为“失效”的书签可以勾选删除。")
            return
        if uid in self.checked_uids:
            self.checked_uids.remove(uid)
        else:
            self.checked_uids.add(uid)
        self.update_tree_entry(entry)
        self.update_summary()

    def check_visible_failures(self) -> None:
        for iid, uid in list(self.item_uid_by_iid.items()):
            entry = self.entries_by_uid.get(uid)
            if entry and entry.status == "fail":
                self.checked_uids.add(uid)
                self.update_tree_entry(entry)
        self.update_summary()

    def uncheck_all(self) -> None:
        self.checked_uids.clear()
        self.refresh_tree()

    def invert_visible(self) -> None:
        for _iid, uid in list(self.item_uid_by_iid.items()):
            entry = self.entries_by_uid.get(uid)
            if not entry or entry.status != "fail":
                continue
            if uid in self.checked_uids:
                self.checked_uids.remove(uid)
            else:
                self.checked_uids.add(uid)
        self.refresh_tree()

    def delete_checked_failures(self) -> None:
        if self.parsed is None:
            return
        delete_uids = {uid for uid in self.checked_uids if self.entries_by_uid.get(uid) and self.entries_by_uid[uid].status == "fail"}
        if not delete_uids:
            messagebox.showinfo("未勾选", "请先勾选要删除的失效书签。")
            return
        answer = messagebox.askyesno(
            "确认删除",
            f"将从文件中删除 {len(delete_uids)} 个失效书签。\n\n"
            "会先在同目录创建 .bak-时间戳 备份，然后覆盖原文件。是否继续？",
        )
        if not answer:
            return

        try:
            backup_path = backup_path_for(self.parsed.path)
            shutil.copy2(self.parsed.path, backup_path)
            new_text = render_clean_file(self.parsed, delete_uids)
            self.parsed.path.write_text(new_text, encoding="utf-8", newline="")
        except Exception as exc:
            messagebox.showerror("删除失败", f"写入文件失败：\n{exc}")
            return

        messagebox.showinfo("删除完成", f"已删除 {len(delete_uids)} 个失效书签。\n备份文件：{backup_path}")
        # 重新载入清理后的文件，避免内部结构仍包含已删项。
        try:
            reparsed = parse_bookmark_file(self.parsed.path)
        except Exception as exc:
            self.status_var.set(f"已删除，但重新载入失败：{exc}")
            return
        self.parsed = reparsed
        self.entries_by_uid = {entry.uid: entry for entry in reparsed.entries}
        self.checked_uids.clear()
        self.processed_count = 0
        self.ok_count = 0
        self.fail_count = 0
        self.progress.configure(maximum=len(reparsed.entries), value=0)
        self.show_all_var.set(True)
        self.status_var.set(f"已重新载入清理后的文件，剩余 {len(reparsed.entries)} 个书签。")
        self.refresh_tree()

    def export_failures_csv(self) -> None:
        failures = [entry for entry in self.entries_by_uid.values() if entry.status == "fail"]
        if not failures:
            messagebox.showinfo("无失效项", "当前没有可导出的失效书签。")
            return
        filename = filedialog.asksaveasfilename(
            title="导出失效书签 CSV",
            defaultextension=".csv",
            filetypes=[("CSV", "*.csv"), ("所有文件", "*.*")],
        )
        if not filename:
            return
        try:
            with open(filename, "w", newline="", encoding="utf-8-sig") as fh:
                writer = csv.writer(fh)
                writer.writerow(["title", "url", "category", "http_code", "error", "final_url"])
                for entry in failures:
                    writer.writerow([entry.title, entry.url, entry.category or "", entry.http_code or "", entry.error or "", entry.final_url or ""])
        except Exception as exc:
            messagebox.showerror("导出失败", str(exc))
            return
        messagebox.showinfo("导出完成", f"已导出：{filename}")

    def open_selected_url(self, _event: tk.Event[Any] | None = None) -> None:
        selection = self.tree.selection()
        if not selection:
            return
        uid = self.item_uid_by_iid.get(selection[0])
        entry = self.entries_by_uid.get(uid) if uid else None
        if not entry:
            return
        import webbrowser

        webbrowser.open(entry.url)

    def clear_search(self) -> None:
        self.search_var.set("")
        self.refresh_tree()

    def sort_by_column(self, column: str) -> None:
        reverse = not self._sort_reverse.get(column, False)
        self._sort_reverse[column] = reverse
        if self.parsed is None:
            return

        key_map: dict[str, Callable[[BookmarkEntry], Any]] = {
            "checked": lambda entry: entry.uid in self.checked_uids,
            "status": lambda entry: entry.status,
            "code": lambda entry: entry.http_code if entry.http_code is not None else -1,
            "title": lambda entry: entry.title.lower(),
            "url": lambda entry: entry.url.lower(),
            "category": lambda entry: (entry.category or "").lower(),
            "error": lambda entry: (entry.error or "").lower(),
        }
        self.parsed.entries.sort(key=key_map.get(column, key_map["title"]), reverse=reverse)
        self.refresh_tree()


def main() -> None:
    if tk is None:
        raise SystemExit("当前 Python 缺少 tkinter，建议安装 python.org 官方 Windows 版 Python。") from _TKINTER_IMPORT_ERROR
    root = tk.Tk()
    try:
        style = ttk.Style(root)
        if "vista" in style.theme_names():
            style.theme_use("vista")
    except tk.TclError:
        pass
    BookmarkCheckerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
