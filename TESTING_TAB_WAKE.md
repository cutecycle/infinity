# Tab Wake Integration Testing Guide

## Overview
This document provides pseudocode and methodology for testing the tab wake mechanism implemented in `src/utils/tab-wake.js`.

## Test Environment Setup

### Prerequisites
1. Load the extension into Chrome DevTools in unpacked mode (dist/ folder)
2. Open a test page with forms and dynamic content
3. Open Chrome DevTools on the test page (F12)
4. Have Console and Application tabs ready

## Testing Strategy

### 1. Unit Tests - Form Data Capture & Restore

#### Test Case 1.1: Simple Form Input
```pseudocode
GIVEN a page with a form containing:
  - Text input with name="username" and value="testuser"
  - Email input with name="email" and value="test@example.com"
  - Textarea with name="comment" and value="hello world"

WHEN captureFormData() is called
THEN formData object should contain:
  {
    username: "testuser",
    email: "test@example.com",
    comment: "hello world"
  }

WHEN restoreFormData(formData) is called on a fresh page
THEN all inputs should have their original values
AND change events should fire on each element
```

**Manual Test Steps:**
1. Navigate to: `file:///C:/path/to/test-form.html`
2. Fill form: username="john", email="john@test.com", comment="testing"
3. In console: `await savePageState()`
4. Reload page: `window.location.reload()`
5. In console: `await wakeTab()` 
6. Verify: Form values are restored
7. Check Chrome DevTools Network: Should see single reload request

---

#### Test Case 1.2: Checkbox & Radio Button State
```pseudocode
GIVEN a page with:
  - Checkbox name="subscribe" (initially checked)
  - Radio buttons name="preference" with options (selected="yes")

WHEN captureFormData() is called
THEN formData should contain:
  {
    subscribe: true,
    preference: "yes"
  }

WHEN restoreFormData() is called
THEN checkbox should be checked
AND radio "yes" should be selected
```

**Manual Test Steps:**
1. Create test page with checkboxes and radios
2. Check/select specific options
3. In console: `savedState = captureFormData()`
4. Modify form state
5. In console: `restoreFormData(savedState)`
6. Verify all selections restored

---

### 2. Scroll Position Restoration Tests

#### Test Case 2.1: Vertical Scroll Restoration
```pseudocode
GIVEN a page with tall content (>2000px)

WHEN user scrolls to scrollY=1500
AND savePageState() is called
AND page is reloaded
AND wakeTab() is called

THEN window.scrollY should be restored to 1500
AND restoration should complete within 100ms of page load
```

**Manual Test Steps:**
1. Open a long-form content page (e.g., Wikipedia article)
2. Scroll down to position 1500px: `window.scrollTo(0, 1500)`
3. Note position: `console.log(window.scrollY)`
4. Call: `await savePageState()`
5. Reload: `window.location.reload()`
6. Wait for page load
7. Call: `await wakeTab()`
8. Verify: `window.scrollY === 1500` (or very close)

---

#### Test Case 2.2: Lazy-Loaded Images
```pseudocode
GIVEN a page with lazy-loaded images

WHEN wakeTab() is called
AND waitForImagesLoaded(timeout=5000) is invoked
THEN function should wait up to 5 seconds for img.load events
AND then restore scroll position
AND restore should occur AFTER images have loaded
```

**Manual Test Steps:**
1. Open page with lazy-loading images (e.g., Unsplash gallery)
2. Scroll to position with lazy images
3. Call: `await savePageState()`
4. Reload: `window.location.reload()`
5. During reload, monitor: `document.querySelectorAll('img').length` before/after
6. Call: `await wakeTab()`
7. Monitor console logs: "Scroll position restored" should appear after images load

---

### 3. Session Storage Restoration Tests

#### Test Case 3.1: SessionStorage Preservation
```pseudocode
GIVEN a page that uses sessionStorage:
  sessionStorage.setItem("userPrefs", JSON.stringify({theme: "dark"}))
  sessionStorage.setItem("cart", JSON.stringify({items: 2}))

WHEN savePageState() is called
THEN sessionStorageData should contain both keys/values

WHEN page reloads and wakeTab() is called
THEN sessionStorage should have original values restored
AND application state should be preserved
```

**Manual Test Steps:**
1. Set session data: `sessionStorage.setItem("testKey", "testValue")`
2. Call: `await savePageState()`
3. Verify stored: Check Application tab > Session Storage
4. Reload: `window.location.reload()`
5. Call: `await wakeTab()`
6. Verify: `sessionStorage.getItem("testKey") === "testValue"`

---

### 4. Integration Tests - Full Wake Sequence

#### Test Case 4.1: Complete Wake Flow
```pseudocode
GIVEN a complex page with:
  - Forms with multiple input types
  - Scrolled content (scrollY > 0)
  - SessionStorage data
  - Lazy-loaded images

WHEN complete wake sequence executes:
  1. Preview indicator removed
  2. Page reloaded from URL
  3. DOM becomes ready
  4. Images load
  5. Form data restored
  6. SessionStorage restored
  7. Scroll restored
  8. Document marked with data-infinity-awake="true"

THEN timeToInteractive should be < 5000ms
AND all restoration steps complete successfully
```

**Manual Test Steps:**
1. Open complex test page
2. Interact with page: fill forms, scroll, add sessionStorage
3. Run: `result = await wakeTab()`
4. Check result object:
   ```
   {
     status: "success",
     message: "Tab successfully woken up",
     timeToInteractive: <number>,
     url: "<current url>"
   }
   ```
5. Verify all state is restored
6. Check: `document.documentElement.getAttribute('data-infinity-awake') === 'true'`

---

#### Test Case 4.2: Error Handling & Graceful Degradation
```pseudocode
GIVEN a page where restoration fails (e.g., network timeout)

WHEN wakeTab() is called with timeout=1000

THEN function should:
  1. Catch error gracefully
  2. Log error to console
  3. Return object with status="error"
  4. NOT crash the page
  5. Leave page in usable state

EXPECTED RESPONSE:
  {
    status: "error",
    message: "Failed to wake tab: <error details>",
    error: "<error string>"
  }
```

**Manual Test Steps:**
1. Go offline or block network requests
2. Call: `result = await wakeTab()`
3. Verify: `result.status === 'error'`
4. Verify: No console errors (only logs)
5. Verify: Page is still functional

---

### 5. Message Communication Tests

#### Test Case 5.1: Wake Message from Service Worker
```pseudocode
GIVEN initializeWakeListener() has been called

WHEN service worker sends:
  chrome.tabs.sendMessage(tabId, { 
    action: 'wake',
    options: { useCache: false, timeout: 30000 }
  })

THEN content script should:
  1. Receive message
  2. Call wakeTab() with provided options
  3. Send response with wake result
  4. Response contains success: true/false
```

**Manual Test Steps (requires debugging both scripts):**
1. In content script console: Open DevTools for content script
2. In service worker: Open Service Worker in DevTools
3. In service worker console, send message:
   ```javascript
   chrome.tabs.query({}, (tabs) => {
     if (tabs[0]) {
       chrome.tabs.sendMessage(tabs[0].id, { 
         action: 'wake' 
       }, (response) => {
         console.log('Wake response:', response);
       });
     }
   });
   ```
4. Verify content script receives and processes message
5. Verify response is sent back with correct status

---

#### Test Case 5.2: Save Page State Message
```pseudocode
GIVEN content script is loaded

WHEN message sent:
  chrome.runtime.sendMessage({
    action: 'savePageState'
  })

THEN content script should:
  1. Call savePageState()
  2. Return { success: true }
  3. Verify data stored in chrome.storage.local
```

**Manual Test Steps:**
1. Open tab with test page
2. In content script console:
   ```javascript
   chrome.runtime.sendMessage({ action: 'savePageState' }, 
     (response) => console.log('Response:', response));
   ```
3. Verify: `response.success === true`
4. Check storage: Chrome DevTools > Application > Storage > Local Storage

---

### 6. Performance Tests

#### Test Case 6.1: Time to Interactive Measurement
```pseudocode
WHEN wakeTab() is called

THEN measure:
  - Time from start to preview removal: <50ms
  - Time from reload to DOM ready: <500ms
  - Time from DOM ready to images loaded: <5000ms (configurable)
  - Time from images loaded to scroll restored: <100ms
  - Total timeToInteractive: <5500ms (for typical pages)
```

**Manual Test Steps:**
1. Open test page
2. Run: `result = await wakeTab()`
3. Check: `result.timeToInteractive`
4. For slow networks, run test with:
   ```javascript
   result = await wakeTab({ timeout: 10000 })
   ```

---

#### Test Case 6.2: Memory Usage - Cache vs Reload
```pseudocode
GIVEN a page of 500KB HTML

WHEN cachePageHTML() is called
THEN chrome.storage.local should contain page HTML
AND memory usage increase should be ~500KB

WHEN same page is woken with useCache: true
THEN restoration from cache should be faster than reload
```

**Manual Test Steps:**
1. Check memory: Chrome DevTools > Memory > Take heap snapshot
2. Call: `await cachePageHTML()`
3. Check memory again
4. Verify storage size in Application tab
5. Compare wake time with/without cache

---

## Edge Cases to Test

### 7.1 Security-Restricted Pages
```pseudocode
GIVEN pages that may have Content-Security-Policy or X-Frame-Options

WHEN wakeTab() is called
THEN it should:
  - Handle CSP violations gracefully
  - Not attempt to inject scripts
  - Fall back to simple URL reload
```

### 7.2 Forms with File Inputs
```pseudocode
GIVEN a form with <input type="file">

WHEN captureFormData() is called
THEN file input should NOT be captured (security)
AND only other form fields are saved
```

### 7.3 Dynamic Content (SPAs)
```pseudocode
GIVEN a Single Page Application with client-side routing

WHEN wakeTab() reloads URL
THEN page should restore to same URL state
AND client-side JavaScript should re-initialize
AND form state should be restored as user sees it
```

---

## Automated Test Script

```javascript
// Place in content script console for quick testing
async function runWakeTests() {
  console.log('=== Starting Wake Tests ===');
  
  // Test 1: Capture form data
  const testForm = document.querySelector('form');
  if (testForm) {
    const formData = captureFormData();
    console.log('✓ Form data captured:', Object.keys(formData).length, 'fields');
  }
  
  // Test 2: Save page state
  await savePageState();
  console.log('✓ Page state saved');
  
  // Test 3: Verify storage
  const stateKey = `tab-state-${window.location.href}`;
  const saved = await getFromStorage(stateKey);
  console.log('✓ State retrieved from storage:', saved ? 'Yes' : 'No');
  
  // Test 4: Check markup
  if (!document.querySelector('[data-infinity-awake]')) {
    console.log('⚠ Awake marker not set yet (expected before wake)');
  }
  
  console.log('=== Wake Tests Complete ===');
}

// Run: await runWakeTests()
```

---

## Success Criteria

A successful tab wake implementation must:

- ✅ Restore form data accurately
- ✅ Restore scroll position within 100ms of load
- ✅ Preserve sessionStorage data
- ✅ Complete wake sequence in <5 seconds on normal network
- ✅ Handle errors gracefully without crashing page
- ✅ Communicate results via message protocol
- ✅ Mark page as awake with data attribute
- ✅ Work with lazy-loaded content
- ✅ Support both reload and cache strategies
- ✅ Measure time-to-interactive accurately

