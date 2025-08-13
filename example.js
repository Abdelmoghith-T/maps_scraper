const MapsScraper = require('./index.js');

async function runExample() {
  const scraper = new MapsScraper();
  
  try {
    console.log('Starting Google Maps scraping example...\n');
    
    // You can customize the search query here
    const searchQuery = 'cabient+dentaire+atlas'; // Default from n8n workflow
    // const searchQuery = 'restaurant+casablanca'; // Alternative example
    
    const results = await scraper.scrape(searchQuery);
    
    console.log('\n=== SCRAPING RESULTS ===');
    console.log(`Total businesses found: ${results.length}\n`);
    
    results.forEach((business, index) => {
      console.log(`${index + 1}. Business: ${business.name}`);
      console.log(`   Phone: ${business.number || 'Not available'}`);
      console.log(`   Emails: ${business.emails.length > 0 ? business.emails.join(', ') : 'Not available'}`);
      console.log('   ---');
    });

    // Save results to file
    const fs = require('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `results_${timestamp}.json`;
    
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to: ${filename}`);
    
    return results;
    
  } catch (error) {
    console.error('Example failed:', error);
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  runExample();
}

module.exports = runExample;
