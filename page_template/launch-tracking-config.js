window.launchTrackingConfig = {
    // Google Apps Script web app URL.
    // Example: https://script.google.com/macros/s/AKfycb.../exec
    appScriptUrl: "https://script.google.com/macros/s/AKfycbyUIBCtr6azQwxAMGdEAiVQIcX1yvQWHdfVs41lViRHPNBbxi7PHiLw6vdjT2iwZlqK/exec",

    // Sheet name for automatic visitor logs.
    visitorsTable: "visitors",

    // Sheet name for launch notification signups.
    launchTable: "tab_final",

    // Sheet name for first-screen choice logs.
    confessionTable: "intro_choices",

    // Optional JSONP IP lookup. Leave as-is if you want the same structure as index_white.html.
    ipLookupUrl: "https://jsonip.com?format=jsonp",

    // Set to false in production if you want fewer console logs.
    debug: true
};
