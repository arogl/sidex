import { describe, expect, it } from 'bun:test';
import { DEFAULT_RETENTION_DAYS, parseRetentionDays, RETENTION_OPTIONS } from '../retention.js';

describe('parseRetentionDays', () => {
	it('defaults to 30 days when nothing is saved', () => {
		expect(DEFAULT_RETENTION_DAYS).toBe(30);
		expect(parseRetentionDays(undefined)).toBe(30);
		expect(parseRetentionDays(null)).toBe(30);
	});

	it('reads a number, a numeric string, and the JSON text Settings saves', () => {
		expect(parseRetentionDays(14)).toBe(14);
		expect(parseRetentionDays('90')).toBe(90);
		expect(parseRetentionDays('"60"')).toBe(60);
	});

	it('treats 0 as never', () => {
		expect(parseRetentionDays('0')).toBe(0);
		expect(parseRetentionDays(0)).toBe(0);
	});

	it('falls back to the default for anything that is not a whole number of days', () => {
		for (const bad of ['soon', -5, 2.5, {}, [], true, '']) {
			expect(parseRetentionDays(bad)).toBe(30);
		}
	});

	it('caps it at ten years', () => {
		expect(parseRetentionDays(99999)).toBe(3650);
	});
});

describe('RETENTION_OPTIONS', () => {
	it('offers the default, and Never', () => {
		const values = RETENTION_OPTIONS.map(o => o.value);
		expect(values).toContain('30');
		expect(values).toContain('0');
		expect(values.every(v => parseRetentionDays(v) === Number(v))).toBe(true);
	});
});
