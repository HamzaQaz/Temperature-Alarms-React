import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { conditionsFor, worstLevel, offlineAfterSeconds, DEFAULT_THRESHOLDS, FAULT_REPORTS_BEFORE_SENSOR_FAULT, type Condition } from '../src/conditions';

const REPORT_INTERVAL = 30;

/** Conditions for a fresh Reading, so only the Reading rules are in play. */
const fresh = (tempF: number, humidity: number | null): Condition[] =>
  conditionsFor({ reading: { tempF, humidity }, secondsSinceReport: 5, reportIntervalSeconds: REPORT_INTERVAL });

describe('conditionsFor', () => {
  test('a comfortable closet is in no Condition', () => {
    assert.deepEqual(fresh(72, 40), []);
  });

  test('no Reading means only Offline', () => {
    assert.deepEqual(conditionsFor({ reading: null, secondsSinceReport: null, reportIntervalSeconds: REPORT_INTERVAL }), [
      { name: 'Offline', level: 'warning' },
    ]);
  });

  describe('Hot', () => {
    test('warning starts at 82 °F', () => {
      assert.deepEqual(fresh(81, 40), []);
      assert.deepEqual(fresh(82, 40), [{ name: 'Hot', level: 'warning' }]);
    });
    test('critical starts at 90 °F and replaces the warning', () => {
      assert.deepEqual(fresh(89, 40), [{ name: 'Hot', level: 'warning' }]);
      assert.deepEqual(fresh(90, 40), [{ name: 'Hot', level: 'critical' }]);
    });
  });

  describe('Cold', () => {
    test('warning at or below 50 °F', () => {
      assert.deepEqual(fresh(51, 40), []);
      assert.deepEqual(fresh(50, 40), [{ name: 'Cold', level: 'warning' }]);
      assert.deepEqual(fresh(49, 40), [{ name: 'Cold', level: 'warning' }]);
    });
  });

  describe('Dry', () => {
    test('warning at or below 20 percent', () => {
      assert.deepEqual(fresh(72, 21), []);
      assert.deepEqual(fresh(72, 20), [{ name: 'Dry', level: 'warning' }]);
      assert.deepEqual(fresh(72, 19), [{ name: 'Dry', level: 'warning' }]);
    });
    test('needs a humidity value', () => {
      assert.deepEqual(fresh(72, null), []);
    });
  });

  describe('Mold risk (the existing rule, unchanged)', () => {
    test('moderate when humidity is above 60 percent between 32 and 100 °F', () => {
      assert.deepEqual(fresh(72, 60), []);
      assert.deepEqual(fresh(72, 61), [{ name: 'Mold risk', level: 'moderate' }]);
      assert.deepEqual(fresh(31, 61), [{ name: 'Cold', level: 'warning' }]);
      assert.deepEqual(fresh(32, 61), [{ name: 'Cold', level: 'warning' }, { name: 'Mold risk', level: 'moderate' }]);
      assert.deepEqual(fresh(100, 61), [{ name: 'Hot', level: 'critical' }, { name: 'Mold risk', level: 'moderate' }]);
      assert.deepEqual(fresh(101, 61), [{ name: 'Hot', level: 'critical' }]);
    });
    test('high when humidity is above 70 percent between 77 and 86 °F', () => {
      assert.deepEqual(fresh(80, 70), [{ name: 'Mold risk', level: 'moderate' }]);
      assert.deepEqual(fresh(80, 71), [{ name: 'Mold risk', level: 'high' }]);
      assert.deepEqual(fresh(76, 71), [{ name: 'Mold risk', level: 'moderate' }]);
      assert.deepEqual(fresh(77, 71), [{ name: 'Mold risk', level: 'high' }]);
      assert.deepEqual(fresh(86, 71), [{ name: 'Mold risk', level: 'high' }, { name: 'Hot', level: 'warning' }]);
      assert.deepEqual(fresh(87, 71), [{ name: 'Hot', level: 'warning' }, { name: 'Mold risk', level: 'moderate' }]);
    });
    test('needs a humidity value', () => {
      assert.deepEqual(fresh(80, null), []);
    });
  });

  describe('Offline', () => {
    const aged = (secondsSinceReport: number, reportIntervalSeconds = REPORT_INTERVAL) =>
      conditionsFor({ reading: { tempF: 72, humidity: 40 }, secondsSinceReport, reportIntervalSeconds });

    test('is declared once more than three Report intervals have passed', () => {
      assert.deepEqual(aged(89), []);
      assert.deepEqual(aged(90), [], 'exactly three intervals is the last moment a Device is still Online');
      assert.deepEqual(aged(91), [{ name: 'Offline', level: 'warning' }]);
    });
    test('follows the Report interval', () => {
      assert.deepEqual(aged(180, 60), []);
      assert.deepEqual(aged(181, 60), [{ name: 'Offline', level: 'warning' }]);
      assert.equal(offlineAfterSeconds(60), 180);
    });
    test('a Reading from the future is not stale', () => {
      assert.deepEqual(aged(-5), []);
    });
    test('the stale Reading still says what it said', () => {
      assert.deepEqual(conditionsFor({ reading: { tempF: 95, humidity: 40 }, secondsSinceReport: 1000, reportIntervalSeconds: REPORT_INTERVAL }), [
        { name: 'Hot', level: 'critical' },
        { name: 'Offline', level: 'warning' },
      ]);
    });
    test('counts from the last report, so a Device sending only fault reports stays Online', () => {
      assert.deepEqual(conditionsFor({ reading: { tempF: 72, humidity: 40 }, secondsSinceReport: 10, sensorFaults: 20, reportIntervalSeconds: REPORT_INTERVAL }), [
        { name: 'Sensor fault', level: 'critical' },
      ]);
      assert.deepEqual(conditionsFor({ reading: null, secondsSinceReport: 10, sensorFaults: 1, reportIntervalSeconds: REPORT_INTERVAL }), [], 'heard from, with no Reading yet');
    });
  });

  describe('Sensor fault', () => {
    const faulting = (sensorFaults: number, tempF = 72, humidity: number | null = 40, secondsSinceReport = 5) =>
      conditionsFor({ reading: { tempF, humidity }, secondsSinceReport, sensorFaults, reportIntervalSeconds: REPORT_INTERVAL });

    test('is critical from the third fault report in a row, never before', () => {
      assert.equal(FAULT_REPORTS_BEFORE_SENSOR_FAULT, 3);
      assert.deepEqual(faulting(0), []);
      assert.deepEqual(faulting(2), [], 'two failed reads are DHT11 hiccups');
      assert.deepEqual(faulting(3), [{ name: 'Sensor fault', level: 'critical' }]);
      assert.deepEqual(faulting(4), [{ name: 'Sensor fault', level: 'critical' }]);
    });
    test('none when the count is not given (firmware before 5 sends no fault reports)', () => {
      assert.deepEqual(fresh(72, 40), []);
    });
    test('while active, the stale Reading is not judged: a sensor that died hot does not keep the closet Hot', () => {
      assert.deepEqual(faulting(2, 95, 15), [{ name: 'Hot', level: 'critical' }, { name: 'Dry', level: 'warning' }], 'below the count the last Reading still counts');
      assert.deepEqual(faulting(3, 95, 15), [{ name: 'Sensor fault', level: 'critical' }]);
      assert.deepEqual(faulting(3, 45, 75), [{ name: 'Sensor fault', level: 'critical' }], 'nor Cold or Mold risk');
    });
    test('stays alongside Offline when the board then falls silent, as a stale Reading does', () => {
      assert.deepEqual(faulting(3, 95, 40, 1000), [
        { name: 'Sensor fault', level: 'critical' },
        { name: 'Offline', level: 'warning' },
      ]);
    });
  });

  test('several Conditions at once come back worst first', () => {
    assert.deepEqual(fresh(85, 75), [
      { name: 'Mold risk', level: 'high' },
      { name: 'Hot', level: 'warning' },
    ]);
    assert.deepEqual(fresh(95, 75), [
      { name: 'Hot', level: 'critical' },
      { name: 'Mold risk', level: 'moderate' },
    ]);
    assert.deepEqual(fresh(45, 15), [
      { name: 'Cold', level: 'warning' },
      { name: 'Dry', level: 'warning' },
    ]);
  });

  test('thresholds can be overridden as one object', () => {
    const thresholds = { ...DEFAULT_THRESHOLDS, hotWarningF: 75, hotCriticalF: 80, coldWarningF: 60, dryWarningPercent: 30 };
    const at = (tempF: number, humidity: number) =>
      conditionsFor({ reading: { tempF, humidity }, secondsSinceReport: 0, reportIntervalSeconds: REPORT_INTERVAL, thresholds });
    assert.deepEqual(at(74, 31), []);
    assert.deepEqual(at(75, 31), [{ name: 'Hot', level: 'warning' }]);
    assert.deepEqual(at(80, 31), [{ name: 'Hot', level: 'critical' }]);
    assert.deepEqual(at(60, 30), [{ name: 'Cold', level: 'warning' }, { name: 'Dry', level: 'warning' }]);
  });

  test('the defaults are the agreed numbers', () => {
    assert.deepEqual(DEFAULT_THRESHOLDS, {
      hotWarningF: 82,
      hotCriticalF: 90,
      coldWarningF: 50,
      dryWarningPercent: 20,
      missedReportsBeforeOffline: 3,
    });
  });
});

describe('worstLevel', () => {
  test('is null with no Conditions', () => {
    assert.equal(worstLevel([]), null);
  });

  test('orders critical, high, warning, moderate', () => {
    const c = (level: Condition['level']): Condition => ({ name: 'Hot', level });
    assert.equal(worstLevel([c('moderate')]), 'moderate');
    assert.equal(worstLevel([c('moderate'), c('warning')]), 'warning');
    assert.equal(worstLevel([c('warning'), c('high'), c('moderate')]), 'high');
    assert.equal(worstLevel([c('moderate'), c('critical'), c('high'), c('warning')]), 'critical');
  });
});
