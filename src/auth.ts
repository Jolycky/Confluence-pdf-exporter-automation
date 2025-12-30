import { chromium } from 'playwright';
import * as fs from 'fs';
import * as readline from 'readline';
import { config } from './config';

async function setupAuth() {
    console.log("Checking for existing auth state...");

    if (fs.existsSync(config.authFile)) {
        console.log(`Found ${config.authFile}. Proceeding...`);
        return;
    }

    console.log("Auth file not found. Launching browser for manual login...");
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`Navigating to ${config.spaceUrl}...`);
    await page.goto(config.spaceUrl);

    console.log("Please log in to Confluence in the browser window.");
    console.log("Once you have successfully logged in and can see the Space page, press ENTER in this terminal.");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    await new Promise<void>(resolve => {
        rl.question("Press ENTER to save session and exit...", () => {
            rl.close();
            resolve();
        });
    });

    // Save storage state
    await context.storageState({ path: config.authFile });
    console.log(`Session saved to ${config.authFile}`);

    await browser.close();
}

if (require.main === module) {
    setupAuth().catch(console.error);
}

export { setupAuth };
