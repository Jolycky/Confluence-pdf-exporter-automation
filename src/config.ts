export const config = {
    // URL of the Confluence Space Home or Pages list
    // Example: https://your-domain.atlassian.net/wiki/spaces/SPACEKEY/overview
    // You can set this here or via SPACE_URL environment variable
    spaceUrl: process.env.SPACE_URL || "https://your-domain.atlassian.net/wiki/spaces/SPACEKEY/overview",

    // Directory to save PDFs
    outputDir: "./output",

    // Path to the auth file (cookies)
    authFile: "./auth.json",

    // Headless mode (true = hidden browser, false = visible)
    headless: false,

    // Timeout (ms) for operations
    timeout: 60000
};
