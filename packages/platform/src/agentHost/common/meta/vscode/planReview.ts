/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isObject } from '@sidex/base/common/types.js';
import type { ChatInputRequestWithPlanReview, IAgentHostPlanReview } from '../../agentHostPlanReview.js';
import type { ChatInputRequest } from '../../state/protocol/state.js';

export function readVSCodePlanReview(request: ChatInputRequest): IAgentHostPlanReview | undefined {
	const review = (request as ChatInputRequestWithPlanReview).planReview;
	if (
		!isObject(review) ||
		typeof review.title !== 'string' ||
		typeof review.content !== 'string' ||
		typeof review.canProvideFeedback !== 'boolean' ||
		typeof review.answerQuestionId !== 'string' ||
		(review.planUri !== undefined && typeof review.planUri !== 'string') ||
		!Array.isArray(review.actions) ||
		!review.actions.every((action: unknown) => {
			if (!isObject(action)) {
				return false;
			}
			const a = action as Record<string, unknown>;
			return (
				typeof a.id === 'string' &&
				typeof a.label === 'string' &&
				(a.description === undefined || typeof a.description === 'string') &&
				(a.default === undefined || typeof a.default === 'boolean') &&
				(a.permissionLevel === undefined || a.permissionLevel === 'autopilot')
			);
		})
	) {
		return undefined;
	}
	return review;
}
