import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { setupAuth } from './auth';
import { getSpacePages } from './crawler';
import { exportPageRobust } from './exporter';

async function main() {
    console.log("=== Confluence Cloud PDF Exporter ===");

    // 0. Ensure Output Directory
    if (!fs.existsSync(config.outputDir)) {
        fs.mkdirSync(config.outputDir, { recursive: true });
    }

    // 1. Auth Check
    if (!fs.existsSync(config.authFile)) {
        console.log("Auth file not found. Running setup...");
        await setupAuth();
    }

    const browser = await chromium.launch({
        headless: config.headless
    });

    // Create context with saved auth
    const context = await browser.newContext({
        storageState: config.authFile,
        acceptDownloads: true
    });

    const page = await context.newPage();

    try {
        // 2. Scan for pages
        console.log("\n--- Phase 1: Scanning for Pages ---");
        const pages = await getSpacePages(page, config.spaceUrl);

        console.log(`\nFound ${pages.length} pages to export.`);

        // Save list for debug
        fs.writeFileSync(
            path.join(config.outputDir, 'pages-list.json'),
            JSON.stringify(pages, null, 2)
        );

        // 3. Export Loop
        console.log("\n--- Phase 2: Exporting Pages ---");

        let successCount = 0;
        let failCount = 0;

        for (const [index, p] of pages.entries()) {
            console.log(`[${index + 1}/${pages.length}] Starting export for: ${p.title}`);
            const success = await exportPageRobust(page, p.url, config.outputDir);

            if (success) {
                successCount++;
            } else {
                failCount++;
            }

            // Rate limiting / Humanization
            await page.waitForTimeout(2000);
        }

        console.log("\n=== Export Complete ===");
        console.log(`Success: ${successCount}`);
        console.log(`Failed:  ${failCount}`);

    } catch (error) {
        console.error("Critical error in main loop:", error);
    } finally {
        await browser.close();
    }
}

if (require.main === module) {
    main().catch(console.error);
}
