import { describe, expect, it } from 'bun:test';
import { VSBuffer } from '@sidex/base/common/buffer.js';
import { RpcTrafficTracer } from '../../browser/rpcTrafficTracer.js';

function request(type: number, req: number, rpcId: number, method: string, padding = 0): VSBuffer {
	const name = VSBuffer.fromString(method);
	const out = VSBuffer.alloc(7 + name.byteLength + padding);
	out.writeUInt8(type, 0);
	out.writeUInt32BE(req, 1);
	out.writeUInt8(rpcId, 5);
	out.writeUInt8(name.byteLength, 6);
	out.set(name, 7);
	return out;
}

function reply(type: number, req: number, padding = 0): VSBuffer {
	const out = VSBuffer.alloc(5 + padding);
	out.writeUInt8(type, 0);
	out.writeUInt32BE(req, 1);
	return out;
}

describe('RpcTrafficTracer', () => {
	it('groups requests by direction and method and attributes replies to their request', () => {
		const tracer = new RpcTrafficTracer();
		tracer.observe('out', request(1, 7, 3, '$deltaExtensions', 1000));
		tracer.observe('in', reply(9, 7, 20));
		tracer.observe('in', request(1, 1, 5, '$onSomething', 10));
		tracer.observe('in', request(1, 2, 5, '$onSomething', 10));

		const lines = tracer.flush();
		expect(lines[0]).toBe('out request 3:$deltaExtensions: 1 messages, 1023 bytes');
		expect(lines).toContain('in ReplyOKJSON to 3:$deltaExtensions: 1 messages, 25 bytes');
		expect(lines).toContain('in request 5:$onSomething: 2 messages, 58 bytes');
	});

	it('resets after a flush and ignores messages too short to have a header', () => {
		const tracer = new RpcTrafficTracer();
		tracer.observe('in', VSBuffer.alloc(2));
		tracer.observe('in', reply(5, 1));
		expect(tracer.flush()).toEqual(['in Acknowledged: 1 messages, 5 bytes']);
		expect(tracer.flush()).toEqual([]);
	});

	it('decodes error replies and reports each distinct error once', () => {
		const tracer = new RpcTrafficTracer();
		tracer.observe('out', request(2, 7, 102, '$onFileEvent'));
		const body = VSBuffer.fromString(
			JSON.stringify({ name: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at a\n    at b' })
		);
		const err = VSBuffer.alloc(9 + body.byteLength);
		err.writeUInt8(11, 0);
		err.writeUInt32BE(7, 1);
		err.writeUInt32BE(body.byteLength, 5);
		err.set(body, 9);
		tracer.observe('in', err);
		tracer.observe('out', request(2, 8, 102, '$onFileEvent'));
		tracer.observe(
			'in',
			(() => {
				const e = VSBuffer.alloc(err.byteLength);
				e.set(err, 0);
				e.writeUInt32BE(8, 1);
				return e;
			})()
		);
		expect(tracer.flushErrors()).toEqual(['102:$onFileEvent: TypeError: boom [at a | at b]']);
		expect(tracer.flushErrors()).toEqual([]);
	});
});
