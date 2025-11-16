import { JulesParser } from '../utils/jules-parser'
import { Message } from '../types/message'

/**
 * Content script for scraping Jules Google Agent pages
 * Runs in the context of Jules pages to extract diff data
 */

// Listen for scraping requests from background script
browser.runtime.onMessage.addListener(
  (
    message: Message,
    _sender: browser.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    if (message.action === 'scrape-jules-page') {
      handle_scrape_request(sendResponse)
      return true // Keep channel open for async response
    }
    return false
  }
)

/**
 * Handles Jules page scraping request
 */
const handle_scrape_request = async (
  sendResponse: (response?: any) => void
) => {
  try {
    // Verify this is a Jules page
    if (!JulesParser.is_jules_page()) {
      sendResponse({ success: false, error: 'Not a Jules page' })
      return
    }

    // Wait for content to be fully loaded
    const content_loaded = await JulesParser.wait_for_jules_content()
    if (!content_loaded) {
      sendResponse({
        success: false,
        error: 'Timeout waiting for Jules content to load'
      })
      return
    }

    // Extract file changes
    const result = JulesParser.extract_file_changes()

    // Format based on requested format (default to XML)
    const xml_format = JulesParser.format_as_xml(result)
    const markdown_format = JulesParser.format_as_markdown(result)

    sendResponse({ success: true, data: result, xml_format, markdown_format })
  } catch (error) {
    console.error('Error scraping Jules page:', error)
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Set up MutationObserver to detect dynamic content changes
 * Jules uses Angular and may lazy-load diff cards
 */
const setup_mutation_observer = () => {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        // Check if new diff cards were added
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            if (
              node.tagName === 'SWEBOT-CODE-REVIEW-DIFF-CARD' ||
              node.querySelector('swebot-code-review-diff-card')
            ) {
              // Notify that new content is available
              notify_content_updated()
            }
          }
        })
      }
    }
  })

  // Observe the main content area
  const target = document.querySelector('.resizable-code-container')
  if (target) {
    observer.observe(target, { childList: true, subtree: true })
  }
}

/**
 * Notifies extension that Jules content has been updated
 */
const notify_content_updated = () => {
  browser.runtime.sendMessage({ action: 'jules-content-updated' })
}

// Initialize observer when content script loads
if (JulesParser.is_jules_page()) {
  setup_mutation_observer()
}
