# Confluence Cloud Automated PDF Exporter
> **Free, reliable, and automated tool to bulk export Confluence Cloud pages to PDF using Playwright.**

## Overview
Are you looking for a way to **export Confluence pages to PDF** without expensive plugins or admin access? This tool provides a **free, automated solution** to crawl your Confluence Cloud space and export every page (including nested trees) as a clean PDF file. It handles authentication, infinite scrolling, and folder organization automatically.

## Prerequisites

- Node.js (v14 or higher)
- A valid Confluence Cloud account

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure the Script**
   Open `src/config.ts` and update the `spaceUrl` with the URL of your Confluence Space.
   
   Example:
   ```typescript
   export const config = {
       spaceUrl: process.env.SPACE_URL || "https://your-domain.atlassian.net/wiki/spaces/MYSPACE/overview",
       outputDir: "./output",
       
       // Auto-retry configuration
       retryOnError: false, // Set to true to retry failed exports automatically
       maxRetries: 3        // Number of times to retry a failed page
   };
   ```

### 3. Features

- **Resume Capability**: The script tracks successfully exported pages in `output/export-history.json`. Rerunning `npm start` will automatically **skip** pages that are already done.
- **Auto-Retry**: If you encounter frequent network timeouts, enable `retryOnError: true` in `config.ts`.
- **Folder Structure**: Exports are organized into folders matching your Confluence space hierarchy.

## Usage

### 1. First Run (Authentication)
The script needs to save your login session.
Run the script:
```bash
npm start
```
- If no `auth.json` is found, a **browser window will open**.
- Log in to Atlassian manually.
- **Wait until you see the Space home page.**
- Go back to the terminal and press **ENTER**.
- The script will save `auth.json` and proceed to scan/export.

### 2. Subsequent Runs
Just run the command again. It will reuse the session in `auth.json`.
```bash
npm start
```

## How It Works

1. **Crawler**: Navigates to the Space's "Pages" list (or handles infinite scroll) to build a list of all page URLs.
2. **Exporter**: 
   - Visits each page.
   - Clicks the "..." (More actions) menu.
   - Selects "Export to PDF".
   - Handles the download confirmation.
   - Saves the file as `SpaceName_PageTitle.pdf`.

## Troubleshooting

- **Timeout Errors**: Increase `timeout` in `config.ts` if your pages are large or PDF generation is slow.
- **Login Issues**: Delete `auth.json` and run the script again to re-authenticate.
- **Missed Pages**: If the crawler doesn't find all pages, verify if the Space uses a custom homepage layout. The script attempts to find the standard "Pages" tree view.

## Notes
- This script runs in **Headed** mode by default (`headless: false`) so you can watch the progress. You can change this in `config.ts`.
- It adds a 2-second delay between pages to be a "good citizen" and avoid rate limiting.
