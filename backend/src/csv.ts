/**
 * CSV as Excel opens it: a header row, CRLF line ends, numbers as bare numbers, and a UTF-8 byte
 * order mark so a Campus or Closet name outside ASCII reads right (Excel takes a CSV without one
 * as the PC's own code page).
 */

/** A cell: text, a number, or nothing (an empty cell). */
export type Cell = string | number | null;

export const UTF8_BOM = '﻿';

/**
 * Text a spreadsheet would run as a formula when it opens the file: `=`, `+`, `-`, `@`, and a
 * leading tab or carriage return (OWASP, CSV injection). Closet names and acknowledgements are
 * typed by people, so any text cell may start with one.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

const NEEDS_QUOTES = /[",\r\n]/;

/**
 * One cell, escaped. Text that a spreadsheet would take as a formula is prefixed with `'` and
 * quoted, so it shows as written and never runs. Numbers are written bare, a negative one
 * included: they come from the database, not from a person, and must stay numbers in Excel.
 */
export function csvCell(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const guarded = FORMULA_START.test(value);
  const text = guarded ? `'${value}` : value;
  return guarded || NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One row, CRLF-terminated. */
export const csvRow = (cells: readonly Cell[]): string => `${cells.map(csvCell).join(',')}\r\n`;

/**
 * A name made safe for a file name on any system: runs of anything but ASCII letters, digits,
 * dots, and hyphens become one hyphen. `IDF 2` is `IDF-2`; `=cmd|calc` is `cmd-calc`.
 */
export function fileNamePart(text: string): string {
  return text.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}
