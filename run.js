const MapsScraper = require('./index.js');
const fs = require('fs');
const axios = require('axios');

// Helper: Select best address candidate using Gemini generateContent API
async function selectAddressWithGemini(candidates, businessName, location) {
  try {
    if (!Array.isArray(candidates) || candidates.length === 0) return '';

    const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyBkGk8FvU37dEp29MuXup1wU4yei7ta1TI';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const numbered = candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
    const systemInstruction =  `You are given a numbered list of ADDRESS CANDIDATES extracted from Google Maps HTML for a single business.
    Business: "${businessName}"
    City / context: "${location}"
    
    TASK:
    Select the single candidate that is the most likely FULL POSTAL ADDRESS for the business, and RESPOND WITH EXACTLY that candidate string from the list — NOTHING ELSE, no quotes, no extra words, no numbering, no explanation. If none of the candidates appears to be a full postal address, respond with an empty string (i.e. return nothing / a blank response).
    
    IMPORTANT HEURISTICS (use in roughly this order):
    1) Prefer candidates that include a street number + street name (e.g. "12 Rue de ..."), or clear street indicators (Rue, Avenue, Av., Blvd, Rd, St, شارع, etc.).
    2) Prefer candidates that include the CITY/context string or a plausible locality (city/neighborhood) or postal code.
    3) Prefer candidates containing the business name (or a clear substring of it) if that indicates the candidate is the business's address.
    4) Prefer candidates that look like full addresses (contain multiple address components separated by commas or line breaks: street, locality/city, postal code/country).
    5) Penalize short fragments, UI text, review snippets, hours, phone numbers alone, photo/review captions, or "Open" / "Closed" labels.
    
    LANGUAGE NOTES:
    - Addresses may be in French, Arabic, English, or mixed; handle diacritics and non-Latin scripts.
    - Keep the original candidate text exactly as-is when returning (do not normalize or alter the returned string).
    
    STRICT OUTPUT RULES:
    - Output exactly one line: the chosen candidate string exactly as it appears in the provided list.
    - If no candidate is clearly a postal address, output nothing (an empty response).
    - Do NOT add punctuation, brackets, comments, JSON, or any extra characters.
    
    EXAMPLES:
    
    Example A
    Candidates:
    1. "La Maison — Open daily, tel: +212……"
    2. "12 Rue de la Liberté, Fès 30000, Morocco"
    3. "Bakery - homemade pastries"
    Business: "La Maison"
    City: "Fès"
    Correct model reply (exactly):
    12 Rue de la Liberté, Fès 30000, Morocco
    
    Example B (no clear address)
    Candidates:
    1. "Open 9–5 — contact: +212…"
    2. "Photos and reviews"
    Business: "X"
    City: "Rabat"
    Correct model reply (exactly):
    <empty response — i.e. return nothing>
    
    END OF INSTRUCTIONS.`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: systemInstruction + `\n\nCandidates:\n${numbered}` }
          ]
        }
      ]
    };

    const resp = await axios.post(endpoint, body, {
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const texts = ((resp && resp.data && resp.data.candidates && resp.data.candidates[0] && resp.data.candidates[0].content && resp.data.candidates[0].content.parts) || [])
      .map(p => (p && p.text) ? String(p.text) : '')
      .filter(Boolean);
    const raw = texts.join(' ').trim();
    if (!raw) return '';

    // Normalize and try to map back to one of the candidates
    const normalize = (s) => s.replace(/\s+/g, ' ').trim();
    const normalizedRaw = normalize(raw);

    // Exact match first
    const exact = candidates.find(c => normalize(c) === normalizedRaw);
    if (exact) return exact;

    // Fuzzy containment
    const contains = candidates.find(c => normalize(c).includes(normalizedRaw) || normalizedRaw.includes(normalize(c)));
    if (contains) return contains;

    // Fallback: choose the longest candidate
    return candidates.reduce((a, b) => (b.length > a.length ? b : a), '');
  } catch (e) {
    return '';
  }
}

class FlexibleBusinessScraper {
  constructor() {
    this.scraper = new MapsScraper();
  }

  // Individual search for each business to get accurate data
  async searchIndividualBusiness(businessName, location) {
    try {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔍 SEARCHING: "${businessName.substring(0, 60)}${businessName.length > 60 ? '...' : ''}"`);
      console.log(`📍 LOCATION: ${location.toUpperCase()}`);
      console.log(`${'='.repeat(80)}`);

      // Create search query with location to ensure local results
      const searchQuery = `${businessName.replace(/\s+/g, '+')}+${location}`;
      console.log(`🔗 Query: ${searchQuery}`);

      // Scrape Google Maps for this specific business
      console.log(`⏳ Scraping Google Maps...`);
      const googleMapsData = await this.scraper.scrapeGoogleMaps(searchQuery);

      if (!googleMapsData) {
        console.log(`❌ ERROR: No data found from Google Maps`);
        console.log(`${'='.repeat(80)}\n`);
        return null;
      }

      console.log(`✅ SUCCESS: Google Maps data retrieved`);

      // Extract data
      console.log(`\n📊 EXTRACTING DATA:`);
      const phoneNumbers = require('./utils').extractPhoneNumbers(googleMapsData);
      const businessNames = require('./utils').extractBusinessNames(googleMapsData);
      const parts = require('./utils').extractGoogleMapsParts(googleMapsData);

      console.log(`   📞 Phone numbers found: ${phoneNumbers.length}`);
      if (phoneNumbers.length > 0) {
        phoneNumbers.slice(0, 3).forEach((phone, i) => {
          console.log(`      ${i + 1}. ${phone}`);
        });
        if (phoneNumbers.length > 3) console.log(`      ... and ${phoneNumbers.length - 3} more`);
      }

      console.log(`   🏢 Business names found: ${businessNames.length}`);
      if (businessNames.length > 0) {
        businessNames.slice(0, 2).forEach((name, i) => {
          console.log(`      ${i + 1}. ${name.substring(0, 50)}${name.length > 50 ? '...' : ''}`);
        });
        if (businessNames.length > 2) console.log(`      ... and ${businessNames.length - 2} more`);
      }

      // Filter and extract websites
      console.log(`\n🌐 EXTRACTING WEBSITES:`);
      console.log(`   🔗 Raw data parts found: ${parts.length}`);
      const filteredParts = require('./utils').filterSocialMediaParts(parts);
      console.log(`   ✅ After filtering social media: ${filteredParts.length} parts`);

      const websites = require('./utils').removeDuplicates(
        require('./utils').extractWebsites(filteredParts, googleMapsData)
      );

      console.log(`   🌐 Legitimate websites found: ${websites.length}`);
      if (websites.length > 0) {
        websites.forEach((website, i) => {
          console.log(`      ${i + 1}. ${website}`);
        });
      }

      // Find the best matching business name
      console.log(`\n🎯 MATCHING BUSINESS NAME:`);
      let bestBusinessName = businessName; // Default fallback
      if (businessNames.length > 0) {
        console.log(`   🔍 Searching for best match among ${businessNames.length} names...`);
        // Find the business name that best matches our search
        const searchTerms = businessName.toLowerCase().split(/\s+/);
        console.log(`   🔑 Search terms: [${searchTerms.join(', ')}]`);

        let bestMatch = businessNames[0];
        let bestScore = 0;

        for (const name of businessNames) {
          const nameLower = name.toLowerCase();
          let score = 0;
          for (const term of searchTerms) {
            if (nameLower.includes(term)) {
              score += term.length;
            }
          }
          if (score > bestScore) {
            bestScore = score;
            bestMatch = name;
          }
        }
        bestBusinessName = bestMatch;
        console.log(`   ✅ Best match: "${bestBusinessName}" (score: ${bestScore})`);
      } else {
        console.log(`   ⚠️  No business names found, using search term`);
      }

      // Extract address candidates and pick using Gemini
      const rawAddressCandidates = require('./utils').extractAdresse(googleMapsData);
      let address = '';
      if (rawAddressCandidates.length > 0) {
        console.log(`\n📍 ADDRESS CANDIDATES: ${rawAddressCandidates.length}`);
        const bestByAI = await selectAddressWithGemini(rawAddressCandidates, bestBusinessName, location);
        address = bestByAI || '';
        console.log(`📍 ADDRESS (selected): ${address || 'None'}`);
      }

      // Get the first phone number (most likely to be correct for individual search)
      const phoneNumber = phoneNumbers.length > 0 ? phoneNumbers[0] : '';
      console.log(`\n📞 SELECTED PHONE: ${phoneNumber || 'None found'}`);

      // Get the first website (most likely to be correct for individual search)
      const website = websites.length > 0 ? websites[0] : '';
      console.log(`🌐 SELECTED WEBSITE: ${website || 'None found'}`);

      // Scrape emails from website if available
      let emails = [];
      if (website) {
        console.log(`\n📧 EMAIL EXTRACTION:`);
        console.log(`   🔗 Scraping: ${website}`);
        try {
          console.log(`   ⏳ Waiting 1 second (rate limiting)...`);
          await require('./utils').wait(1); // Rate limiting
          console.log(`   🌐 Fetching website content...`);
          const websiteContent = await this.scraper.scrapeWebsite(website);
          console.log(`   📄 Content length: ${websiteContent ? websiteContent.length : 0} characters`);
          emails = require('./utils').extractEmails(websiteContent);
          console.log(`   ✅ Emails extracted from main page: ${emails.length}`);
          if (emails.length > 0) {
            emails.forEach((email, i) => {
              console.log(`      ${i + 1}. ${email}`);
            });
          } else {
            // If no emails found, try the contact page
            console.log(`   📧 No emails found on main page, trying contact page...`);
            const contactUrl = website.endsWith('/') ? `${website}contact` : `${website}/contact`;
            console.log(`   🔗 Scraping contact page: ${contactUrl}`);
            try {
              console.log(`   ⏳ Waiting 1 second (rate limiting)...`);
              await require('./utils').wait(1); // Rate limiting
              console.log(`   🌐 Fetching contact page content...`);
              const contactContent = await this.scraper.scrapeWebsite(contactUrl);
              console.log(`   📄 Contact page length: ${contactContent ? contactContent.length : 0} characters`);
              const contactEmails = require('./utils').extractEmails(contactContent);
              console.log(`   ✅ Emails extracted from contact page: ${contactEmails.length}`);
              if (contactEmails.length > 0) {
                emails = contactEmails;
                contactEmails.forEach((email, i) => {
                  console.log(`      ${i + 1}. ${email}`);
                });
              } else {
                console.log(`   ❌ No emails found on contact page either`);
              }
            } catch (contactError) {
              console.log(`   ❌ Contact page scraping failed: ${contactError.message}`);
            }
          }
        } catch (error) {
          console.log(`   ❌ Website scraping failed: ${error.message}`);
        }
      } else {
        console.log(`\n📧 EMAIL EXTRACTION: Skipped (no website found)`);
      }

      console.log(`\n📋 FINAL RESULT:`);
      console.log(`   🏢 Business: ${bestBusinessName}`);
      console.log(`   📍 Location: ${(address || location) || 'Not found'}`);
      console.log(`   📞 Phone: ${phoneNumber || 'Not found'}`);
      console.log(`   🌐 Website: ${website || 'Not found'}`);
      console.log(`   📧 Emails: ${emails.length > 0 ? emails.join(', ') : 'Not found'}`);
      console.log(`${'='.repeat(80)}\n`);

      return {
        name: bestBusinessName,
        phone: phoneNumber,
        website: website,
        emails: emails,
        location: address || location
      };

    } catch (error) {
      console.log(`\n❌ CRITICAL ERROR: ${error.message}`);
      console.log(`${'='.repeat(80)}\n`);
      return null;
    }
  }

  // Main function to scrape multiple businesses
  async scrapeBusinesses(businessType, location = 'fes', maxResults = 100) {
    try {
      console.log(`\n🚀 BUSINESS SCRAPER STARTED`);
      console.log(`📋 BUSINESS TYPE: "${businessType.toUpperCase()}"`);
      console.log(`📍 LOCATION: ${location.toUpperCase()}`);
      console.log(`🎯 TARGET: ${maxResults} businesses\n`);

      // First, get a list of businesses from general search
      console.log(`${'▓'.repeat(60)}`);
      console.log(`📋 STEP 1: GETTING BUSINESS LIST`);
      console.log(`${'▓'.repeat(60)}`);

      const searchQuery = `${businessType.replace(/\s+/g, '+')}+${location}`;
      console.log(`🔗 Search query: ${searchQuery}`);
      console.log(`⏳ Scraping Google Maps for business list...`);

      const googleMapsData = await this.scraper.scrapeGoogleMaps(searchQuery);

      if (!googleMapsData) {
        console.log(`❌ FATAL ERROR: No data found from Google Maps`);
        throw new Error('No data found from Google Maps');
      }

      console.log(`✅ Google Maps data retrieved successfully`);
      const businessNames = require('./utils').extractBusinessNames(googleMapsData);
      console.log(`📊 BUSINESSES FOUND: ${businessNames.length}`);

      if (businessNames.length === 0) {
        console.log(`❌ No businesses found for "${businessType}" in ${location}`);
        return [];
      }

      // Show the business list
      console.log(`\n📋 BUSINESS LIST:`);
      businessNames.slice(0, Math.min(10, businessNames.length)).forEach((name, i) => {
        console.log(`   ${i + 1}. ${name.substring(0, 70)}${name.length > 70 ? '...' : ''}`);
      });
      if (businessNames.length > 10) {
        console.log(`   ... and ${businessNames.length - 10} more businesses`);
      }

      // Limit to maxResults
      const businessesToSearch = businessNames.slice(0, maxResults);
      console.log(`\n🎯 SELECTED FOR INDIVIDUAL RESEARCH: ${businessesToSearch.length} businesses`);

      // Step 2: Search each business individually
      console.log(`\n${'▓'.repeat(60)}`);
      console.log(`🔍 STEP 2: INDIVIDUAL BUSINESS RESEARCH`);
      console.log(`${'▓'.repeat(60)}`);

      const results = [];

      for (let i = 0; i < businessesToSearch.length; i++) {
        const businessName = businessesToSearch[i];
        console.log(`\n${'░'.repeat(40)}`);
        console.log(`📊 PROGRESS: [${i + 1}/${businessesToSearch.length}] (${Math.round((i + 1) / businessesToSearch.length * 100)}%)`);
        console.log(`🏢 CURRENT: ${businessName.substring(0, 60)}${businessName.length > 60 ? '...' : ''}`);
        console.log(`${'░'.repeat(40)}`);

        const businessData = await this.searchIndividualBusiness(businessName, location);

        if (businessData) {
          results.push(businessData);
          console.log(`\n✅ BUSINESS ${i + 1} COMPLETED SUCCESSFULLY:`);
          console.log(`   📞 Phone: ${businessData.phone ? '✓ Found' : '✗ Not found'}`);
          console.log(`   🌐 Website: ${businessData.website ? '✓ Found' : '✗ Not found'}`);
          console.log(`   📧 Emails: ${businessData.emails.length > 0 ? `✓ Found (${businessData.emails.length})` : '✗ Not found'}`);
        } else {
          console.log(`\n❌ BUSINESS ${i + 1} FAILED - No data retrieved`);
        }

        // Rate limiting between searches
        if (i < businessesToSearch.length - 1) {
          console.log(`\n⏳ RATE LIMITING: Waiting 2 seconds before next search...`);
          await require('./utils').wait(2);
        }
      }

      console.log(`\n${'▓'.repeat(60)}`);
      console.log(`✅ ALL INDIVIDUAL SEARCHES COMPLETED`);
      console.log(`${'▓'.repeat(60)}`);
      console.log(`📊 TOTAL RESULTS: ${results.length}/${businessesToSearch.length} businesses`);

      return results;

    } catch (error) {
      console.log(`\n❌ CRITICAL SCRAPING ERROR: ${error.message}`);
      throw error;
    }
  }

  // Save results to file (overwrites previous results)
  saveResults(results, businessType, location) {
    const filename = 'scraping_results.json';

    // Create metadata for the results
    const resultData = {
      metadata: {
        businessType: businessType,
        location: location,
        totalResults: results.length,
        scrapedAt: new Date().toISOString(),
        scrapedAtLocal: new Date().toLocaleString()
      },
      results: results
    };

    fs.writeFileSync(filename, JSON.stringify(resultData, null, 2));
    console.log(`\n💾 Results saved to: ${filename}`);
    return filename;
  }

  // Display results summary
  displayResults(results, businessType, location) {
    console.log(`\n📊 FINAL SCRAPING RESULTS`);
    console.log(`📋 BUSINESS TYPE: ${businessType.toUpperCase()}`);
    console.log(`📍 LOCATION: ${location.toUpperCase()}`);
    console.log(`🎯 TOTAL BUSINESSES FOUND: ${results.length}\n`);

    if (results.length === 0) {
      console.log(`❌ NO RESULTS FOUND`);
      console.log(`   Try different search terms or location\n`);
      return;
    }

    console.log(`${'▓'.repeat(80)}`);
    console.log(`📋 DETAILED BUSINESS LIST`);
    console.log(`${'▓'.repeat(80)}`);

    results.forEach((business, index) => {
      console.log(`\n${index + 1}. ${'─'.repeat(70)}`);
      console.log(`🏢 BUSINESS: ${business.name}`);
      console.log(`📍 LOCATION: ${business.location || '❌ Not available'}`);
      console.log(`📞 PHONE: ${business.phone || '❌ Not available'}`);
      console.log(`🌐 WEBSITE: ${business.website || '❌ Not available'}`);
      console.log(`📧 EMAILS: ${business.emails.length > 0 ? business.emails.join(', ') : '❌ Not available'}`);
      console.log(`${'─'.repeat(70)}`);
    });

    // Statistics
    const withPhone = results.filter(b => b.phone).length;
    const withWebsite = results.filter(b => b.website).length;
    const withEmails = results.filter(b => b.emails.length > 0).length;
    const totalEmails = results.reduce((sum, b) => sum + b.emails.length, 0);

    console.log(`\n${'▓'.repeat(80)}`);
    console.log(`📈 STATISTICS & SUMMARY`);
    console.log(`${'▓'.repeat(80)}`);
    console.log(`📊 SUCCESS RATES:`);
    console.log(`   📞 Phone Numbers: ${withPhone}/${results.length} businesses (${Math.round(withPhone/results.length*100)}%)`);
    console.log(`   🌐 Websites: ${withWebsite}/${results.length} businesses (${Math.round(withWebsite/results.length*100)}%)`);
    console.log(`   📧 Email Addresses: ${withEmails}/${results.length} businesses (${Math.round(withEmails/results.length*100)}%)`);
    console.log(`   📧 Total Emails: ${totalEmails} email addresses found`);

    console.log(`\n🎯 QUALITY ASSESSMENT:`);
    if (withPhone >= results.length * 0.8) {
      console.log(`   📞 Phone coverage: ✅ EXCELLENT (${Math.round(withPhone/results.length*100)}%)`);
    } else if (withPhone >= results.length * 0.5) {
      console.log(`   📞 Phone coverage: ⚠️  GOOD (${Math.round(withPhone/results.length*100)}%)`);
    } else {
      console.log(`   📞 Phone coverage: ❌ NEEDS IMPROVEMENT (${Math.round(withPhone/results.length*100)}%)`);
    }

    if (withWebsite >= results.length * 0.5) {
      console.log(`   🌐 Website coverage: ✅ GOOD (${Math.round(withWebsite/results.length*100)}%)`);
    } else if (withWebsite >= results.length * 0.3) {
      console.log(`   🌐 Website coverage: ⚠️  FAIR (${Math.round(withWebsite/results.length*100)}%)`);
    } else {
      console.log(`   🌐 Website coverage: ❌ LOW (${Math.round(withWebsite/results.length*100)}%)`);
    }

    if (withEmails >= results.length * 0.3) {
      console.log(`   📧 Email coverage: ✅ GOOD (${Math.round(withEmails/results.length*100)}%)`);
    } else if (withEmails >= results.length * 0.1) {
      console.log(`   📧 Email coverage: ⚠️  FAIR (${Math.round(withEmails/results.length*100)}%)`);
    } else {
      console.log(`   📧 Email coverage: ❌ LOW (${Math.round(withEmails/results.length*100)}%)`);
    }
  }
}

// Parse query to extract business type and location
function parseQuery(query) {
  // Split the query into words
  const words = query.toLowerCase().split(/\s+/);

  // Common location indicators for Morocco
  const moroccanCities = [
    'casablanca', 'rabat', 'fes', 'fez', 'marrakech', 'marrakesh', 'agadir',
    'tangier', 'tanger', 'meknes', 'oujda', 'kenitra', 'tetouan', 'safi',
    'mohammedia', 'khouribga', 'beni mellal', 'el jadida', 'taza', 'nador',
    'settat', 'larache', 'ksar el kebir', 'sale', 'berrechid', 'khemisset',
    'inezgane', 'ouarzazate', 'tiznit', 'taroudant'
  ];

  // Find location in the query
  let location = 'fes'; // default
  let businessType = query;

  for (const city of moroccanCities) {
    if (words.includes(city)) {
      location = city;
      // Remove the city from business type
      businessType = query.replace(new RegExp(`\\b${city}\\b`, 'gi'), '').trim();
      break;
    }
  }

  // Clean up business type (remove extra spaces)
  businessType = businessType.replace(/\s+/g, ' ').trim();

  return { businessType, location };
}

// Main execution function
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
🚀 Flexible Business Scraper

Usage: node run.js "<query>" [max_results]

Examples:
  node run.js "dentiste fes"
  node run.js "restaurant casablanca"
  node run.js "avocat rabat" 15
  node run.js "Concepteur de sites web fes"
  node run.js "plombier marrakech" 10
  node run.js "pharmacie agadir"

Parameters:
  query        - Business type and location in one query (required)
  max_results  - Maximum number of businesses to find (default: 100)

Note: If no city is specified in the query, defaults to "fes"
    `);
    process.exit(1);
  }

  const query = args[0];
  const maxResults = parseInt(args[1]) || 100;

  // Parse the query to extract business type and location
  const { businessType, location } = parseQuery(query);

  console.log(`🔍 Parsed query: "${query}"`);
  console.log(`📋 Business type: "${businessType}"`);
  console.log(`📍 Location: "${location}"`);
  console.log(`🎯 Max results: ${maxResults}\n`);

  const scraper = new FlexibleBusinessScraper();

  try {
    const results = await scraper.scrapeBusinesses(businessType, location, maxResults);

    scraper.displayResults(results, businessType, location);
    const filename = scraper.saveResults(results, businessType, location);

    console.log(`\n🎉 SCRAPING COMPLETED SUCCESSFULLY!`);
    console.log(`💾 Results saved to: ${filename}`);
    console.log(`📊 Total businesses processed: ${results.length}`);
    console.log(`⏱️  Scraping session completed at: ${new Date().toLocaleString()}\n`);

  } catch (error) {
    console.log(`\n❌ SCRAPING FAILED`);
    console.log(`💥 Error: ${error.message}`);
    console.log(`⏱️  Failed at: ${new Date().toLocaleString()}\n`);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = FlexibleBusinessScraper;
