"""Flash and check a batch of Devices from the bench.

One watcher, started once on the Windows laptop next to the USB hub. Each NodeMCU that
appears on a new COM port is identified against the inventory sheet by its MAC, registered
under the Bench Campus, flashed with the one exported binary, and bench-checked over serial
against the live server. One row per board goes to `<sheet>.bench.csv` next to the sheet, and
Ctrl-C prints what the box and the sheet disagree on.

Needs Python 3.9 or newer with two packages:

    pip install esptool pyserial

Usage:

    set ADMIN_TOKEN=...            (PowerShell: $env:ADMIN_TOKEN = "...")
    python arduino\\bench.py --server http://<host> --inventory "device_log - device_log.csv"

`--bin` names the binary; it defaults to the IDE's exported `TemperatureAlarms.ino.bin` under
`build/` in the sketch folder. The Admin token comes only from `ADMIN_TOKEN`, never a flag.
"""

from __future__ import annotations

import argparse
import csv
import glob
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol, Tuple

# ----------------------------------------------------------------------------- identify

MAC_PATTERN = re.compile(r"\bMAC:\s*([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})")


def normalise_mac(mac: str) -> str:
    """`EC:FA:BC:21:A8:EB` from any of the usual spellings; the empty string from none."""
    digits = re.sub(r"[^0-9a-fA-F]", "", mac).upper()
    if len(digits) != 12:
        return ""
    return ":".join(digits[i : i + 2] for i in range(0, 12, 2))


def derive_hostname(mac: str) -> str:
    """The hostname the firmware derives: `ESP_` plus the MAC's last six hex digits, upper-cased."""
    return "ESP_" + normalise_mac(mac).replace(":", "")[-6:]


def mac_from_esptool_output(output: str) -> str | None:
    """The MAC esptool printed (`MAC: ec:fa:..`, padded in v5), normalised; None when it did not."""
    match = MAC_PATTERN.search(output)
    return normalise_mac(match.group(1)) if match else None


# ----------------------------------------------------------------------------- the sheet


class BenchError(Exception):
    """A reason the watcher cannot start or a board cannot be handled; the message is for the terminal."""


@dataclass(frozen=True)
class SheetRow:
    row: int  # as the spreadsheet shows it: the header is row 1
    hostname: str
    mac: str  # normalised


@dataclass(frozen=True)
class Seen:
    """One board the watcher identified, whether or not the sheet has it."""

    hostname: str
    mac: str


class Inventory:
    """The technician's sheet, read once and never written. A row without a MAC (a note, a blank) is not a board."""

    def __init__(self, rows: list[SheetRow]):
        self.rows = [row for row in rows if row.mac]
        self._by_mac = {row.mac: row for row in self.rows}

    @classmethod
    def from_text(cls, text: str) -> "Inventory":
        reader = csv.reader(io.StringIO(text))
        header = next(reader, None)
        if header is None:
            raise BenchError("the inventory sheet is empty")
        columns = {name.strip().lower(): index for index, name in enumerate(header)}
        if "mac" not in columns:
            raise BenchError("the inventory sheet has no MAC column: " + ", ".join(header))
        hostname_column = columns.get("hostname")
        rows = []
        for line, cells in enumerate(reader, start=2):
            mac = normalise_mac(cells[columns["mac"]]) if len(cells) > columns["mac"] else ""
            hostname = ""
            if hostname_column is not None and len(cells) > hostname_column:
                hostname = cells[hostname_column].strip().upper()
            rows.append(SheetRow(row=line, hostname=hostname, mac=mac))
        return cls(rows)

    @classmethod
    def from_file(cls, path: str) -> "Inventory":
        with open(path, newline="", encoding="utf-8-sig") as handle:
            return cls.from_text(handle.read())

    def find(self, mac: str) -> SheetRow | None:
        return self._by_mac.get(normalise_mac(mac))


def reconcile(inventory: Inventory, seen: list[Seen]) -> tuple[list[SheetRow], list[Seen]]:
    """The sheet rows no board answered for, and the boards (one per MAC) the sheet lacks."""
    seen_macs = {board.mac for board in seen}
    never_seen = [row for row in inventory.rows if row.mac not in seen_macs]
    not_on_list = []
    listed = set()
    for board in seen:
        if inventory.find(board.mac) is None and board.mac not in listed:
            listed.add(board.mac)
            not_on_list.append(board)
    return never_seen, not_on_list


# ----------------------------------------------------------------------------- the binary

SKETCH_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "TemperatureAlarms")
BINARY_NAME = "TemperatureAlarms.ino.bin"
SOURCE_SUFFIXES = (".ino", ".h", ".cpp", ".c")


def default_binary(sketch_dir: str = SKETCH_DIR) -> str:
    """The newest `TemperatureAlarms.ino.bin` the IDE exported under `build/`, or where one would be."""
    build_dir = os.path.join(sketch_dir, "build")
    exports = glob.glob(os.path.join(build_dir, "**", BINARY_NAME), recursive=True)
    if not exports:
        return os.path.join(build_dir, BINARY_NAME)
    return max(exports, key=os.path.getmtime)


def binary_problem(binary: str, sketch_dir: str = SKETCH_DIR) -> str | None:
    """Why the binary must not be flashed: missing, or older than a source file. None when it is fine."""
    if not os.path.isfile(binary):
        return f"the binary is missing: {binary} (Sketch > Export Compiled Binary in the IDE)"
    built_at = os.path.getmtime(binary)
    for name in sorted(os.listdir(sketch_dir)):
        if name.endswith(SOURCE_SUFFIXES) and os.path.getmtime(os.path.join(sketch_dir, name)) > built_at:
            return f"the binary is older than {name}: export it again"
    return None


# ----------------------------------------------------------------------------- the serial verdict

DEVICE_LINE = re.compile(r"^device: (ESP_[0-9A-F]{6})")
WIFI_CONNECTED_LINE = re.compile(r"^wifi: (re)?connected")
SENSOR_LINE = re.compile(r"^sensor: -?\d+(\.\d+)? F, \d+ %")
REPORT_LINE = re.compile(r"^report: (\d{3}|failed)\b")
REPORT_CREATED = "report: 201 created"

STOP_BINARY = "the Device token in the binary is not the server's DEVICE_TOKEN: fix config.h and export the binary again"
STOP_WIFI = "the first board never joined WiFi: fix the SSID or password in config.h and export the binary again (or start with another board, if this one is suspect)"
STOP_SERVER = "the server is unreachable from the bench WiFi: fix the server (or SERVER_URL in the binary)"
# A report status that stops the batch, and what it says to fix. Neither is the board's fault.
BATCH_STOP_STATUSES = {"401": STOP_BINARY, "failed": STOP_SERVER}


@dataclass(frozen=True)
class Verdict:
    kind: str  # PASS, FAIL, or STOP (the batch cannot go on)
    reason: str

    def __str__(self) -> str:
        return f"{self.kind} {self.reason}".rstrip()


def is_decisive(line: str) -> bool:
    """A line after which more serial cannot change the verdict, so the read may end early."""
    match = REPORT_LINE.match(line)
    return line.startswith(REPORT_CREATED) or bool(match and match.group(1) in BATCH_STOP_STATUSES)


def judge(lines: list[str], hostname: str, first_board: bool) -> Verdict:
    """The bench verdict for one board's serial log, read for the check window after a reset.

    PASS needs the derived hostname on a `device:` line, `wifi: connected`, a numeric `sensor:`
    line, and `report: 201 created`. A STOP is a fault of the batch, not the board: the binary,
    the WiFi, or the server.
    """
    statuses = [match.group(1) for match in map(REPORT_LINE.match, lines) if match]
    for status, reason in BATCH_STOP_STATUSES.items():
        if status in statuses:
            return Verdict("STOP", reason)
    devices = [match.group(1) for match in map(DEVICE_LINE.match, lines) if match]
    if not devices:
        return Verdict("FAIL", "did not boot")
    if hostname not in devices:
        return Verdict("FAIL", f"serial says {devices[-1]}")
    if not any(WIFI_CONNECTED_LINE.match(line) for line in lines):
        return Verdict("STOP", STOP_WIFI) if first_board else Verdict("FAIL", "no wifi")
    if not any(SENSOR_LINE.match(line) for line in lines):
        return Verdict("FAIL", "bad sensor")
    if "201" in statuses:
        return Verdict("PASS", "")
    if statuses:
        return Verdict("FAIL", f"report {statuses[-1]}")
    return Verdict("FAIL", "no report")


# ----------------------------------------------------------------------------- the server

BENCH_CAMPUS = {"name": "Bench", "shortcode": "BENCH"}
BENCH_CLOSET = "Unassigned"
HTTP_TIMEOUT_SECONDS = 10

Transport = Callable[[str, str, Optional[dict], str], Tuple[int, Any]]


def http_transport(method: str, url: str, body: dict | None, token: str) -> tuple[int, Any]:
    """One request with the standard library; the status and the decoded JSON body (or None)."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            return response.status, _decode(response.read())
    except urllib.error.HTTPError as error:
        return error.code, _decode(error.read())
    except (urllib.error.URLError, OSError) as error:
        raise BenchError(f"{method} {url} failed: {error.reason if hasattr(error, 'reason') else error}") from error


def _decode(raw: bytes) -> Any:
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return raw.decode(errors="replace")


class Server:
    """The backend's API as the bench needs it. The transport is swapped for a fake in the tests."""

    def __init__(self, base_url: str, admin_token: str, transport: Transport = http_transport):
        self.base_url = base_url.rstrip("/")
        self.admin_token = admin_token
        self._transport = transport
        self._bench_campus_id: int | None = None

    def _send(self, method: str, path: str, body: dict | None = None, token: str = "") -> tuple[int, Any]:
        return self._transport(method, self.base_url + path, body, token)

    def _admin(self, method: str, path: str, body: dict | None = None) -> tuple[int, Any]:
        status, payload = self._send(method, path, body, self.admin_token)
        if status == 401:
            raise BenchError("the server refused the Admin token: ADMIN_TOKEN is not the one in the stack's .env")
        return status, payload

    def health(self) -> None:
        status, payload = self._send("GET", "/api/health")
        if status != 200:
            raise BenchError(f"/api/health answered {status}: {payload}")

    def ensure_bench_campus(self) -> int:
        """The id of the Bench Campus, created once if the server lacks it.

        The create is always attempted, so a wrong Admin token is refused here, at startup, on
        every run: a 409 proves the token and says the Campus exists.
        """
        if self._bench_campus_id is not None:
            return self._bench_campus_id
        status, payload = self._admin("POST", "/api/campuses", BENCH_CAMPUS)
        if status == 201:
            self._bench_campus_id = payload["id"]
        elif status == 409:
            self._bench_campus_id = self._find_bench_campus()
        else:
            raise BenchError(f"could not create the Bench Campus: {status} {payload}")
        return self._bench_campus_id

    def _find_bench_campus(self) -> int:
        status, campuses = self._send("GET", "/api/campuses")
        if status != 200:
            raise BenchError(f"GET /api/campuses answered {status}: {campuses}")
        for campus in campuses:
            if campus.get("shortcode", "").upper() == BENCH_CAMPUS["shortcode"]:
                return campus["id"]
        raise BenchError("the server says a BENCH Campus exists but does not list it")

    def register(self, hostname: str, campus_id: int) -> str:
        """`registered` for a new Device, `already` when the hostname exists; anything else is an error."""
        status, payload = self._admin("POST", "/api/devices", {"hostname": hostname, "campusId": campus_id, "closet": BENCH_CLOSET})
        if status == 201:
            return "registered"
        if status == 409:
            return "already"
        raise BenchError(f"registering {hostname} answered {status}: {payload}")


# ----------------------------------------------------------------------------- one board

FLASH_BAUDS = (921600, 460800)
CHECK_SECONDS = 70  # two report attempts at a 30 s interval, plus the boot and the WiFi join
SERIAL_BAUD = 115200
LOG_COLUMNS = ["time", "port", "sheet_row", "hostname", "mac", "registered", "flashed", "verdict", "reason"]


class Tools(Protocol):
    """The esptool and serial layer: the one seam the tests fake."""

    def read_mac(self, port: str) -> str: ...

    def flash(self, port: str, binary: str, baud: int) -> None: ...

    def serial_lines(self, port: str, seconds: float, stop_when: Callable[[str], bool]) -> list[str]: ...


@dataclass
class BoardResult:
    port: str
    verdict: Verdict
    seen_at: str = field(default_factory=lambda: time.strftime("%Y-%m-%d %H:%M:%S"))
    sheet_row: int | None = None
    hostname: str = ""
    mac: str = ""
    registered: str = ""  # registered / already
    flashed: str = ""  # flashed / not flashed
    wifi_joined: bool = False  # serial showed `wifi: connected`, whatever the verdict

    @property
    def seen(self) -> Seen | None:
        return Seen(self.hostname, self.mac) if self.mac else None

    def line(self) -> str:
        """`COM7  row 12  ESP_7AED5B  registered  flashed  PASS`, in the firmware log's spirit."""
        return self.line_so_far(str(self.verdict))

    def line_so_far(self, then: str) -> str:
        if not self.mac:
            return "  ".join([self.port, "-", "-", "-", "-", then])
        where = f"row {self.sheet_row}" if self.sheet_row else "not on list"
        return "  ".join([self.port, where, self.hostname, self.registered or "-", self.flashed or "-", then])

    def row_for_log(self) -> list[str]:
        row = "" if self.sheet_row is None else str(self.sheet_row)
        return [self.seen_at, self.port, row, self.hostname, self.mac, self.registered, self.flashed, self.verdict.kind, self.verdict.reason]


def check_board(
    port: str,
    tools: Tools,
    server: Server,
    inventory: Inventory,
    binary: str,
    campus_id: int,
    is_first_board: Callable[[], bool],
    progress: Callable[[str], None] = lambda message: None,
) -> BoardResult:
    """Identify, register, flash, and bench-check the board on one port. Never raises: a fault is an ERROR row.

    `is_first_board` is asked when the serial log is judged, not when the board was plugged in:
    on a hub, another board may have proven the WiFi credentials in the meantime.
    """
    result = BoardResult(port=port, verdict=Verdict("ERROR", ""))
    try:
        result.mac = tools.read_mac(port)
        result.hostname = derive_hostname(result.mac)
        row = inventory.find(result.mac)
        result.sheet_row = row.row if row else None
        result.registered = server.register(result.hostname, campus_id)
        progress(result.line_so_far("flashing"))
        result.flashed = "not flashed"
        problem = ""
        for baud in FLASH_BAUDS:
            try:
                tools.flash(port, binary, baud)
                result.flashed = "flashed"
                break
            except BenchError as error:
                problem = str(error)
        if result.flashed != "flashed":
            raise BenchError(problem)
        progress(result.line_so_far(f"checking for {CHECK_SECONDS} s"))
        lines = tools.serial_lines(port, CHECK_SECONDS, is_decisive)
        result.wifi_joined = any(WIFI_CONNECTED_LINE.match(line) for line in lines)
        result.verdict = judge(lines, result.hostname, is_first_board())
    except BenchError as error:
        result.verdict = Verdict("ERROR", str(error))
    return result


class BenchLog:
    """`<sheet>.bench.csv` next to the sheet: one row per board seen, header written once."""

    def __init__(self, inventory_path: str):
        stem, _ = os.path.splitext(inventory_path)
        self.path = stem + ".bench.csv"
        self._lock = threading.Lock()

    def append(self, row: list[str]) -> None:
        with self._lock:
            new = not os.path.exists(self.path) or os.path.getsize(self.path) == 0
            with open(self.path, "a", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                if new:
                    writer.writerow(LOG_COLUMNS)
                writer.writerow(row)


# ----------------------------------------------------------------------------- esptool and serial

ESPTOOL_READ_TIMEOUT = 60
ESPTOOL_FLASH_TIMEOUT = 300


def _last_line(output: str) -> str:
    lines = [line.strip() for line in output.splitlines() if line.strip() and "Deprecated" not in line]
    return lines[-1] if lines else "no output"


class EspTools:
    """The real seam: esptool as a subprocess (one per board, so threads never share its stdout) and pyserial."""

    def _esptool(self, port: str, args: list[str], timeout: int) -> tuple[int, str]:
        # The underscore command names work in esptool 4 and, with a deprecation note, in 5.
        command = [sys.executable, "-m", "esptool", "--chip", "esp8266", "--port", port, *args]
        # Its own process group, so the console's Ctrl-C reaches the watcher and not a flash in flight.
        apart = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if sys.platform == "win32" else {"start_new_session": True}
        try:
            run = subprocess.run(command, capture_output=True, encoding="utf-8", errors="replace", timeout=timeout, **apart)
        except subprocess.TimeoutExpired as error:
            raise BenchError(f"esptool gave up after {timeout} s on {port}") from error
        return run.returncode, (run.stdout or "") + (run.stderr or "")

    def read_mac(self, port: str) -> str:
        code, output = self._esptool(port, ["--baud", "115200", "read_mac"], ESPTOOL_READ_TIMEOUT)
        mac = mac_from_esptool_output(output)
        if code != 0 or mac is None:
            raise BenchError(f"esptool could not read the MAC: {_last_line(output)}")
        return mac

    def flash(self, port: str, binary: str, baud: int) -> None:
        args = ["--baud", str(baud), "--after", "hard_reset", "write_flash", "0x0", binary]
        code, output = self._esptool(port, args, ESPTOOL_FLASH_TIMEOUT)
        if code != 0:
            raise BenchError(f"esptool failed at {baud} baud: {_last_line(output)}")

    def serial_lines(self, port: str, seconds: float, stop_when: Callable[[str], bool]) -> list[str]:
        import serial  # imported here so the unit tests run without pyserial

        lines: list[str] = []
        try:
            with serial.Serial(port, SERIAL_BAUD, timeout=1) as link:
                # Pulse reset the way esptool's hard reset does on a NodeMCU: RTS drives RST, DTR drives GPIO0.
                link.dtr = False
                link.rts = True
                time.sleep(0.1)
                link.reset_input_buffer()
                link.rts = False
                deadline = time.monotonic() + seconds
                while time.monotonic() < deadline:
                    raw = link.readline()
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="replace").strip()
                    lines.append(line)
                    if stop_when(line):
                        break
        except serial.SerialException as error:
            raise BenchError(f"serial on {port}: {error}") from error
        return lines


def list_serial_ports() -> list[str]:
    from serial.tools import list_ports

    return [port.device for port in list_ports.comports()]


# ----------------------------------------------------------------------------- the watcher

class Watcher:
    """Started once; every COM port that appears after that is handled on its own thread.

    The "first board of the run" for the WiFi stop rule is any board checked before one has
    joined WiFi: a board that never booted proves nothing about the credentials.
    """

    poll_seconds = 1.0

    def __init__(
        self,
        tools: Tools,
        server: Server,
        inventory: Inventory,
        binary: str,
        log: BenchLog,
        campus_id: int,
        list_ports: Callable[[], list[str]] = list_serial_ports,
    ):
        self.tools = tools
        self.server = server
        self.inventory = inventory
        self.binary = binary
        self.log = log
        self.campus_id = campus_id
        self.list_ports = list_ports
        self.seen: list[Seen] = []
        self.stop_reason: str | None = None
        self._wifi_proven = False
        self._stop = threading.Event()
        self._state_lock = threading.Lock()
        self._print_lock = threading.Lock()
        self._threads: list[threading.Thread] = []

    def say(self, message: str) -> None:
        with self._print_lock:
            print(message, flush=True)

    def _handle(self, port: str) -> None:
        try:
            result = check_board(
                port, self.tools, self.server, self.inventory, self.binary, self.campus_id,
                is_first_board=lambda: not self._wifi_proven, progress=self.say,
            )
        except Exception as error:  # a fault in the watcher itself must not take the batch down silently
            result = BoardResult(port=port, verdict=Verdict("ERROR", f"{type(error).__name__}: {error}"))
        with self._state_lock:
            if result.seen:  # the MAC was read, so the box holds this board whatever happened next
                self.seen.append(result.seen)
            if result.wifi_joined:
                self._wifi_proven = True
            if result.verdict.kind == "STOP":
                self.stop_reason = result.verdict.reason
                self._stop.set()
        self.log.append(result.row_for_log())
        self.say(result.line())

    def run(self) -> int:
        """Watch until Ctrl-C or a batch stop; the exit code is 1 after a batch stop."""
        known = set(self.list_ports())
        self.say(f"Watching for new serial ports ({len(known)} already present are ignored). Plug boards in; Ctrl-C to stop.")
        try:
            while not self._stop.is_set():
                current = set(self.list_ports())
                for port in sorted(current - known):
                    self.say(f"{port}  new port, identifying")
                    thread = threading.Thread(target=self._handle, args=(port,), name=port, daemon=True)
                    thread.start()
                    self._threads.append(thread)
                known = current  # a port that vanishes and comes back is a board to run again
                time.sleep(self.poll_seconds)
        except KeyboardInterrupt:
            self.say("\nStopping after the boards in progress finish (Ctrl-C again to abandon them).")
        self._stop.set()
        self._wait_for_boards()
        self._report()
        return 1 if self.stop_reason else 0

    def _wait_for_boards(self) -> None:
        try:
            for thread in self._threads:
                while thread.is_alive():
                    thread.join(0.5)  # short joins keep a second Ctrl-C deliverable on Windows
        except KeyboardInterrupt:
            self.say("Abandoning the boards in progress; their rows are not logged, and a flash cut short leaves a board to redo.")

    def _report(self) -> None:
        if self.stop_reason:
            bar = "=" * 72
            self.say(f"\n{bar}\nBATCH STOPPED: {self.stop_reason}\n{bar}")
        never_seen, not_on_list = reconcile(self.inventory, self.seen)
        self.say(f"\nBoards seen this run: {len({board.mac for board in self.seen})}. Log: {self.log.path}")
        self.say(f"Sheet rows never seen: {len(never_seen)}")
        for row in never_seen:
            self.say(f"  row {row.row}  {row.hostname or '-'}  {row.mac}")
        self.say(f"Boards seen that the sheet lacks: {len(not_on_list)}")
        for board in not_on_list:
            self.say(f"  {board.hostname}  {board.mac}")


# ----------------------------------------------------------------------------- main


def refuse_unless_ready(args: argparse.Namespace, admin_token: str) -> tuple[Server, Inventory, str]:
    """Every reason not to start, checked before a board is plugged in."""
    try:
        import esptool  # noqa: F401
        import serial  # noqa: F401
    except ImportError as error:
        raise BenchError(f"{error.name} is not installed: pip install esptool pyserial") from error
    if not admin_token.strip():
        raise BenchError("ADMIN_TOKEN is not set (it is never a flag): set it to the Admin token in the stack's .env")
    binary = os.path.abspath(args.bin or default_binary())
    problem = binary_problem(binary)
    if problem:
        raise BenchError(problem)
    if not os.path.isfile(args.inventory):
        raise BenchError(f"the inventory sheet is missing: {args.inventory}")
    inventory = Inventory.from_file(args.inventory)
    server = Server(args.server, admin_token.strip())
    server.health()
    return server, inventory, binary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Flash and bench-check a batch of Devices; see the docstring in bench.py.")
    parser.add_argument("--server", required=True, help="where the stack is served, e.g. http://alarms.local")
    parser.add_argument("--inventory", required=True, help="the inventory sheet (CSV with a MAC column); never modified")
    parser.add_argument("--bin", help="the exported firmware binary (default: the newest TemperatureAlarms.ino.bin under the sketch's build/)")
    args = parser.parse_args(argv)
    try:
        server, inventory, binary = refuse_unless_ready(args, os.environ.get("ADMIN_TOKEN", ""))
        campus_id = server.ensure_bench_campus()
    except BenchError as error:
        print(f"bench: not starting: {error}", file=sys.stderr)
        return 2
    print(f"Server {server.base_url} is up; Bench Campus id {campus_id}. Binary: {binary}. Sheet: {len(inventory.rows)} boards.", flush=True)
    watcher = Watcher(EspTools(), server, inventory, binary, BenchLog(args.inventory), campus_id)
    return watcher.run()


if __name__ == "__main__":
    sys.exit(main())
