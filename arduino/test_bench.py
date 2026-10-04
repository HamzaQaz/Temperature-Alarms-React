"""Unit tests for bench.py, run with `python -m unittest arduino/test_bench.py` from the repo root.

Nothing here touches a board: the esptool and serial layer is faked through the Tools seam.
"""

import csv
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bench  # noqa: E402


class HostnameDerivation(unittest.TestCase):
    def test_hostname_is_esp_plus_last_six_hex_digits_upper_cased(self):
        self.assertEqual(bench.derive_hostname("ec:fa:bc:21:a8:eb"), "ESP_21A8EB")

    def test_separators_and_case_do_not_matter(self):
        self.assertEqual(bench.derive_hostname("EC-FA-BC-21-A8-EB"), "ESP_21A8EB")
        self.assertEqual(bench.derive_hostname("ecfabc21a8eb"), "ESP_21A8EB")


class MacFromEsptoolOutput(unittest.TestCase):
    def test_reads_the_mac_line_from_esptool_v4_and_v5_output(self):
        v4 = "esptool.py v4.8.1\nConnecting....\nChip is ESP8266EX\nMAC: ec:fa:bc:21:a8:eb\nHard resetting via RTS pin...\n"
        v5 = "esptool v5.4.0\nConnecting....\nMAC:                ec:fa:bc:21:a8:eb\nHard resetting...\n"
        self.assertEqual(bench.mac_from_esptool_output(v4), "EC:FA:BC:21:A8:EB")
        self.assertEqual(bench.mac_from_esptool_output(v5), "EC:FA:BC:21:A8:EB")

    def test_no_mac_line_is_none(self):
        self.assertIsNone(bench.mac_from_esptool_output("A fatal error occurred: Failed to connect"))



SHEET = (
    "ID,HOSTNAME,MAC,Column 1,TESTED\r\n"
    "1,ESP_21A8EB,EC:FA:BC:21:A8:EB,,TRUE\r\n"
    "2,ESP_0FF1B8,8C:AA:B5:0F:F1:B8,,TRUE\r\n"
    "3,,,,\r\n"
    "4,ESP_A68D29,fc:f5:c4:a6:8d:29,,FALSE\r\n"
)


class SheetLookup(unittest.TestCase):
    def setUp(self):
        self.inventory = bench.Inventory.from_text(SHEET)

    def test_row_is_found_by_mac_in_any_spelling(self):
        row = self.inventory.find("8c-aa-b5-0f-f1-b8")
        self.assertEqual(row.row, 3)  # as the spreadsheet shows it: the header is row 1
        self.assertEqual(row.hostname, "ESP_0FF1B8")
        self.assertEqual(row.mac, "8C:AA:B5:0F:F1:B8")

    def test_lower_case_mac_on_the_sheet_still_matches(self):
        self.assertEqual(self.inventory.find("FC:F5:C4:A6:8D:29").row, 5)

    def test_board_not_on_the_sheet_is_none(self):
        self.assertIsNone(self.inventory.find("AA:BB:CC:DD:EE:FF"))

    def test_rows_without_a_mac_such_as_a_note_line_are_not_boards(self):
        inventory = bench.Inventory.from_text(SHEET + "Email me if you need help,,,,\r\n")
        self.assertEqual([row.row for row in inventory.rows], [2, 3, 5])

    def test_a_sheet_without_a_mac_column_is_refused(self):
        with self.assertRaises(bench.BenchError):
            bench.Inventory.from_text("ID,HOSTNAME\r\n1,ESP_21A8EB\r\n")


class Reconciliation(unittest.TestCase):
    def test_lists_sheet_rows_never_seen_and_boards_the_sheet_lacks(self):
        inventory = bench.Inventory.from_text(SHEET)
        seen = [
            bench.Seen(hostname="ESP_21A8EB", mac="EC:FA:BC:21:A8:EB"),
            bench.Seen(hostname="ESP_1234AB", mac="5C:CF:7F:12:34:AB"),
            bench.Seen(hostname="ESP_21A8EB", mac="EC:FA:BC:21:A8:EB"),  # replugged: still one board
        ]
        never_seen, not_on_list = bench.reconcile(inventory, seen)
        self.assertEqual([row.row for row in never_seen], [3, 5])  # row 4 has no MAC, so it is not a board
        self.assertEqual([board.hostname for board in not_on_list], ["ESP_1234AB"])


class BinaryStaleness(unittest.TestCase):
    def setUp(self):
        self.sketch = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.sketch)
        for name in ("TemperatureAlarms.ino", "config.h", "network.cpp"):
            self._write(name, when=1000)
        self.binary = os.path.join(self.sketch, "build", "esp8266.esp8266.nodemcuv2", "TemperatureAlarms.ino.bin")

    def _write(self, name, when):
        path = os.path.join(self.sketch, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as handle:
            handle.write("x")
        os.utime(path, (when, when))
        return path

    def test_fresh_binary_passes(self):
        self._write(self.binary, when=2000)
        self.assertIsNone(bench.binary_problem(self.binary, self.sketch))

    def test_missing_binary_is_named(self):
        problem = bench.binary_problem(self.binary, self.sketch)
        self.assertIn("missing", problem)
        self.assertIn("TemperatureAlarms.ino.bin", problem)

    def test_binary_older_than_a_source_file_names_the_file(self):
        self._write(self.binary, when=2000)
        self._write("config.h", when=3000)
        problem = bench.binary_problem(self.binary, self.sketch)
        self.assertIn("config.h", problem)
        self.assertIn("older", problem)

    def test_default_binary_is_the_newest_export_under_build(self):
        older = self._write(os.path.join("build", "a", "TemperatureAlarms.ino.bin"), when=2000)
        newer = self._write(os.path.join("build", "b", "TemperatureAlarms.ino.bin"), when=3000)
        self.assertEqual(bench.default_binary(self.sketch), newer)
        self.assertNotEqual(older, newer)

    def test_default_binary_without_an_export_points_at_where_it_would_be(self):
        expected = os.path.join(self.sketch, "build", "TemperatureAlarms.ino.bin")
        self.assertEqual(bench.default_binary(self.sketch), expected)


def boot_log(hostname="ESP_7AED5B", wifi=True, sensor="sensor: 72.5 F, 45 %", report="report: 201 created", device=True):
    lines = ["Temperature Alarms Device", "wifi: connecting to closet-net", "......"]
    if wifi:
        lines.append("wifi: connected, IP 10.1.2.3, hostname ESP-7AED5B")
    else:
        lines.append("wifi: not connected yet, will keep trying")
    if device:
        lines.append(f"device: {hostname} (register this hostname in Settings)")
    lines.append("report: every 30 s to http://alarms.local/api/readings")
    if wifi:
        lines += [sensor, report, sensor, report]
    return lines


class SerialVerdict(unittest.TestCase):
    def judge(self, lines, first_board=False, hostname="ESP_7AED5B"):
        return bench.judge(lines, hostname, first_board=first_board)

    def test_pass(self):
        verdict = self.judge(boot_log())
        self.assertEqual((verdict.kind, verdict.reason), ("PASS", ""))

    def test_boot_rom_garbage_before_the_log_does_not_matter(self):
        verdict = self.judge(["\x00��l�", "ets Jan  8 2013,rst cause:2, boot mode:(3,6)"] + boot_log())
        self.assertEqual(verdict.kind, "PASS")

    def test_no_numeric_sensor_line_is_fail_bad_sensor(self):
        verdict = self.judge(boot_log(sensor="sensor: read failed (NaN), sample skipped"))
        self.assertEqual((verdict.kind, verdict.reason), ("FAIL", "bad sensor"))

    def test_no_device_line_is_fail_did_not_boot(self):
        verdict = self.judge(["���"], first_board=True)
        self.assertEqual((verdict.kind, verdict.reason), ("FAIL", "did not boot"))

    def test_a_different_hostname_on_serial_is_fail(self):
        verdict = self.judge(boot_log(hostname="ESP_000000"))
        self.assertEqual(verdict.kind, "FAIL")
        self.assertIn("ESP_000000", verdict.reason)

    def test_401_stops_the_batch_naming_the_binary(self):
        verdict = self.judge(boot_log(report='report: 401 {"error":"Invalid token"}'))
        self.assertEqual(verdict.kind, "STOP")
        self.assertIn("binary", verdict.reason)
        self.assertIn("DEVICE_TOKEN", verdict.reason)

    def test_no_wifi_on_the_first_board_stops_the_batch_naming_the_wifi(self):
        verdict = self.judge(boot_log(wifi=False), first_board=True)
        self.assertEqual(verdict.kind, "STOP")
        self.assertIn("WiFi", verdict.reason)

    def test_no_wifi_on_a_later_board_is_that_board_failing(self):
        verdict = self.judge(boot_log(wifi=False), first_board=False)
        self.assertEqual((verdict.kind, verdict.reason), ("FAIL", "no wifi"))

    def test_report_failed_stops_the_batch_naming_the_server(self):
        verdict = self.judge(boot_log(report="report: failed, connection refused"))
        self.assertEqual(verdict.kind, "STOP")
        self.assertIn("server", verdict.reason)

    def test_another_report_status_is_fail_with_that_status(self):
        verdict = self.judge(boot_log(report='report: 404 {"error":"No device with hostname ESP_7AED5B"}'))
        self.assertEqual((verdict.kind, verdict.reason), ("FAIL", "report 404"))

    def test_no_report_within_the_window_is_fail(self):
        lines = boot_log()[:-4] + ["sensor: 72.5 F, 45 %"]
        self.assertEqual(self.judge(lines).reason, "no report")

    def test_decisive_lines_end_the_read_early(self):
        self.assertTrue(bench.is_decisive("report: 201 created"))
        self.assertTrue(bench.is_decisive("report: 401 {}"))
        self.assertTrue(bench.is_decisive("report: failed, connection refused"))
        self.assertFalse(bench.is_decisive("sensor: read failed (NaN), sample skipped"))
        self.assertFalse(bench.is_decisive("report: 404 {}"))


class FakeTools:
    """The esptool and serial seam, scripted: which MACs answer, which bauds fail, what serial says."""

    def __init__(self, mac="EC:FA:BC:7A:ED:5B", lines=None, failing_bauds=(), mac_error=None):
        self.mac = mac
        self.lines = boot_log() if lines is None else lines
        self.failing_bauds = set(failing_bauds)
        self.mac_error = mac_error
        self.flashed = []  # (port, binary, baud) of every attempt

    def read_mac(self, port):
        if self.mac_error:
            raise bench.BenchError(self.mac_error)
        return self.mac

    def flash(self, port, binary, baud):
        self.flashed.append((port, binary, baud))
        if baud in self.failing_bauds:
            raise bench.BenchError(f"esptool failed at {baud}")

    def serial_lines(self, port, seconds, stop_when):
        return self.lines


class FakeTransport:
    """Answers the server client as the backend would; records what was sent."""

    def __init__(self, campuses=None, device_status=201):
        self.campuses = campuses if campuses is not None else []
        self.device_status = device_status
        self.calls = []

    def __call__(self, method, url, body, token):
        assert url.startswith("http://alarms.local/api/"), url
        path = url[len("http://alarms.local"):]
        self.calls.append((method, path, body, token))
        if path == "/api/health":
            return 200, {"status": "ok", "database": "connected"}
        if path == "/api/campuses" and method == "GET":
            return 200, self.campuses
        if path == "/api/campuses" and method == "POST":
            if token != "tok":
                return 401, {"error": "Invalid token"}
            if any(campus["shortcode"] == body["shortcode"] for campus in self.campuses):
                return 409, {"error": "A campus with the shortcode BENCH already exists"}
            campus = {"id": 7, **body}
            self.campuses.append(campus)
            return 201, campus
        if path == "/api/devices" and method == "POST":
            if self.device_status == 201:
                return 201, {"id": 1, **body}
            return self.device_status, {"error": "as scripted"}
        raise AssertionError(f"unexpected {method} {path}")


class ServerClient(unittest.TestCase):
    def test_bench_campus_is_created_once_if_missing(self):
        transport = FakeTransport(campuses=[{"id": 1, "name": "Central High", "shortcode": "CHS"}])
        server = bench.Server("http://alarms.local/", "tok", transport)
        self.assertEqual(server.ensure_bench_campus(), 7)
        self.assertEqual(transport.calls[-1], ("POST", "/api/campuses", {"name": "Bench", "shortcode": "BENCH"}, "tok"))
        self.assertEqual(server.ensure_bench_campus(), 7)
        self.assertEqual(sum(1 for call in transport.calls if call[0] == "POST"), 1)

    def test_existing_bench_campus_is_reused(self):
        transport = FakeTransport(campuses=[{"id": 3, "name": "Bench", "shortcode": "BENCH"}])
        self.assertEqual(bench.Server("http://alarms.local", "tok", transport).ensure_bench_campus(), 3)

    def test_a_wrong_admin_token_is_refused_at_startup_even_when_bench_exists(self):
        transport = FakeTransport(campuses=[{"id": 3, "name": "Bench", "shortcode": "BENCH"}])
        with self.assertRaises(bench.BenchError) as raised:
            bench.Server("http://alarms.local", "wrong", transport).ensure_bench_campus()
        self.assertIn("ADMIN_TOKEN", str(raised.exception))

    def test_register_reports_registered_or_already(self):
        transport = FakeTransport()
        server = bench.Server("http://alarms.local", "tok", transport)
        self.assertEqual(server.register("ESP_7AED5B", 7), "registered")
        self.assertEqual(transport.calls[-1][2], {"hostname": "ESP_7AED5B", "campusId": 7, "closet": "Unassigned"})
        self.assertEqual(bench.Server("http://alarms.local", "tok", FakeTransport(device_status=409)).register("ESP_7AED5B", 7), "already")

    def test_a_refused_admin_token_is_a_bench_error_naming_it(self):
        with self.assertRaises(bench.BenchError) as raised:
            bench.Server("http://alarms.local", "tok", FakeTransport(device_status=401)).register("ESP_7AED5B", 7)
        self.assertIn("ADMIN_TOKEN", str(raised.exception))


class OneBoard(unittest.TestCase):
    def setUp(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        self.sheet = os.path.join(folder, "sheet.csv")
        with open(self.sheet, "w", newline="") as handle:
            handle.write(SHEET + "12,ESP_7AED5B,EC:FA:BC:7A:ED:5B,,\r\n")
        self.inventory = bench.Inventory.from_file(self.sheet)
        self.server = bench.Server("http://alarms.local", "tok", FakeTransport())

    def sheet_lines(self):
        with open(self.sheet, newline="") as handle:
            return handle.read().split("\r\n")

    def run_board(self, tools, port="COM7", first_board=False):
        return bench.check_board(port, tools, self.server, self.inventory, "/bin/fw.bin", campus_id=7, is_first_board=lambda: first_board)

    def test_the_verdict_line_reads_like_the_firmware_log(self):
        result = self.run_board(FakeTools())
        self.assertEqual(result.line(), "COM7  row 6  ESP_7AED5B  registered  flashed  PASS")
        self.assertEqual(result.row_for_log()[1:], ["COM7", "6", "ESP_7AED5B", "EC:FA:BC:7A:ED:5B", "registered", "flashed", "PASS", ""])
        self.assertTrue(self.sheet_lines()[5].startswith("12,ESP_7AED5B,EC:FA:BC:7A:ED:5B,,TRUE,TRUE,PASS "))

    def test_a_board_off_the_sheet_is_flagged_and_still_handled(self):
        tools = FakeTools(mac="5C:CF:7F:12:34:AB", lines=boot_log(hostname="ESP_1234AB", sensor="sensor: read failed (NaN), sample skipped"))
        server = bench.Server("http://alarms.local", "tok", FakeTransport(device_status=409))
        result = bench.check_board("COM9", tools, server, self.inventory, "/bin/fw.bin", campus_id=7, is_first_board=lambda: False)
        self.assertEqual(result.line(), "COM9  added row 7  ESP_1234AB  already  flashed  FAIL bad sensor")
        self.assertEqual(result.row_for_log()[2], "7")
        self.assertTrue(self.sheet_lines()[6].startswith("13,ESP_1234AB,5C:CF:7F:12:34:AB,,FALSE,TRUE,FAIL bad sensor "))

    def test_a_sheet_that_cannot_be_written_is_said_on_the_line(self):
        self.inventory.path = os.path.join(os.path.dirname(self.sheet), "missing", "sheet.csv")
        result = self.run_board(FakeTools())
        self.assertTrue(result.line().startswith("COM7  row 6  ESP_7AED5B  registered  flashed  PASS (sheet not updated: "))

    def test_flash_falls_back_to_460800_when_921600_fails(self):
        tools = FakeTools(failing_bauds={921600})
        result = self.run_board(tools)
        self.assertEqual([baud for _, _, baud in tools.flashed], [921600, 460800])
        self.assertEqual(result.flashed, "flashed")

    def test_flash_failing_at_both_bauds_is_an_error_row_not_a_stop(self):
        result = self.run_board(FakeTools(failing_bauds={921600, 460800}))
        self.assertEqual(result.flashed, "not flashed")
        self.assertEqual(result.verdict.kind, "ERROR")
        self.assertEqual(result.line(), "COM7  row 6  ESP_7AED5B  registered  not flashed  ERROR esptool failed at 460800")

    def test_a_port_esptool_cannot_talk_to_is_an_error_row(self):
        result = self.run_board(FakeTools(mac_error="esptool could not connect"))
        self.assertEqual(result.line(), "COM7  -  -  -  -  ERROR esptool could not connect")
        self.assertEqual(result.row_for_log()[1:], ["COM7", "", "", "", "", "", "ERROR", "esptool could not connect"])

    def test_first_board_is_asked_when_the_log_is_judged_not_when_the_board_appeared(self):
        proven = []
        tools = FakeTools(lines=boot_log(wifi=False))
        tools.serial_lines = lambda port, seconds, stop_when: proven.append(True) or boot_log(wifi=False)
        result = bench.check_board("COM7", tools, self.server, self.inventory, "/bin/fw.bin", campus_id=7, is_first_board=lambda: not proven)
        self.assertEqual((result.verdict.kind, result.verdict.reason), ("FAIL", "no wifi"))

    def test_a_stop_verdict_carries_through(self):
        result = self.run_board(FakeTools(lines=boot_log(wifi=False)), first_board=True)
        self.assertEqual(result.verdict.kind, "STOP")


class LogFile(unittest.TestCase):
    def test_log_sits_next_to_the_sheet_with_a_header_written_once(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        sheet = os.path.join(folder, "device_log - device_log.csv")
        log = bench.BenchLog(sheet)
        self.assertEqual(log.path, os.path.join(folder, "device_log - device_log.bench.csv"))
        log.append(["2026-09-10 14:02:11", "COM7", "12", "ESP_7AED5B", "EC:FA:BC:7A:ED:5B", "registered", "flashed", "PASS", ""])
        bench.BenchLog(sheet).append(["2026-09-10 14:03:40", "COM9", "", "ESP_1234AB", "5C:CF:7F:12:34:AB", "already", "flashed", "FAIL", "bad sensor"])
        with open(log.path, newline="") as handle:
            rows = list(csv.reader(handle))
        self.assertEqual(rows[0], bench.LOG_COLUMNS)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[2][3], "ESP_1234AB")


class ScriptedPorts:
    """What list_ports answers on each poll; Ctrl-C arrives as a KeyboardInterrupt from a poll.

    A callable in the script runs before the next poll is answered, e.g. to let the boards in progress finish.
    """

    def __init__(self, polls):
        self.polls = list(polls)

    def __call__(self):
        while self.polls and callable(self.polls[0]):
            self.polls.pop(0)()
        answer = self.polls.pop(0) if self.polls else KeyboardInterrupt
        if answer is KeyboardInterrupt:
            raise KeyboardInterrupt
        return answer


class PerPortTools(FakeTools):
    def __init__(self, by_port):
        super().__init__()
        self.by_port = by_port

    def read_mac(self, port):
        return self.by_port[port]["mac"]

    def serial_lines(self, port, seconds, stop_when):
        return self.by_port[port]["lines"]


class WatcherRun(unittest.TestCase):
    def setUp(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        self.sheet = os.path.join(folder, "sheet.csv")
        with open(self.sheet, "w", newline="") as handle:
            handle.write(SHEET + "12,ESP_7AED5B,EC:FA:BC:7A:ED:5B,,\r\n")
        self.inventory = bench.Inventory.from_file(self.sheet)

    def watcher(self, tools, polls):
        server = bench.Server("http://alarms.local", "tok", FakeTransport())
        watcher = bench.Watcher(tools, server, self.inventory, "/bin/fw.bin", bench.BenchLog(self.sheet), 7, list_ports=ScriptedPorts(polls))
        watcher.poll_seconds = 0
        watcher.say = lambda message: None
        return watcher

    def test_ports_present_at_start_are_ignored_and_new_ones_each_get_a_row(self):
        tools = PerPortTools({
            "COM7": {"mac": "EC:FA:BC:7A:ED:5B", "lines": boot_log()},
            "COM9": {"mac": "5C:CF:7F:12:34:AB", "lines": boot_log(hostname="ESP_1234AB")},
        })
        watcher = self.watcher(tools, polls=[["COM3"], ["COM3", "COM7", "COM9"], ["COM3", "COM7", "COM9"]])
        self.assertEqual(watcher.run(), 0)
        with open(watcher.log.path, newline="") as handle:
            rows = list(csv.reader(handle))[1:]
        self.assertEqual(sorted(row[3] for row in rows), ["ESP_1234AB", "ESP_7AED5B"])
        self.assertEqual(sorted(row[0] for row in tools.flashed), ["COM7", "COM9"])

    def test_a_replugged_board_runs_again(self):
        tools = PerPortTools({"COM7": {"mac": "EC:FA:BC:7A:ED:5B", "lines": boot_log()}})
        watcher = self.watcher(tools, polls=[[], ["COM7"], [], ["COM7"], []])
        watcher.run()
        self.assertEqual(len(tools.flashed), 2)
        self.assertEqual(len(watcher.seen), 2)

    def test_a_board_whose_flash_failed_still_counts_as_seen(self):
        tools = PerPortTools({"COM7": {"mac": "EC:FA:BC:7A:ED:5B", "lines": boot_log()}})
        tools.failing_bauds = {921600, 460800}
        watcher = self.watcher(tools, polls=[[], ["COM7"], ["COM7"]])
        watcher.run()
        self.assertEqual([board.mac for board in watcher.seen], ["EC:FA:BC:7A:ED:5B"])
        self.assertNotIn(6, [row.row for row in bench.reconcile(self.inventory, watcher.seen)[0]])

    def test_no_wifi_on_the_first_board_stops_the_run_with_exit_code_1(self):
        tools = PerPortTools({"COM7": {"mac": "EC:FA:BC:7A:ED:5B", "lines": boot_log(wifi=False)}})
        watcher = self.watcher(tools, polls=[[], ["COM7"]] + [["COM7"]] * 50)
        self.assertEqual(watcher.run(), 1)
        self.assertIn("WiFi", watcher.stop_reason)

    def test_a_board_that_did_not_boot_does_not_count_as_the_first_board(self):
        tools = PerPortTools({
            "COM7": {"mac": "EC:FA:BC:7A:ED:5B", "lines": []},
            "COM9": {"mac": "5C:CF:7F:12:34:AB", "lines": boot_log(hostname="ESP_1234AB", wifi=False)},
        })
        watcher = self.watcher(tools, polls=[[], ["COM7"], ["COM7"], ["COM7", "COM9"]] + [["COM7", "COM9"]] * 50)
        self.assertEqual(watcher.run(), 1)

    def test_once_wifi_is_proven_a_later_board_without_it_only_fails(self):
        tools = PerPortTools({
            "COM7": {"mac": "EC:FA:BC:7A:ED:5B", "lines": boot_log()},
            "COM9": {"mac": "5C:CF:7F:12:34:AB", "lines": boot_log(hostname="ESP_1234AB", wifi=False)},
        })
        def com7_finishes():
            for thread in watcher._threads:
                thread.join()

        watcher = self.watcher(tools, polls=[[], ["COM7"], ["COM7"], com7_finishes, ["COM7", "COM9"], ["COM7", "COM9"]])
        self.assertEqual(watcher.run(), 0)
        self.assertIsNone(watcher.stop_reason)



class SheetWriteBack(unittest.TestCase):
    NOTE = "MAKE SURE TO PUT HOSTNAME WITH _ IN MONITER! Email me if you need help,,,,\r\n"

    def setUp(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        self.path = os.path.join(folder, "device_log - device_log.csv")
        with open(self.path, "w", newline="") as handle:
            handle.write(SHEET + self.NOTE)
        self.inventory = bench.Inventory.from_file(self.path)

    def lines(self):
        with open(self.path, "rb") as handle:
            return handle.read().decode().split("\r\n")

    def test_a_pass_ticks_flashed_and_tested_and_notes_the_verdict(self):
        row = self.inventory.record("8C:AA:B5:0F:F1:B8", "ESP_0FF1B8", flashed=True, verdict=bench.Verdict("PASS", ""), when="2026-09-10")
        self.assertEqual(row, 3)
        lines = self.lines()
        self.assertEqual(lines[0], "ID,HOSTNAME,MAC,Column 1,TESTED,FLASHED,BENCH")
        self.assertEqual(lines[2], "2,ESP_0FF1B8,8C:AA:B5:0F:F1:B8,,TRUE,TRUE,PASS 2026-09-10")
        self.assertEqual(lines[1], "1,ESP_21A8EB,EC:FA:BC:21:A8:EB,,TRUE")  # untouched rows are not padded
        self.assertEqual(lines[-2], self.NOTE.rstrip("\r\n"))  # the note at the bottom stays
        self.assertEqual(lines[-1], "")  # and the file still ends with CRLF

    def test_a_fail_unticks_tested_and_says_why(self):
        self.inventory.record("EC:FA:BC:21:A8:EB", "ESP_21A8EB", flashed=True, verdict=bench.Verdict("FAIL", "bad sensor"), when="2026-09-10")
        self.assertEqual(self.lines()[1], "1,ESP_21A8EB,EC:FA:BC:21:A8:EB,,FALSE,TRUE,FAIL bad sensor 2026-09-10")

    def test_a_board_the_sheet_lacks_is_appended_above_the_note_with_the_next_id(self):
        row = self.inventory.record("5C:CF:7F:12:34:AB", "ESP_1234AB", flashed=True, verdict=bench.Verdict("PASS", ""), when="2026-09-10")
        self.assertEqual(row, 6)
        lines = self.lines()
        self.assertEqual(lines[5], "5,ESP_1234AB,5C:CF:7F:12:34:AB,,TRUE,TRUE,PASS 2026-09-10")
        self.assertEqual(lines[6], self.NOTE.rstrip("\r\n"))
        self.assertEqual(self.inventory.find("5C:CF:7F:12:34:AB").row, 6)  # a replug finds the new row

    def test_a_board_appended_to_the_sheet_still_counts_as_one_the_sheet_lacked_at_start(self):
        self.inventory.record("5C:CF:7F:12:34:AB", "ESP_1234AB", flashed=True, verdict=bench.Verdict("PASS", ""), when="2026-09-10")
        seen = [bench.Seen(hostname="ESP_1234AB", mac="5C:CF:7F:12:34:AB"), bench.Seen(hostname="ESP_21A8EB", mac="EC:FA:BC:21:A8:EB")]
        never_seen, not_on_list = bench.reconcile(self.inventory, seen)
        self.assertEqual([board.hostname for board in not_on_list], ["ESP_1234AB"])
        self.assertEqual([row.row for row in never_seen], [3, 5])  # the appended row is not a sheet row never seen

    def test_the_second_write_updates_the_same_row_and_a_sheet_edited_meanwhile_is_kept(self):
        self.inventory.record("EC:FA:BC:21:A8:EB", "ESP_21A8EB", flashed=True, verdict=bench.Verdict("FAIL", "bad sensor"), when="2026-09-10")
        with open(self.path, "r+", newline="") as handle:
            text = handle.read().replace("4,ESP_A68D29", "4,ESP_A68D29 (by hand)")
            handle.seek(0)
            handle.write(text)
        self.inventory.record("EC:FA:BC:21:A8:EB", "ESP_21A8EB", flashed=True, verdict=bench.Verdict("PASS", ""), when="2026-09-11")
        lines = self.lines()
        self.assertEqual(lines[1], "1,ESP_21A8EB,EC:FA:BC:21:A8:EB,,TRUE,TRUE,PASS 2026-09-11")
        self.assertIn("(by hand)", lines[4])

    def test_a_sheet_from_text_cannot_be_written(self):
        with self.assertRaises(bench.BenchError):
            bench.Inventory.from_text(SHEET).record("EC:FA:BC:21:A8:EB", "ESP_21A8EB", flashed=True, verdict=bench.Verdict("PASS", ""), when="2026-09-10")


if __name__ == "__main__":
    unittest.main()
