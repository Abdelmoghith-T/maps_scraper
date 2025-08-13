const utils = require('./utils');

// Test data
const testData = {
  phoneText: 'Contact us at +212 6 12 34 56 78 or 0661234567 for more info',
  emailText: 'Contact us at info@business.com or support@company.ma. No spam to no-reply@test.com',
  googleMapsData: '7,[["Business Name Test","Another Business"]]',
  websiteParts: [
    'url?q\\\\https://example.com\\\\",',
    'url?q\\\\http://www.test.com\\\\",',
    'url?q\\\\https://instagram.com/test\\\\",',
    'url?q\\\\https://facebook.com/page\\\\",',
  ]
};

function runTests() {
  console.log('Running utility function tests...\n');

  // Test phone number extraction
  console.log('1. Testing phone number extraction:');
  const phones = utils.extractPhoneNumbers(testData.phoneText);
  console.log('   Input:', testData.phoneText);
  console.log('   Extracted phones:', phones);
  console.log('   Expected: 2 phone numbers\n');

  // Test email extraction
  console.log('2. Testing email extraction:');
  const emails = utils.extractEmails(testData.emailText);
  console.log('   Input:', testData.emailText);
  console.log('   Extracted emails:', emails);
  console.log('   Expected: 2 emails (no-reply should be filtered)\n');

  // Test business name extraction
  console.log('3. Testing business name extraction:');
  const names = utils.extractBusinessNames(testData.googleMapsData);
  console.log('   Input:', testData.googleMapsData);
  console.log('   Extracted names:', names);
  console.log('   Expected: 2 business names\n');

  // Test website extraction
  console.log('4. Testing website extraction:');
  const websites = utils.extractWebsites(testData.websiteParts);
  console.log('   Input:', testData.websiteParts);
  console.log('   Extracted websites:', websites);
  console.log('   Expected: 2 websites (http converted to https)\n');

  // Test social media filtering
  console.log('5. Testing social media filtering:');
  const filtered = utils.filterSocialMediaParts(testData.websiteParts);
  console.log('   Input:', testData.websiteParts);
  console.log('   Filtered parts:', filtered);
  console.log('   Expected: 2 parts (social media filtered out)\n');

  // Test duplicate removal
  console.log('6. Testing duplicate removal:');
  const duplicates = ['a', 'b', 'a', 'c', 'b'];
  const unique = utils.removeDuplicates(duplicates);
  console.log('   Input:', duplicates);
  console.log('   Unique items:', unique);
  console.log('   Expected: [a, b, c]\n');

  // Test names and numbers combination
  console.log('7. Testing names and numbers combination:');
  const testNames = ['Business A', 'Business B'];
  const testNumbers = ['+212 6 12 34 56 78', '0661234567'];
  const testData = 'Business A contact +212 6 12 34 56 78 and Business B phone 0661234567';
  const combined = utils.combineNamesAndNumbers(testNames, testNumbers, testData);
  console.log('   Names:', testNames);
  console.log('   Numbers:', testNumbers);
  console.log('   Combined:', combined);
  console.log('   Expected: 2 objects with correctly matched numbers\n');

  console.log('All tests completed!');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = runTests;
