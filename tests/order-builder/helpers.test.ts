import { describe, it, expect } from "vitest";
import {
  encodePriceCents,
  encodeSize,
  calculateMaxFee,
  decodePriceCents,
  decodeSize,
} from "../../src/order-builder/helpers.js";

describe("encodePriceCents", () => {
  it("converts cents to on-chain representation", () => {
    expect(encodePriceCents(25)).toBe(250_000n);
    expect(encodePriceCents(50)).toBe(500_000n);
    expect(encodePriceCents(1)).toBe(10_000n);
    expect(encodePriceCents(99)).toBe(990_000n);
  });

  it("throws for out-of-range values", () => {
    expect(() => encodePriceCents(0)).toThrow(RangeError);
    expect(() => encodePriceCents(100)).toThrow(RangeError);
    expect(() => encodePriceCents(-1)).toThrow(RangeError);
  });
});

describe("encodeSize", () => {
  it("converts shares to on-chain representation", () => {
    expect(encodeSize(10)).toBe(10_000_000n);
    expect(encodeSize(1)).toBe(1_000_000n);
    expect(encodeSize(0.5)).toBe(500_000n);
  });

  it("throws for size below minimum", () => {
    expect(() => encodeSize(0.001)).toThrow(RangeError);
    expect(() => encodeSize(0)).toThrow(RangeError);
  });
});

describe("calculateMaxFee", () => {
  it("calculates 1% of notional", () => {
    const price = encodePriceCents(50); // 500_000n
    const size = encodeSize(10); // 10_000_000n
    // notional = 500_000 * 10_000_000 / 100 / 1_000_000 = 50_000
    expect(calculateMaxFee(price, size)).toBe(50_000n);
  });

  it("returns minimum 1n for tiny orders", () => {
    const price = encodePriceCents(1); // 10_000n
    const size = encodeSize(0.01); // 10_000n
    // notional = 10_000 * 10_000 / 100 / 1_000_000 = 1
    expect(calculateMaxFee(price, size)).toBe(1n);
  });
});

describe("decodePriceCents", () => {
  it("converts on-chain price back to cents", () => {
    expect(decodePriceCents(250_000n)).toBe(25);
    expect(decodePriceCents(500_000n)).toBe(50);
    expect(decodePriceCents(990_000n)).toBe(99);
  });
});

describe("decodeSize", () => {
  it("converts on-chain size back to shares", () => {
    expect(decodeSize(10_000_000n)).toBe(10);
    expect(decodeSize(1_000_000n)).toBe(1);
    expect(decodeSize(500_000n)).toBe(0.5);
  });
});

describe("roundtrip encoding", () => {
  it("encode then decode returns original value", () => {
    for (const cents of [1, 25, 50, 75, 99]) {
      expect(decodePriceCents(encodePriceCents(cents))).toBe(cents);
    }
    for (const shares of [0.01, 0.5, 1, 10, 100]) {
      expect(decodeSize(encodeSize(shares))).toBeCloseTo(shares);
    }
  });
});
