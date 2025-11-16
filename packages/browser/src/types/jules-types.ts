/**
 * Type definitions for Jules page scraping
 */
export interface JulesScrapingMessage {
  action: 'scrape-jules-page'
}

export interface JulesScrapingResponse {
  success: boolean
  data?: {
    files: Array<{
      path: string
      changeType: 'M' | 'A' | 'D'
      linesAdded: number
      linesRemoved: number
      originalContent: string
      modifiedContent: string
    }>
    totalFiles: number
    totalLinesAdded: number
    totalLinesRemoved: number
  }
  xml_format?: string
  markdown_format?: string
  error?: string
}

export interface JulesContentUpdatedMessage {
  action: 'jules-content-updated'
}
