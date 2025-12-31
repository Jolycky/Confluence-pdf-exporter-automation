import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { setupAuth } from './auth';
import { getSpacePages } from './crawler';
import { exportPageRobust } from './exporter';

const HISTORY_FILE = path.join(config.outputDir, 'export-history.json');

// Helper to load history
function loadHistory(): Record<string, boolean> {
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        } catch (e) {
            console.warn("Could not parse history file, starting fresh.");
        }
    }
    return {};
}

// Helper to save history
function saveHistory(history: Record<string, boolean>) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

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
        // Load History
        const history = loadHistory();

        // 2. Scan for pages
        console.log("\n--- Phase 1: Scanning for Pages ---");
        const { pages, spaceName } = await getSpacePages(page, config.spaceUrl);

        console.log(`\nVerified Space Name: ${spaceName}`);
        console.log(`Found ${pages.length} total pages.`);

        // Setup Space Output Directory
        const safeSpaceName = spaceName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const spaceOutputDir = path.join(config.outputDir, safeSpaceName);

        if (!fs.existsSync(spaceOutputDir)) {
            console.log(`Creating directory: ${spaceOutputDir}`);
            fs.mkdirSync(spaceOutputDir, { recursive: true });
        }

        // Filter out already exported pages
        const pagesToExport = pages.filter(p => !history[p.url]);
        console.log(`Skipping ${pages.length - pagesToExport.length} already exported pages.`);
        console.log(`Remaining pages to export: ${pagesToExport.length}`);

        if (pagesToExport.length === 0) {
            console.log("All pages have already been exported!");
            return;
        }

        // Save list for debug
        fs.writeFileSync(
            path.join(spaceOutputDir, 'pages-list.json'),
            JSON.stringify(pages, null, 2)
        );

        // 3. Export Loop
        console.log("\n--- Phase 2: Exporting Pages ---");

        let successCount = 0;
        let failCount = 0;

        for (const [index, p] of pagesToExport.entries()) {
            console.log(`[${index + 1}/${pagesToExport.length}] Starting export for: ${p.title}`);
            const success = await exportPageRobust(page, p.url, spaceOutputDir);

            if (success) {
                successCount++;
                // Update history immediately
                history[p.url] = true;
                saveHistory(history);
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
