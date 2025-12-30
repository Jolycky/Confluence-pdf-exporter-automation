import { Page } from 'playwright';

export interface PageInfo {
    title: string;
    url: string;
}

export async function getSpacePages(page: Page, spaceUrl: string): Promise<PageInfo[]> {
    console.log(`Navigating to space to find pages: ${spaceUrl}`);

    // Attempt to construct the Pages URL. 
    // If spaceUrl is ".../overview", try switching to ".../pages"
    let pagesUrl = spaceUrl;
    if (spaceUrl.endsWith('/overview')) {
        pagesUrl = spaceUrl.replace('/overview', '/pages');
    } else if (!spaceUrl.endsWith('/pages')) {
        // Just append /pages if it looks like a root space URL
        pagesUrl = spaceUrl.replace(/\/$/, '') + '/pages';
    }

    console.log(`Going to Pages view: ${pagesUrl}`);
    await page.goto(pagesUrl);
    await page.waitForLoadState('networkidle');

    // Wait for the main list container. 
    // Selectors vary by Confluence version. We'll look for common table rows or list items.
    // Try to click "All pages" or "Page tree" if available to ensure we see everything.
    // However, the default view often shows "Recently updated". We want "All pages".
    // We'll look for a link text "All pages" or similar only if we aren't sure.

    const allPagesLink = page.getByRole('link', { name: 'All pages', exact: false }); // "See all pages" etc
    if (await allPagesLink.count() > 0 && await allPagesLink.isVisible()) {
        try {
            // It might be already active?
            await allPagesLink.first().click();
            await page.waitForLoadState('domcontentloaded');
        } catch (e) {
            console.log("Could not click 'All pages', proceeding with current view.");
        }
    }

    // SCROLLING / PAGINATION
    console.log("Scrolling to load all pages...");
    let previousHeight = 0;
    const scrollDelay = 2000;
    const maxScrolls = 100; // Safety limit

    for (let i = 0; i < maxScrolls; i++) {
        previousHeight = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(scrollDelay);

        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight === previousHeight) {
            // Check if there is a "Load more" button
            const loadMore = page.getByRole('button', { name: /Load more/i });
            if (await loadMore.count() > 0 && await loadMore.isVisible()) {
                await loadMore.first().click();
                await page.waitForTimeout(scrollDelay);
            } else {
                console.log("Reached bottom of page list.");
                break;
            }
        }
    }

    // COLLECT LINKS
    // We are looking for links to pages. 
    // Pattern: /wiki/spaces/KEY/pages/PAGEID/Title
    // We filter for unique hrefs.

    console.log("Extracting links...");
    const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        return anchors
            .map(a => ({
                title: a.innerText.trim(),
                url: a.href
            }))
            .filter(item => {
                return item.url.includes('/pages/') &&
                    !item.url.includes('/pages/edit') && // ignore edit links
                    !item.url.includes('?'); // ignore query params often used for sorting
            });
    });

    // Deduplicate
    const uniquePages = new Map<string, PageInfo>();
    for (const link of links) {
        if (link.title && link.url) {
            uniquePages.set(link.url, link);
        }
    }

    console.log(`Found ${uniquePages.size} potential pages.`);
    return Array.from(uniquePages.values());
}
