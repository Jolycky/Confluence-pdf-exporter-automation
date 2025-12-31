import { Page } from 'playwright';

export interface PageInfo {
    title: string;
    url: string;
}

export interface SpaceData {
    spaceName: string;
    pages: PageInfo[];
}

// Helper to get Space Key from URL or UI
function getSpaceKey(spaceUrl: string): string {
    // Try to match standard pattern /spaces/KEY/
    const match = spaceUrl.match(/spaces\/([^\/]+)/);
    // If not found, maybe it's just /display/KEY/
    const matchDisplay = spaceUrl.match(/display\/([^\/]+)/);

    return match ? match[1] : (matchDisplay ? matchDisplay[1] : '');
}

export async function getSpacePages(page: Page, spaceUrl: string): Promise<SpaceData> {
    console.log(`Navigating to space to find pages: ${spaceUrl}`);

    await page.goto(spaceUrl);
    await page.waitForLoadState('domcontentloaded');

    // Extract Space Name
    let spaceName = "Unknown Space";
    try {
        const header = page.locator('[data-testid="space-header"] h1, h1[data-test-id="space-header-title"]');
        if (await header.count() > 0) {
            spaceName = (await header.first().textContent()) || spaceName;
        } else {
            const title = await page.title();
            const parts = title.split(' - ');
            if (parts.length >= 2) spaceName = parts[parts.length - 2];
        }
    } catch (e) { }
    spaceName = spaceName.trim();
    console.log(`Detected Space Name: ${spaceName}`);

    // Determine Space Key
    let spaceKey = getSpaceKey(spaceUrl);
    if (!spaceKey) {
        // Try to get from meta tag
        spaceKey = await page.getAttribute('meta[name="confluence-space-key"]', 'content') || '';
    }
    console.log(`Detected Space Key: ${spaceKey}`);

    if (!spaceKey) {
        console.warn("Could not determine Space Key from URL. Trying to scrape UI context...");
        try {
            // AJS provided by Confluence usually
            const keyFromVar = await page.evaluate(() => (window as any).AJS?.params?.spaceKey);
            if (keyFromVar) spaceKey = keyFromVar;
        } catch (e) { }
    }

    if (!spaceKey) {
        throw new Error("Failed to determine Space Key. Cannot proceed with API fetch.");
    }

    // Attempt to improve Space Name using API if it is unknown
    if (spaceName === "Unknown Space") {
        console.log(`Fetching Space Name for key ${spaceKey} via API...`);
        try {
            const name = await page.evaluate(async (sKey) => {
                try {
                    // Determine path prefix
                    const pathPrefix = window.location.pathname.startsWith('/wiki') ? '/wiki' : '';
                    const resp = await window.fetch(`${pathPrefix}/rest/api/space/${sKey}`);
                    if (resp.ok) {
                        const data = await resp.json();
                        return data.name;
                    }
                } catch (e) { }
                return null;
            }, spaceKey);

            if (name) {
                spaceName = name;
                console.log(`Updated Space Name via API: ${spaceName}`);
            } else {
                // Fallback to key if name still not found
                spaceName = spaceKey;
                console.log(`Using Space Key as Name: ${spaceName}`);
            }
        } catch (e) {
            console.warn("Failed to fetch space name via API, using Key.");
            spaceName = spaceKey;
        }
    }

    // INTERNAL API FETCH STRATEGY
    // This runs INSIDE the browser, using the user's existing auth session.
    console.log("Fetching pages via internal API...");

    const pages = await page.evaluate(async (sKey) => {
        const allPages: any[] = [];
        let start = 0;
        const limit = 50;

        // Dynamic context path detection
        // Confluence Cloud usually is /wiki, but just in case.
        const pathPrefix = window.location.pathname.startsWith('/wiki') ? '/wiki' : '';
        const apiEndpoint = `${pathPrefix}/rest/api/content`;
        console.log(`Using API Endpoint: ${apiEndpoint}`);

        while (true) {
            try {
                const url = `${apiEndpoint}?spaceKey=${sKey}&type=page&limit=${limit}&start=${start}&expand=space,body.view,version`;
                console.log(`Fetching: ${url}`);
                const response = await window.fetch(url);

                if (response.status === 401 || response.status === 403) {
                    return { error: `Authentication failed (Status ${response.status}). Please delete auth.json and re-login.` };
                }

                if (!response.ok) {
                    console.error("Fetch returned status:", response.status);
                    return { error: `API Fetch failed with status ${response.status} for URL ${url}` };
                }

                const data = await response.json();
                const results = data.results;

                if (!results || results.length === 0) break;

                // Map to our structure
                // API returns: { id, title, _links: { webui } }
                const mapped = results.map((r: any) => ({
                    title: r.title,
                    // Construct full URL from relative webui link
                    url: window.location.origin + pathPrefix + r._links.webui.replace(/^\/wiki/, '')
                }));

                allPages.push(...mapped);

                if (results.length < limit) break; // Finished
                start += limit;

            } catch (e: any) {
                console.error("API Fetch Error:", e);
                return { error: `Exception during fetch: ${e.message}` };
            }
        }
        return allPages;
    }, spaceKey);

    if (Array.isArray(pages)) {
        console.log(`Found ${pages.length} pages via API.`);
        return {
            spaceName,
            pages: pages
        };
    } else {
        // This will be caught by index.ts main loop
        throw new Error("Failed to fetch pages: " + JSON.stringify(pages));
    }
}
