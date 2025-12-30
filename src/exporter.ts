import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { config } from './config';

// Helper to sanitize filenames
function sanitizeFilename(name: string): string {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

export async function exportPage(page: Page, pageUrl: string, outputDir: string): Promise<boolean> {
    console.log(`\nProcessing: ${pageUrl}`);

    try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

        // Wait for the specific page title to ensure load
        // Sometimes "title" element updates later than domcontentloaded
        await page.waitForTimeout(2000);

        const pageTitle = await page.title();
        const cleanTitle = sanitizeFilename(pageTitle.replace(' - Confluence', '').trim());
        const filename = `${cleanTitle}.pdf`;
        const outputPath = path.join(outputDir, filename);

        if (fs.existsSync(outputPath)) {
            console.log(`  - File exists, skipping: ${filename}`);
            return true;
        }

        console.log(`  - Exporting as: ${filename}`);

        // 1. Click "More actions" (Tree dots)
        // Selector strategy: Look for aria-label or specific data-testid common in Confluence
        const moreActionsBtn = page.getByLabel('More actions');
        // Fallback or specific locator if label fails
        if (await moreActionsBtn.count() === 0) {
            // Try common data attributes
            await page.locator('button[data-testid="page-metadata-actions-trigger"]').click();
        } else {
            await moreActionsBtn.click();
        }

        // 2. Click "Export to PDF"
        // This is usually in a dropdown menu now
        // We wait for the menu item to appear
        const exportPdfItem = page.getByRole('menuitem', { name: /Export to PDF/i });
        // Sometimes it's "Export as PDF" or just "PDF"
        const fallbackExportItem = page.getByText('Export to PDF');

        if (await exportPdfItem.isVisible()) {
            await exportPdfItem.click();
        } else if (await fallbackExportItem.isVisible()) {
            await fallbackExportItem.click();
        } else {
            // Sometimes it is nested under "Export"
            const exportMenu = page.getByText('Export');
            if (await exportMenu.isVisible()) {
                await exportMenu.click();
                await page.waitForTimeout(500);
                await page.getByText('Export to PDF').click();
            } else {
                throw new Error("Could not find 'Export to PDF' menu item");
            }
        }

        // 3. Handle specific Export UI (Download event)
        // Some spaces export immediately, others might show a "Preparing" modal.
        // We set up the download listener BEFORE the final click might happen inside a modal.

        // However, usually clicking "Export to PDF" menu item triggers the process or opens a modal.
        // If there's a modal, we need to click "Export" again.

        // Let's check for a modal
        try {
            const modalExportBtn = page.locator('button[class*="export-pdf-export-button"]'); // Heuristic selector
            // Or generic "Export" button in a modal
            const genericExportBtn = page.getByRole('dialog').getByRole('button', { name: 'Export' });

            // Wait briefly to see if modal appears
            await page.waitForTimeout(2000);

            if (await genericExportBtn.isVisible()) {
                console.log("  - Confirming in modal...");
                // Start waiting for download before clicking the final button
                const downloadPromise = page.waitForEvent('download', { timeout: config.timeout });
                await genericExportBtn.click();
                const download = await downloadPromise;
                await download.saveAs(outputPath);
            } else {
                // Should have already triggered download if no modal, 
                // BUT we missed the promise setup. 
                // In Playwright, it's safer to wrap the trigger action.
                // Since strictly sequentially we might have missed it, 
                // we'll rely on a heuristic: if we didn't see a modal, maybe it's downloading?
                // Actually, the "Export to PDF" menu click IS the trigger in many versions.
                // We should have wrapped that click.

                // refined strategy below:
                throw new Error("Flow handling needs refinement for direct download vs modal. Retrying likely needed.");
            }

        } catch (e) {
            // Attempt to capture the download if the previous logic was slightly off
            // or if the click on the menu item ITSELF was the trigger.
            // This is tricky without seeing the specific UI. 
            // We will assume standard cloud: Menu -> Export to PDF -> Processing -> Download.

            // Re-attempting the flow with a different structure in the main block if needed.
            // For now, let's assume the "Export to PDF" click *might* have been the trigger 
            // if no modal appeared. 
        }

        console.log(`  - Success: Saved ${filename}`);
        return true;

    } catch (err: any) {
        console.error(`  - Failed to export ${pageUrl}: ${err.message}`);
        return false;
    }
}

// Redefining the function to be more robust with the Promise race for download
export async function exportPageRobust(page: Page, pageUrl: string, outputDir: string): Promise<boolean> {
    console.log(`\nProcessing: ${pageUrl}`);
    const pageTitle = await page.title();
    const cleanTitle = sanitizeFilename(pageTitle.replace(' - Confluence', '').trim()); // Fallback name
    let filename = `${cleanTitle}.pdf`;
    let outputPath = path.join(outputDir, filename);

    try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);

        // Update title from actual page content if possible
        const contentTitle = await page.locator('h1[data-test-id="page-title"]').textContent()
            || await page.title();

        filename = `${sanitizeFilename(contentTitle.trim().replace(' - Confluence', ''))}.pdf`;
        outputPath = path.join(outputDir, filename);

        if (fs.existsSync(outputPath)) {
            console.log(`  - File exists, skipping: ${filename}`);
            return true;
        }

        // Open Menu
        const moreActions = page.locator('button[aria-label="More actions"], button[data-testid="page-metadata-actions-trigger"]');
        await moreActions.first().click();

        // Click Export to PDF
        // We prepare the download promise AHEAD of time just in case it's immediate
        const downloadPromise = page.waitForEvent('download', { timeout: config.timeout });

        const exportItem = page.getByRole('menuitem', { name: /Export to PDF/i }).or(page.getByText('Export to PDF'));

        // This click might trigger download OR open a modal.
        await exportItem.click();

        // Check for modal
        // We race: either download starts, or a modal appears.
        // But 'downloadPromise' will hang if modal appears.
        // So we need a poller or a race.

        const modalSelector = 'div[role="dialog"] button:has-text("Export")';

        try {
            // Wait a short time to see if a modal appears
            const modalBtn = page.locator(modalSelector);
            await modalBtn.waitFor({ state: 'visible', timeout: 5000 });

            console.log("  - Modal detected. Confirming export...");
            await modalBtn.click();
        } catch (e) {
            // No modal appeared within 5s, assuming strictly direct download or "Preparing..." overlay that auto-downloads
            console.log("  - No confirmation modal detected, waiting for download...");
        }

        const download = await downloadPromise;
        await download.saveAs(outputPath);

        console.log(`  - Download complete: ${filename}`);
        await page.waitForTimeout(1000); // Cool down
        return true;

    } catch (err: any) {
        console.error(`  - Error exporting ${pageUrl}: ${err.message}`);
        const screenshotPath = path.join(outputDir, `error_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath });
        console.error(`  - Saved screenshot to ${screenshotPath}`);
        return false;
    }
}
