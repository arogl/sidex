/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { streamToBuffer, VSBuffer } from '@sidex/base/common/buffer.js';
import { CancellationToken } from '@sidex/base/common/cancellation.js';
import { getErrorMessage, isCancellationError } from '@sidex/base/common/errors.js';
import { Emitter, Event } from '@sidex/base/common/event.js';
import { Disposable } from '@sidex/base/common/lifecycle.js';
import { listenStream } from '@sidex/base/common/stream.js';
import { IHeaders, IRequestContext, IRequestOptions } from '@sidex/base/parts/request/common/request.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';

export const IRequestService = createDecorator<IRequestService>('requestService');

export const NO_FETCH_TELEMETRY = 'NO_FETCH_TELEMETRY';

export interface IRequestCompleteEvent {
	readonly callSite: string;
	readonly latency: number;
	readonly statusCode: number | undefined;
}

export interface AuthInfo {
	isProxy: boolean;
	scheme: string;
	host: string;
	port: number;
	realm: string;
	attempt: number;
}

export interface Credentials {
	username: string;
	password: string;
}

export interface IRequestService {
	readonly _serviceBrand: undefined;
	readonly onDidCompleteRequest: Event<IRequestCompleteEvent>;
	request(options: IRequestOptions, token: CancellationToken): Promise<IRequestContext>;
	resolveProxy(url: string): Promise<string | undefined>;
	lookupAuthorization(authInfo: AuthInfo): Promise<Credentials | undefined>;
	lookupKerberosAuthorization(url: string): Promise<string | undefined>;
	loadCertificates(): Promise<string[]>;
}

class LoggableHeaders {
	private headers: IHeaders | undefined;
	constructor(private readonly original: IHeaders) {}
	toJSON(): any {
		if (!this.headers) {
			const headers = Object.create(null);
			for (const key in this.original) {
				if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'proxy-authorization') {
					headers[key] = '*****';
				} else {
					headers[key] = this.original[key];
				}
			}
			this.headers = headers;
		}
		return this.headers;
	}
}

/** The code (`ECONNRESET`) or else the name of a thrown value: never its message, which may echo the URL. */
function loggableErrorCode(error: unknown): string {
	const code = error && typeof error === 'object' ? (error as { readonly code?: unknown }).code : undefined;
	if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) {
		return code;
	}
	return error instanceof Error && /^[A-Za-z0-9_.-]{1,64}$/.test(error.name) ? error.name : 'error';
}

export abstract class AbstractRequestService extends Disposable implements IRequestService {
	declare readonly _serviceBrand: undefined;

	private counter = 0;

	private readonly _onDidCompleteRequest = this._register(new Emitter<IRequestCompleteEvent>());
	readonly onDidCompleteRequest = this._onDidCompleteRequest.event;

	constructor(protected readonly logService: ILogService) {
		super();
	}

	protected async logAndRequest(
		options: IRequestOptions,
		request: () => Promise<IRequestContext>
	): Promise<IRequestContext> {
		if (options.logUrl === false) {
			return this._logHostAndRequest(options, request);
		}
		const prefix = `#${++this.counter}: ${options.url}`;
		this.logService.trace(`${prefix} - begin`, options.type, new LoggableHeaders(options.headers ?? {}));
		const startTime = Date.now();
		try {
			const result = await request();
			this.logService.trace(`${prefix} - end`, options.type, result.res.statusCode, result.res.headers);
			this._onDidCompleteRequest.fire({
				callSite: options.callSite,
				latency: Date.now() - startTime,
				statusCode: result.res.statusCode
			});
			return result;
		} catch (error) {
			if (isCancellationError(error)) {
				this.logService.trace(`${prefix} - cancelled`, options.type);
			} else {
				this.logService.error(`${prefix} - error`, options.type, getErrorMessage(error));
			}
			throw error;
		}
	}

	/** {@link logAndRequest} for `logUrl: false`: logs the host, the status and the error's name or code only. */
	private async _logHostAndRequest(
		options: IRequestOptions,
		request: () => Promise<IRequestContext>
	): Promise<IRequestContext> {
		let host = '<invalid url>';
		try {
			host = new URL(options.url ?? '').host;
		} catch {
			// Logged as invalid.
		}
		const prefix = `#${++this.counter}: ${host}`;
		this.logService.trace(`${prefix} - begin`, options.type);
		const startTime = Date.now();
		try {
			const result = await request();
			this.logService.trace(`${prefix} - end`, options.type, result.res.statusCode);
			this._onDidCompleteRequest.fire({
				callSite: options.callSite,
				latency: Date.now() - startTime,
				statusCode: result.res.statusCode
			});
			return result;
		} catch (error) {
			if (isCancellationError(error)) {
				this.logService.trace(`${prefix} - cancelled`, options.type);
			} else {
				this.logService.error(`${prefix} - error`, options.type, loggableErrorCode(error));
			}
			throw error;
		}
	}

	abstract request(options: IRequestOptions, token: CancellationToken): Promise<IRequestContext>;
	abstract resolveProxy(url: string): Promise<string | undefined>;
	abstract lookupAuthorization(authInfo: AuthInfo): Promise<Credentials | undefined>;
	abstract lookupKerberosAuthorization(url: string): Promise<string | undefined>;
	abstract loadCertificates(): Promise<string[]>;
}

export function isSuccess(context: IRequestContext): boolean {
	return (
		(context.res.statusCode && context.res.statusCode >= 200 && context.res.statusCode < 300) ||
		context.res.statusCode === 1223
	);
}

export function isClientError(context: IRequestContext): boolean {
	return !!context.res.statusCode && context.res.statusCode >= 400 && context.res.statusCode < 500;
}

export function isServerError(context: IRequestContext): boolean {
	return !!context.res.statusCode && context.res.statusCode >= 500 && context.res.statusCode < 600;
}

/**
 * Reads a header value from an {@link IHeaders} map, tolerating array-shaped
 * values and case-insensitive lookups.
 */
export function readHeader(headers: IHeaders | undefined, name: string): string | undefined {
	if (!headers) {
		return undefined;
	}
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) {
		return value[0];
	}
	return value;
}

/**
 * Parses the `Retry-After` header as a number of seconds. Returns `undefined`
 * if absent or not a finite positive number. The HTTP-date form is not parsed.
 */
export function retryAfterFromHeaders(headers: IHeaders | undefined): number | undefined {
	const value = readHeader(headers, 'retry-after');
	if (!value) {
		return undefined;
	}
	const parsed = parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function hasNoContent(context: IRequestContext): boolean {
	return context.res.statusCode === 204;
}

export async function asText(context: IRequestContext): Promise<string | null> {
	if (hasNoContent(context)) {
		return null;
	}
	const buffer = await streamToBuffer(context.stream);
	return buffer.toString();
}

/** Reads a response without buffering more than the caller's maximum size. */
export function readBoundedResponse(
	context: IRequestContext,
	maxBytes: number,
	onLimitExceeded: () => Error
): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: VSBuffer[] = [];
		let bytes = 0;
		listenStream(context.stream, {
			onData: chunk => {
				bytes += chunk.byteLength;
				if (bytes > maxBytes) {
					reject(onLimitExceeded());
					context.stream.destroy();
				} else {
					chunks.push(chunk);
				}
			},
			onError: reject,
			onEnd: () => resolve(VSBuffer.concat(chunks).toString())
		});
	});
}

export async function asTextOrError(context: IRequestContext): Promise<string | null> {
	if (!isSuccess(context)) {
		throw new Error('Server returned ' + context.res.statusCode);
	}
	return asText(context);
}

export async function asJson<T = {}>(context: IRequestContext): Promise<T | null> {
	if (!isSuccess(context)) {
		throw new Error('Server returned ' + context.res.statusCode);
	}
	if (hasNoContent(context)) {
		return null;
	}
	const buffer = await streamToBuffer(context.stream);
	const str = buffer.toString();
	try {
		return JSON.parse(str);
	} catch (err) {
		err.message += ':\n' + str;
		throw err;
	}
}

export const USER_LOCAL_AND_REMOTE_SETTINGS = [
	'http.proxy',
	'http.proxyStrictSSL',
	'http.proxyKerberosServicePrincipal',
	'http.noProxy',
	'http.proxyAuthorization',
	'http.proxySupport',
	'http.systemCertificates',
	'http.systemCertificatesNode',
	'http.experimental.systemCertificatesV2',
	'http.fetchAdditionalSupport',
	'http.experimental.networkInterfaceCheckInterval'
];
