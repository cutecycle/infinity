/**
 * Content Script for Infinity Chrome Extension
 * This script runs in the context of web pages
 */

import TabSleep from '../tab-sleep.js';

console.log('[Infinity] Content script loaded');

// Initialize tab sleep
const tabSleep = new TabSleep();

// Setup message listener for tab sleep commands
tabSleep.setupMessageListener();
