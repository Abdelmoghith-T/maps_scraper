const fs = require('fs');
const MapsScraper = require('./index.js');
const { extractAdresse } = require('./utils');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Address Regex Debugger

Usage:
  node debug-addresses.js "<business type> <city>"   # Fetch Google Maps HTML, extract addresses
  node debug-addresses.js --file <path/to/html>       # Read HTML from file and extract addresses

Examples:
  node debug-addresses.js "dentiste fes"
  node debug-addresses.js "restaurant casablanca"
  node debug-addresses.js --file sample.html
`);
    process.exit(1);
  }

  let html = '';

  try {
    if (args[0] === '--file' || args[0] === '-f') {
      const filePath = args[1];
      if (!filePath) throw new Error('Missing file path after --file');
      html = fs.readFileSync(filePath, 'utf-8');
      console.log(`Reading HTML from file: ${filePath}`);
    } else {
      const query = args.join(' ').trim();
      const searchQuery = query.replace(/\s+/g, '+');
      console.log(`Fetching Google Maps HTML for query: ${query}`);
      const scraper = new MapsScraper();
      html = await scraper.scrapeGoogleMaps(searchQuery);
      if (!html) throw new Error('No HTML returned from Google Maps');
    }

    const candidates = extractAdresse(html);
    console.log(`\nTotal address candidates found: ${candidates.length}`);

    // Save full HTML to a file for inspection
    try {
      const outPath = 'debug_addresses_source.html';
      fs.writeFileSync(outPath, html);
      console.log(`Saved full HTML to: ${outPath}`);
    } catch (e) {
      console.log(`Could not save source HTML: ${e.message}`);
    }

    if (candidates.length > 0) {
      // Sort by length desc for easier inspection
      const sorted = [...candidates].sort((a, b) => b.length - a.length);
      const selected = sorted[0];

      console.log(`\nAll candidates (sorted by length):`);
      sorted.forEach((addr, i) => {
        console.log(`${String(i + 1).padStart(2, ' ')}. [${addr.length}] ${addr}`);
      });

      console.log(`\nSelected (longest):`);
      console.log(selected);

      // Also show HTML context around each match (first 10 by length)
      console.log(`\nHTML context around matches (first 10):`);
      const re = /([A-Za-zÀ-ÿ0-9\s'\-\.]+,\s*[A-Za-zÀ-ÿ0-9\s'\-\.]+,\s*[A-Za-zÀ-ÿ0-9\s'\-\.]+,\s*[A-Za-zÀ-ÿ0-9\s'\-\.]+)/g;
      const occurrences = [];
      let m;
      while ((m = re.exec(html)) !== null) {
        occurrences.push({ index: m.index, full: m[0], captured: (m[1] || '').replace(/\s+/g, ' ').trim() });
      }

      const used = new Set();
      sorted.slice(0, 10).forEach((addr, idx) => {
        const occIndex = occurrences.findIndex(o => o.captured === addr && !used.has(o));
        if (occIndex !== -1) {
          const occ = occurrences[occIndex];
          used.add(occ);
          const start = Math.max(0, occ.index - 200);
          const end = Math.min(html.length, occ.index + occ.full.length + 200);
          const snippet = html.slice(start, end);
          console.log(`\n#${idx + 1} [len=${addr.length}]`);
          console.log('--- snippet start ---');
          console.log(snippet);
          console.log('--- snippet end ---');
        }
      });
    } else {
      console.log('No address candidates matched the regex.');
    }

  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}


