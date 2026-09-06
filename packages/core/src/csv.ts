/**
 * Dependency-free, resumable CSV chunk parsing.
 *
 * Built for importing very large CSV files under serverless constraints: a
 * Vercel function has both a request-body ceiling (~4.5MB) and an execution
 * duration ceiling, so a large file can be neither uploaded through an API
 * route in one request nor parsed in one invocation. The fix used here is a
 * byte-range pipeline (see apps/web/app/api/admin/imports) — the file is
 * fetched from storage in small byte ranges across many short calls, and
 * this module parses whatever *complete* CSV rows fall inside one range,
 * handing back the trailing partial row as `leftover` so the caller can
 * prepend it to the next range's bytes. That keeps each call's memory and
 * CPU bounded by the chunk size, not by the file size.
 */

export interface CsvChunkResult {
  rows: string[][];
  /** Trailing bytes that didn't form a complete row — prepend to the next chunk's text. */
  leftover: string;
}

/**
 * Parse as many complete CSV rows as possible out of `text`. `text` may
 * begin mid-row (pass in the previous chunk's `leftover`) and may end
 * mid-row (returned as this call's `leftover`). Handles quoted fields,
 * embedded commas/newlines, and doubled-quote escaping ("").
 */
export function parseCsvChunk(text: string): CsvChunkResult {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  let rowStart = 0;
  let sawAnyField = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Ignore fully blank trailing lines (e.g. a stray \n at EOF).
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    sawAnyField = false;
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
      sawAnyField = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      sawAnyField = true;
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      rowStart = i;
      continue;
    }
    field += ch;
    sawAnyField = true;
    i += 1;
  }

  // Whatever's left (possibly nothing) is an incomplete final row — unless
  // we're mid-quote, in which case it's genuinely incomplete even if it
  // looks row-shaped; either way, hand it back as leftover rather than
  // guessing.
  const leftover = inQuotes || sawAnyField || field !== "" ? text.slice(rowStart) : "";

  return { rows, leftover };
}

/** Map a header row + data row into a plain object, ignoring extra/missing columns gracefully. */
export function zipCsvRow(header: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) {
    out[header[i].trim()] = (row[i] ?? "").trim();
  }
  return out;
}

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Writes rows (each a header-keyed record) to CSV text compatible with
 * parseCsvChunk above — one shared implementation so writer and parser
 * never drift apart (a bug that has bitten this project before: a
 * hand-duplicated parser once treated "height:" as a different key than
 * "height" solely because of a stray trailing character never normalized).
 */
export function writeCsvRows(columns: readonly string[], rows: Record<string, string>[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCsvField(row[col] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}
