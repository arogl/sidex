import { InstantiationType, registerSingleton } from '@sidex/platform/instantiation/common/extensions.js';
import {
	IAccessibilitySignalService,
	AccessibilitySignalService
} from '@sidex/platform/accessibilitySignal/browser/accessibilitySignalService.js';

registerSingleton(IAccessibilitySignalService, AccessibilitySignalService, InstantiationType.Delayed);
