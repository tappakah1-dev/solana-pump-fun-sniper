import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseOperatorWallets, isOperator } from "./operator.server.ts";

describe("operator whitelist", () => {
  it("parses comma and whitespace lists", () => {
    const list = parseOperatorWallets("Aaa111111111111111111111111111111111111111,  Bbb222222222222222222222222222222222222222");
    assert.equal(list.length, 2);
  });

  it("empty list means no gate", () => {
    assert.equal(parseOperatorWallets("").length, 0);
    assert.equal(isOperator("anyone"), true);
  });
});
