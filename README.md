# Google Maps Business Scraper

This Node.js application transforms an n8n workflow into a standalone scraper that extracts business information from Google Maps search results.

## Features

- Scrapes Google Maps search results
- Extracts business names, phone numbers, and websites
- Visits individual websites to collect email addresses
- Filters and deduplicates data
- Combines all information into structured results

## Installation

1. Install dependencies:

```bash
npm install
```

## Usage

### Flexible Business Scraper (Recommended)

```bash
# Search for any business type in any city
node run.js "dentiste"
node run.js "restaurant" "casablanca"
node run.js "avocat" "rabat" 15
node run.js "Concepteur de sites web" "fes"
node run.js "plombier" "marrakech" 10
```

**Parameters:**

- `business_type` - Type of business to search for (required)
- `location` - City to search in (default: "fes")
- `max_results` - Maximum number of businesses to find (default: 20)

### Basic Usage (Legacy)

```bash
npm start
```

### Programmatic Usage

```javascript
const FlexibleBusinessScraper = require("./run.js");

const scraper = new FlexibleBusinessScraper();
scraper.scrapeBusinesses("dentiste", "fes", 20).then((results) => {
  console.log(results);
});
```

## How it Works

The scraper follows this workflow:

1. **Google Maps Scraping**: Fetches search results from Google Maps
2. **Data Extraction**: Extracts business names, phone numbers, and website URLs
3. **Website Scraping**: Visits each website to find email addresses
4. **Data Processing**: Filters, deduplicates, and combines all information
5. **Output**: Returns structured data with names, phone numbers, and emails

## Output Format

The scraper returns an array of business objects:

```javascript
[
  {
    name: "Business Name",
    number: "+212 6XX XXX XXX",
    emails: ["contact@business.com", "info@business.com"],
  },
];
```

## Configuration

You can modify the search query by passing it to the `scrape()` method:

```javascript
const results = await scraper.scrape("restaurant+casablanca");
```

## Notes

- The scraper includes delays between requests to be respectful to servers
- Email extraction filters out common non-business emails (no-reply, sentry, etc.)
- Phone number regex is configured for Moroccan phone numbers
- Results are automatically saved to `results.json`

## Legal Notice

Please ensure you comply with Google's Terms of Service and robots.txt when using this scraper. Use responsibly and consider rate limiting for large-scale operations.
