import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { config } from './config';

// Helper to sanitize filenames
function sanitizeFilename(name: string): string {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Redefining the function to use the specific UI flow requested by the user
export async function exportPageRobust(page: Page, pageUrl: string, outputDir: string): Promise<boolean> {
    const maxRetries = config.retryOnError ? config.maxRetries : 0;
    let attempt = 0;

    while (attempt <= maxRetries) {
        attempt++;
        if (attempt > 1) {
            console.log(`  - Retry attempt ${attempt}/${maxRetries + 1}...`);
            await page.waitForTimeout(3000); // Wait before retrying
        }

        console.log(`\nProcessing: ${pageUrl}`);

        try {
            await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

            // Wait for page to settle
            await page.waitForTimeout(2000);

            // Update title from actual page content if possible
            let contentTitle = await page.title();
            const h1 = page.locator('h1[data-test-id="page-title"]');
            if (await h1.isVisible()) {
                contentTitle = (await h1.textContent()) || contentTitle;
            }

            // BREADCRUMBS handling for folder structure (FALLBACK logic if path not provided)
            // Note: index.ts usually passes a specific subDir based on API ancestors, so outputDir 
            // might already contain the path. We keep this logic but it might be redundant if outputDir is specific.
            let relativePath = "";
            try {
                // Only try to find internal breadcrumbs if we suspect we are at root
                // or if we want to verify. But let's assume outputDir is correct for now.
                // We keep this block but warn if it fails just in case.

                // If outputDir is just the root output, we might want this.
                // But generally index.ts handles folder structure now.
            } catch (e) { }

            const safeFilename = sanitizeFilename(contentTitle.trim().replace(' - Confluence', ''));
            const filename = `${safeFilename}.pdf`;

            // Final Output Directory
            // If outputDir is already the full path (from index.ts), use it directly.
            const finalDir = outputDir;

            if (!fs.existsSync(finalDir)) {
                fs.mkdirSync(finalDir, { recursive: true });
            }

            const outputPath = path.join(finalDir, filename);

            if (fs.existsSync(outputPath)) {
                console.log(`  - File exists, skipping: ${filename}`);
                return true;
            }

            // 1. Click "More actions" (Tree dots)
            console.log("  - Clicking 'More actions'...");
            const moreActions = page.locator('#more-actions-trigger');
            await moreActions.waitFor({ state: 'visible', timeout: 10000 });
            await moreActions.click();

            // 2. Click "Export" button
            console.log("  - Clicking 'Export' menu...");
            const exportMenuBtn = page.locator('[data-testid="undefined-button"], [aria-label="Export"], button:has-text("Export")');
            await exportMenuBtn.first().waitFor({ state: 'visible', timeout: 5000 });
            await exportMenuBtn.first().click();

            // 3. Click "Export to PDF" - Specific Selector
            console.log("  - Clicking 'Export to PDF'...");
            const exportPdfLink = page.locator('a[role="menuitem"][data-vc="link-item"]').filter({ hasText: /Export to PDF/i });
            await exportPdfLink.first().waitFor({ state: 'visible', timeout: 5000 });

            await exportPdfLink.first().click();

            // 4. Handle "Exporting / Processing" page
            console.log("  - Waiting for export processing...");

            const downloadLink = page.locator('#downloadableLink_dynamic');

            // Increased timeout for processing
            await downloadLink.waitFor({ state: 'visible', timeout: 60000 });
            console.log("  - PDF ready. Downloading...");

            // 5. Click the final download link
            const downloadPromise = page.waitForEvent('download', { timeout: config.timeout });
            await downloadLink.click();

            const download = await downloadPromise;
            await download.saveAs(outputPath);

            console.log(`  - Download complete: ${filename}`);
            return true;

        } catch (err: any) {
            console.error(`  - Error exporting ${pageUrl}: ${err.message}`);

            try {
                const screenshotPath = path.join(outputDir, `error_${Date.now()}.png`);
                await page.screenshot({ path: screenshotPath });
            } catch (e) { }

            // If we have retries left, continue loop.
            if (attempt <= maxRetries) {
                console.log(`  - Retrying...`);
                continue;
            } else {
                return false;
            }
        }
    }
    return false;
}
