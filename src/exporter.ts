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

        // BREADCRUMBS handling for folder structure
        let relativePath = "";
        try {
            // Select breadcrumbs
            const breadcrumbs = page.locator('nav[aria-label="Breadcrumbs"] ol li a');
            const count = await breadcrumbs.count();

            // We iterate through breadcrumbs to build the path.
            // Be tolerant of empty breadcrumbs or varied structures.
            const breadcrumbTexts = [];
            for (let i = 0; i < count; i++) {
                const text = await breadcrumbs.nth(i).textContent();
                if (text) breadcrumbTexts.push(text.trim());
            }

            // Remove the first item if it likely represents the Space root
            if (breadcrumbTexts.length > 0) {
                breadcrumbTexts.shift();
            }

            // Construct path
            const sanitizedParts = breadcrumbTexts.map(part => sanitizeFilename(part));
            relativePath = path.join(...sanitizedParts);
            console.log(`  - Detected path: ${relativePath}`);

        } catch (e) {
            console.warn("  - Could not determine breadcrumbs, using root.");
        }

        const safeFilename = sanitizeFilename(contentTitle.trim().replace(' - Confluence', ''));
        const filename = `${safeFilename}.pdf`;

        // Final Output Directory
        const finalDir = path.join(outputDir, relativePath);
        if (!fs.existsSync(finalDir)) {
            fs.mkdirSync(finalDir, { recursive: true });
        }

        const outputPath = path.join(finalDir, filename);

        if (fs.existsSync(outputPath)) {
            console.log(`  - File exists, skipping: ${path.join(relativePath, filename)}`);
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
        // User requested: role="menuitem" data-vc="link-item"
        // This usually triggers navigation to a processing page
        const exportPdfLink = page.locator('a[role="menuitem"][data-vc="link-item"]').filter({ hasText: /Export to PDF/i });
        await exportPdfLink.first().waitFor({ state: 'visible', timeout: 5000 });

        // We do NOT wait for download event here immediately, because it might navigate first
        await exportPdfLink.first().click();

        // 4. Handle "Exporting / Processing" page
        // The URL usually changes to .../pdfpageexport.action...
        console.log("  - Waiting for export processing...");

        // Wait for the "Download PDF" link to appear
        const downloadLink = page.locator('#downloadableLink_dynamic');

        // It might take some time for the export to finish generating
        await downloadLink.waitFor({ state: 'visible', timeout: 60000 });
        console.log("  - PDF ready. Downloading...");

        // 5. Click the final download link
        const downloadPromise = page.waitForEvent('download', { timeout: config.timeout });
        await downloadLink.click();

        const download = await downloadPromise;
        await download.saveAs(outputPath);

        console.log(`  - Download complete: ${path.join(relativePath, filename)}`);
        return true;

    } catch (err: any) {
        console.error(`  - Error exporting ${pageUrl}: ${err.message}`);

        try {
            const screenshotPath = path.join(outputDir, `error_${Date.now()}.png`);
            await page.screenshot({ path: screenshotPath });
        } catch (e) { }

        return false;
    }
}
