// Tamil ↔ Latin Transliteration Module
// Uses ISO 15919 standard transliteration scheme

// Tamil to Latin mapping
const tamilToLatin = {
  // Vowels
  'அ': 'a', 'ஆ': 'ā', 'இ': 'i', 'ஈ': 'ī', 'உ': 'u', 'ஊ': 'ū',
  'எ': 'e', 'ஏ': 'ē', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'ō', 'ஔ': 'au',

  // Vowel signs (combining marks)
  'ா': 'ā', 'ி': 'i', 'ீ': 'ī', 'ு': 'u', 'ூ': 'ū',
  'ெ': 'e', 'ே': 'ē', 'ை': 'ai', 'ொ': 'o', 'ோ': 'ō', 'ௌ': 'au',

  // Virama (pulli) - removes inherent vowel
  '்': '',

  // Consonants (with inherent 'a')
  'க': 'ka', 'ங': 'ṅa', 'ச': 'ca', 'ஞ': 'ña', 'ட': 'ṭa', 'ண': 'ṇa',
  'த': 'ta', 'ந': 'na', 'ப': 'pa', 'ம': 'ma', 'ய': 'ya', 'ர': 'ra',
  'ல': 'la', 'வ': 'va', 'ழ': 'ḻa', 'ள': 'ḷa', 'ற': 'ṟa', 'ன': 'ṉa',

  // Grantha consonants
  'ஜ': 'ja', 'ஷ': 'ṣa', 'ஸ': 'sa', 'ஹ': 'ha', 'க்ஷ': 'kṣa',

  // Tamil numerals
  '௦': '0', '௧': '1', '௨': '2', '௩': '3', '௪': '4',
  '௫': '5', '௬': '6', '௭': '7', '௮': '8', '௯': '9',
  '௰': '10', '௱': '100', '௲': '1000',

  // Aytham
  'ஃ': 'ḵ'
};

// Simplified Latin to Tamil mapping (for common romanizations)
const latinToTamil = {
  // Long vowels with macron
  'ā': 'ஆ', 'ī': 'ஈ', 'ū': 'ஊ', 'ē': 'ஏ', 'ō': 'ஓ',

  // Short vowels
  'a': 'அ', 'i': 'இ', 'u': 'உ', 'e': 'எ', 'o': 'ஒ',

  // Diphthongs
  'ai': 'ஐ', 'au': 'ஔ',

  // Consonants with diacritics
  'ṅ': 'ங்', 'ñ': 'ஞ்', 'ṭ': 'ட்', 'ṇ': 'ண்', 'ḻ': 'ழ்',
  'ḷ': 'ள்', 'ṟ': 'ற்', 'ṉ': 'ன்', 'ṣ': 'ஷ்', 'ḵ': 'ஃ',

  // Basic consonants
  'k': 'க்', 'g': 'க்', 'c': 'ச்', 'ch': 'ச்', 's': 'ஸ்',
  'j': 'ஜ்', 't': 'த்', 'd': 'த்', 'n': 'ந்', 'p': 'ப்',
  'b': 'ப்', 'm': 'ம்', 'y': 'ய்', 'r': 'ர்', 'l': 'ல்',
  'v': 'வ்', 'w': 'வ்', 'h': 'ஹ்', 'z': 'ஜ்', 'f': 'ப்',

  // Numbers
  '0': '௦', '1': '௧', '2': '௨', '3': '௩', '4': '௪',
  '5': '௫', '6': '௬', '7': '௭', '8': '௮', '9': '௯'
};

// Vowel signs for combining with consonants
const vowelSigns = {
  'a': '', // inherent vowel, no sign needed
  'ā': 'ா', 'i': 'ி', 'ī': 'ீ', 'u': 'ு', 'ū': 'ூ',
  'e': 'ெ', 'ē': 'ே', 'ai': 'ை', 'o': 'ொ', 'ō': 'ோ', 'au': 'ௌ'
};

// Check if text contains Tamil characters
export function containsTamil(text) {
  return /[\u0B80-\u0BFF]/.test(text);
}

// Check if text contains Latin characters (basic check)
export function containsLatin(text) {
  return /[a-zA-Z]/.test(text);
}

// Detect the primary script of the text
export function detectScript(text) {
  const tamilCount = (text.match(/[\u0B80-\u0BFF]/g) || []).length;
  const latinCount = (text.match(/[a-zA-Z]/g) || []).length;

  if (tamilCount > latinCount) return 'tamil';
  if (latinCount > tamilCount) return 'latin';
  return 'unknown';
}

// Convert Tamil text to Latin transliteration
export function tamilToLatinText(text) {
  let result = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1] || '';

    // Check for two-character sequences first
    const twoChar = char + nextChar;
    if (tamilToLatin[twoChar]) {
      result += tamilToLatin[twoChar];
      i += 2;
      continue;
    }

    // Check if current char is a consonant
    if (tamilToLatin[char] && tamilToLatin[char].length === 2 && tamilToLatin[char].endsWith('a')) {
      const consonantBase = tamilToLatin[char].slice(0, -1); // Remove inherent 'a'

      // Check for virama (pulli) - removes inherent vowel
      if (nextChar === '்') {
        result += consonantBase;
        i += 2;
        continue;
      }

      // Check for vowel sign
      if (nextChar && tamilToLatin[nextChar] !== undefined && nextChar !== '்') {
        const vowelSign = tamilToLatin[nextChar];
        if (vowelSign !== undefined && vowelSign !== '') {
          result += consonantBase + vowelSign;
          i += 2;
          continue;
        }
      }

      // Default: consonant with inherent 'a'
      result += tamilToLatin[char];
      i++;
      continue;
    }

    // Single character mapping
    if (tamilToLatin[char] !== undefined) {
      result += tamilToLatin[char];
    } else {
      // Keep non-Tamil characters as-is
      result += char;
    }
    i++;
  }

  return result;
}

// Convert Latin text to Tamil script
export function latinToTamilText(text) {
  let result = '';
  let i = 0;
  const lowerText = text.toLowerCase();

  while (i < lowerText.length) {
    let matched = false;

    // Try matching longer sequences first (up to 3 chars)
    for (let len = 3; len >= 1; len--) {
      const substr = lowerText.substr(i, len);

      // Check for consonant + vowel combinations
      if (len >= 2) {
        const consonant = substr[0];
        const vowel = substr.slice(1);

        if (latinToTamil[consonant] && vowelSigns[vowel] !== undefined) {
          // Get consonant without virama
          let tamilConsonant = latinToTamil[consonant];
          if (tamilConsonant.endsWith('்')) {
            tamilConsonant = tamilConsonant.slice(0, -1);
          }
          result += tamilConsonant + vowelSigns[vowel];
          i += len;
          matched = true;
          break;
        }
      }

      // Direct mapping
      if (latinToTamil[substr]) {
        result += latinToTamil[substr];
        i += len;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Keep unrecognized characters as-is
      result += text[i];
      i++;
    }
  }

  return result;
}

// Main transliteration function - auto-detects direction
export function transliterate(text) {
  const script = detectScript(text);

  if (script === 'tamil') {
    return {
      result: tamilToLatinText(text),
      direction: 'tamil-to-latin'
    };
  } else if (script === 'latin') {
    return {
      result: latinToTamilText(text),
      direction: 'latin-to-tamil'
    };
  }

  // Return original if can't detect
  return {
    result: text,
    direction: 'none'
  };
}

// Simplified transliteration (removes diacritics for easier reading)
export function transliterateSimplified(text) {
  const { result, direction } = transliterate(text);

  if (direction === 'tamil-to-latin') {
    // Remove diacritics for simplified output
    return {
      result: result
        .replace(/ā/g, 'aa')
        .replace(/ī/g, 'ee')
        .replace(/ū/g, 'oo')
        .replace(/ē/g, 'ae')
        .replace(/ō/g, 'oa')
        .replace(/ṅ/g, 'ng')
        .replace(/ñ/g, 'nj')
        .replace(/ṭ/g, 't')
        .replace(/ṇ/g, 'n')
        .replace(/ḻ/g, 'zh')
        .replace(/ḷ/g, 'l')
        .replace(/ṟ/g, 'tr')
        .replace(/ṉ/g, 'n')
        .replace(/ṣ/g, 'sh')
        .replace(/ḵ/g, 'k'),
      direction
    };
  }

  return { result, direction };
}
