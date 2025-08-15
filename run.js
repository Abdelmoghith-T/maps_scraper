const MapsScraper = require('./index.js');
const fs = require('fs');
const axios = require('axios');
const http = require('http');
const https = require('https');
const config = require('./config.js'); // Import config

// Optimize HTTP performance with keep-alive and sensible defaults
axios.defaults.httpAgent = new http.Agent({ keepAlive: true });
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true });
axios.defaults.timeout = config.requestSettings.timeout; // Use config timeout
axios.defaults.headers = axios.defaults.headers || {};
axios.defaults.headers['User-Agent'] = config.requestSettings.userAgent; // Use config User-Agent

// Helper: Select best address candidate using Gemini generateContent API (BATCHED)
async function batchSelectAddressesWithGemini(businessDataArray) {
  try {
    if (!Array.isArray(businessDataArray) || businessDataArray.length === 0) return [];

    const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyA22X1Stw3W4oQ5yBgFOOPGtRLPSJmw4Ig';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    let instruction = `You are an expert address extraction AI. Your task is to process a list of business data, each containing a business name, its location context (city), and a list of address candidates extracted from Google Maps HTML.

GOAL: For EACH business entry, return the single candidate string that is MOST LIKELY to be the FULL POSTAL ADDRESS.

STRICT RULES FOR EACH ADDRESS SELECTION:
- Hard Exclusions (NEVER CHOOSE if a candidate contains any of these):
  - Review/comment markers or first-person opinion text: "avis", "écrire un avis", "note", "commentaire", "réponse", "répondu", "J'ai", "Je recommande", "Très bon", "tbarkAllah", "merci", "expérience", "visité", "satisfait", "professionnel", emojis (⭐ 👍 ❤️)
  - UI/controls: "Modifier le nom", "modifier l'adresse", "les horaires", "Suggérer une modification", "Signaler un problème", "Ajouter une photo", "Photos", "Voir les photos", "Directions", "Itinéraire", "Appeler", "Site Web", "Enregistrer", "Partager", "Questions-réponses", "Menu", "Ouvrir dans Google Maps"
  - Status/metadata: "Ouvert", "Fermé", "Ferme à", "Horaires", "Heures", "Mis à jour", "il y a", "hier", "aujourd'hui", "mins", "heures", "jours"
  - Arabic UI/reviews: "مفتوح", "مغلق", "اتجاهات", "موقع الويب", "اتصال", "مشاركة", "التعليقات", "المراجعات", "أضف صورة", "اقتراح تعديل", "زرت", "أنصح", "تجربة", "شكرا"
  - Pure phone numbers, prices, categories only, single-word labels.

- Positive Signals (a candidate is ADDRESS-LIKE if it satisfies BOTH):
  A) Contains at least one address token, for example:
     Rue, Avenue, Av., Blvd, Boulevard, Place, Lot, Lotissement, Résidence, Rés., Immeuble, Bloc, Appartement, App., Bureau, Zone, Route, Road, St, Rd, Quartier, Qrt, حي, شارع, إقامة, زنقة, رقم, n°/N°/No./n°, km
  B) And at least one of:
     - a street number (e.g., "12", "N° 5", "km 3"),
     - the city/locality (match the provided context),
     - a plausible 5-digit postal code (e.g., "30000", "10000"),
     - country/region names (e.g., "Maroc", "Morocco").

- Tie-Breaking / Partials:
  - If one candidate has the street line and another has only city/postal, choose the STREET LINE (do NOT combine strings).
  - Prefer candidates with multiple components separated by commas/newlines: street, locality/city, postal code, country.
  - Prefer candidates that include a substring of the business name only if the string is still address-like per the rules above.
  - Reject very short fragments (<12 chars) unless clearly a street+number.

OUTPUT FORMAT:
Return a JSON array where each element is the selected address string for the corresponding business, or an empty string if no plausible address is found.
Example: ["123 Main St, City", "", "Another Address, 10000"]

BUSINESS DATA TO PROCESS:
`;

    const businessesInput = businessDataArray.map((data, index) => {
      const numberedCandidates = data.candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
      return `--- Business ${index + 1} ---
Business Name: "${data.businessName}"
City: "${data.location}"
Candidates:
${numberedCandidates}`;
    }).join('\n\n');

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: instruction + businessesInput }
          ]
        }
      ]
    };

    // Add a delay before the API call to prevent rate limiting (429 errors)
    await require('./utils').wait(1);

    const resp = await axios.post(endpoint, body, {
      timeout: 30000, // Increased timeout for potentially larger requests
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const textResponse = ((resp && resp.data && resp.data.candidates && resp.data.candidates[0] && resp.data.candidates[0].content && resp.data.candidates[0].content.parts) || [])
      .map(p => (p && p.text) ? String(p.text) : '')
      .filter(Boolean)
      .join(' ');
    
    // Remove markdown code block fences if Gemini wrapped the JSON
    const cleanedResponse = textResponse.replace(/^```json\n/g, '').replace(/\n```$/g, '').trim();

    try {
      // Attempt to parse the JSON array
      const parsed = JSON.parse(cleanedResponse);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (parseError) {
      console.error('Failed to parse Gemini batch address response as JSON:', parseError.message);
      // Fallback: If parsing fails, try to extract lines as individual addresses
      return textResponse.split('\n').map(line => line.trim()).filter(Boolean);
    }

    return []; // Return empty array if no valid response
  } catch (e) {
    console.error('Error in batchSelectAddressesWithGemini:', e.message);
    return [];
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
      let address = ''; // Re-introduced address variable
      if (rawAddressCandidates.length > 0) {
        console.log(`\n📍 ADDRESS CANDIDATES: ${rawAddressCandidates.length}`);
        // const bestByAI = await selectAddressWithGemini(rawAddressCandidates, bestBusinessName, location); // Commented out for batch processing
        // address = bestByAI || ''; // Commented out for batch processing
        // console.log(`📍 ADDRESS (selected): ${address || 'None'}`); // Commented out for batch processing
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
      console.log(`   📞 PHONE: ${phoneNumber || 'Not found'}`);
      console.log(`   🌐 WEBSITE: ${website || 'Not found'}`);
      console.log(`   📧 EMAILS: ${emails.length > 0 ? emails.join(', ') : 'Not found'}`);
      console.log(`${'='.repeat(80)}\n`);

      return {
        name: bestBusinessName,
        phone: phoneNumber,
        website: website,
        emails: emails,
        location: address || location,
        rawAddressCandidates: rawAddressCandidates // Added raw address candidates
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

      // Step 2: INDIVIDUAL BUSINESS RESEARCH (CONCURRENT)
      console.log(`\n${'▓'.repeat(60)}`);
      console.log(`🔍 STEP 2: INDIVIDUAL BUSINESS RESEARCH (CONCURRENT)`);
      console.log(`${'▓'.repeat(60)}`);

      // Simple concurrency pool runner
      async function runWithConcurrency(items, limit, worker) {
        const results = new Array(items.length);
        let nextIndex = 0;

        async function runNext() {
          const current = nextIndex++;
          if (current >= items.length) return;
          try {
            results[current] = await worker(items[current], current);
          } catch (err) {
            results[current] = null;
          }
          return runNext();
        }

        const runners = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
        await Promise.all(runners);
        return results.filter(r => r);
      }

      const concurrency = Math.min(5, Math.max(2, Math.floor(require('os').cpus().length / 2)));
      console.log(`Using concurrency: ${concurrency}`);

      let completed = 0;
      const allRawAddressCandidates = []; // To collect all rawAddressCandidates
      const allBusinessNames = []; // To collect all business names for Gemini prompt
      const allLocations = []; // To collect all locations for Gemini prompt
      const originalIndexes = []; // To map back results

      const results = await runWithConcurrency(businessesToSearch, concurrency, async (businessName, idx) => {
        const prefix = `[${idx + 1}/${businessesToSearch.length}]`;
        console.log(`\n${'░'.repeat(40)}`);
        console.log(`${prefix} START: ${businessName.substring(0, 60)}${businessName.length > 60 ? '...' : ''}`);
        console.log(`${'░'.repeat(40)}`);
        const data = await this.searchIndividualBusiness(businessName, location);
        if (data && data.rawAddressCandidates) {
          allRawAddressCandidates.push(data.rawAddressCandidates);
          allBusinessNames.push(data.name); // Using data.name (best matched name)
          allLocations.push(location); // Using the original location
          originalIndexes.push(idx);
          delete data.rawAddressCandidates; // Remove to avoid saving raw data
        }
        completed++;
        if (data) {
          console.log(`${prefix} ✅ DONE (${Math.round(completed / businessesToSearch.length * 100)}%)`);
        } else {
          console.log(`${prefix} ❌ FAILED (${Math.round(completed / businessesToSearch.length * 100)}%)`);
        }
        return data;
      });

      console.log(`\n${'▓'.repeat(60)}`);
      console.log(`✅ ALL INDIVIDUAL SEARCHES COMPLETED`);
      console.log(`${'▓'.repeat(60)}`);
      console.log(`📊 TOTAL RESULTS: ${results.length}/${businessesToSearch.length} businesses`);

      // STEP 3: BATCH ADDRESS SELECTION WITH GEMINI
      console.log(`\n${'▓'.repeat(60)}`);
      console.log(`🤖 STEP 3: BATCH ADDRESS SELECTION WITH GEMINI`);
      console.log(`${'▓'.repeat(60)}`);

      const businessDataForGemini = originalIndexes.map(idx => ({
        businessName: results[idx].name,
        location: allLocations[originalIndexes.indexOf(idx)], // Get location using original index
        candidates: allRawAddressCandidates[originalIndexes.indexOf(idx)] // Get candidates using original index
      }));

      console.log(`Sending ${businessDataForGemini.length} business address candidate sets to Gemini...`);
      const selectedAddresses = await batchSelectAddressesWithGemini(businessDataForGemini);
      console.log(`Received ${selectedAddresses.length} addresses from Gemini.`);

      // Distribute the selected addresses back to the results
      for (let i = 0; i < selectedAddresses.length; i++) {
        const originalIdx = originalIndexes[i];
        if (results[originalIdx]) {
          results[originalIdx].location = selectedAddresses[i] || results[originalIdx].location; // Update location or keep existing
        }
      }

      return results.filter(r => r);

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
    console.log(`🚀 Flexible Business Scraper\n\nUsage: node run.js "<query>" [max_results]\n\nExamples:\n  node run.js "dentiste fes"\n  node run.js "restaurant casablanca"\n  node run.js "avocat rabat" 15\n  node run.js "Concepteur de sites web fes"\n  node run.js "plombier marrakech" 10\n  node run.js "pharmacie agadir"\n\nParameters:\n  query        - Business type and location in one query (required)\n  max_results  - Maximum number of businesses to find (default: 100)\n\nNote: If no city is specified in the query, defaults to "fes"\n    `);
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