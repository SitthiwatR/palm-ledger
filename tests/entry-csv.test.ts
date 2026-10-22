import { test } from "node:test";
import assert from "node:assert/strict";
import { csvText } from "../src/lib/entry-csv";
test("CSV neutralizes formula prefixes, controls and escaped Thai text", () => {
  for (const text of [
    "=1+1",
    "+SUM(A1)",
    "-1+2",
    "@SUM(A1)",
    " \t=cmd",
    "\u0001=cmd",
    "\ttext",
    "\rtext",
    "\ntext",
  ])
    assert.ok(csvText(text).startsWith("\"'"));
  assert.equal(csvText('ชื่อ, "ไทย"\nอีกแถว'), '"ชื่อ, ""ไทย""\nอีกแถว"');
  assert.equal(csvText("200.00"), '"200.00"');
});
