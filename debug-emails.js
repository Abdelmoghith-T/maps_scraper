const axios = require('axios');
const utils = require('./utils');

async function debugEmailExtraction() {
  console.log('=== DEBUGGING EMAIL EXTRACTION ===\n');
  
  // Test websites from our results
  const testWebsites = [
    'https://debbaghdentalsmile.com',
    'https://www.mondentiste.ma/saad-debbagh-4173.htm',
    'https://drbadrkadri.com',
    'https://drkenzamoukhlesse.godoc.ma',
    'https://dentistefes.com'
  ];
  
  for (let i = 0; i < testWebsites.length; i++) {
    const website = testWebsites[i];
    console.log(`\n${i + 1}. Testing: ${website}`);
    console.log('='.repeat(50));
    
    try {
      console.log('Attempting to scrape...');
      
      const response = await axios.get(website, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        }
      });
      
      console.log(`✅ Successfully scraped (${response.status})`);
      console.log(`Content length: ${response.data.length} characters`);
      
      // Extract emails
      const emails = utils.extractEmails(response.data);
      console.log(`📧 Emails found: ${emails.length}`);
      
      if (emails.length > 0) {
        console.log('Emails:', emails);
      } else {
        console.log('❌ No emails found');
        
        // Let's check if there are any @ symbols at all
        const atSymbols = (response.data.match(/@/g) || []).length;
        console.log(`@ symbols in content: ${atSymbols}`);
        
        // Check for common email patterns manually
        const commonPatterns = [
          /contact@[^\s"'<>]+/gi,
          /info@[^\s"'<>]+/gi,
          /admin@[^\s"'<>]+/gi,
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
        ];
        
        commonPatterns.forEach((pattern, index) => {
          const matches = response.data.match(pattern) || [];
          if (matches.length > 0) {
            console.log(`Pattern ${index + 1} matches:`, matches.slice(0, 3));
          }
        });
        
        // Show a sample of the content to see what we're getting
        console.log('\nFirst 500 characters of content:');
        console.log(response.data.substring(0, 500));
        console.log('\n...\n');
        
        // Look for contact-related content
        const contactKeywords = ['contact', 'email', 'mail', '@', 'telephone', 'phone'];
        contactKeywords.forEach(keyword => {
          const index = response.data.toLowerCase().indexOf(keyword);
          if (index !== -1) {
            const start = Math.max(0, index - 50);
            const end = Math.min(response.data.length, index + 100);
            console.log(`Found "${keyword}" at position ${index}:`);
            console.log(`"${response.data.substring(start, end)}"`);
          }
        });
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      
      if (error.code === 'ENOTFOUND') {
        console.log('   → Domain not found (DNS resolution failed)');
      } else if (error.code === 'ECONNREFUSED') {
        console.log('   → Connection refused (server not responding)');
      } else if (error.code === 'ETIMEDOUT') {
        console.log('   → Connection timeout');
      } else if (error.response) {
        console.log(`   → HTTP ${error.response.status}: ${error.response.statusText}`);
      }
    }
    
    // Add delay between requests
    if (i < testWebsites.length - 1) {
      console.log('\nWaiting 2 seconds before next request...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n=== EMAIL EXTRACTION DEBUG COMPLETE ===');
}

// Run the debug
debugEmailExtraction();
