/**
 * Text processing, normalization, and explainable TF-IDF / Cosine similarity engine.
 * Pure JavaScript, deterministic, zero external C-dependencies.
 */

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any',
  'are', 'aren', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between',
  'both', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'down',
  'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he',
  'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in',
  'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our',
  'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was',
  'wasn', 'we', 'were', 'weren', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

/**
 * Normalizes common English / technical suffixes for reliable token matching
 */
function stemToken(token) {
  let t = token.toLowerCase();
  if (t.endsWith('ing') && t.length > 5) t = t.slice(0, -3);
  else if (t.endsWith('ies') && t.length > 4) t = t.slice(0, -3) + 'y';
  else if (t.endsWith('es') && t.length > 4) t = t.slice(0, -2);
  else if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) t = t.slice(0, -1);
  else if (t.endsWith('ed') && t.length > 4) t = t.slice(0, -2);
  return t;
}

/**
 * Tokenizes and normalizes raw text string into cleaned keyword tokens
 */
export function tokenize(text) {
  if (!text || typeof text !== 'string') return [];

  // Lowercase and replace non-alphanumeric chars (preserving alphanumeric tokens and hyphenated terms)
  const cleaned = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/[\-_]/g, ' ');

  const rawTokens = cleaned.split(/\s+/).filter(Boolean);

  const tokens = [];
  for (const t of rawTokens) {
    if (t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t)) {
      tokens.push(stemToken(t));
    }
  }

  return tokens;
}

/**
 * Builds vocabulary and computes document frequencies (DF) across a corpus of documents
 */
export function buildCorpusStats(documents) {
  const docFrequencies = new Map();
  const N = documents.length;

  for (const doc of documents) {
    const tokens = new Set(tokenize(doc));
    for (const token of tokens) {
      docFrequencies.set(token, (docFrequencies.get(token) || 0) + 1);
    }
  }

  return {
    N,
    docFrequencies,
  };
}

/**
 * Computes TF-IDF vector for a single document given precomputed corpus statistics
 */
export function computeTfIdfVector(doc, corpusStats) {
  const tokens = tokenize(doc);
  const termCounts = new Map();

  for (const t of tokens) {
    termCounts.set(t, (termCounts.get(t) || 0) + 1);
  }

  const vector = new Map();
  const totalTokens = tokens.length || 1;
  const { N, docFrequencies } = corpusStats;

  for (const [term, count] of termCounts.entries()) {
    const tf = count / totalTokens;
    const df = docFrequencies.get(term) || 0;
    // Standard smoothed inverse document frequency
    const idf = Math.log((1 + N) / (1 + df)) + 1.0;
    vector.set(term, tf * idf);
  }

  return vector;
}

/**
 * Calculates cosine similarity between two TF-IDF vectors
 * Returns score between 0.0 and 1.0, plus matching keyword evidence tokens
 */
export function calculateCosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  const matchedTokens = [];

  for (const [term, weightA] of vecA.entries()) {
    normA += weightA * weightA;
    if (vecB.has(term)) {
      const weightB = vecB.get(term);
      const contribution = weightA * weightB;
      dotProduct += contribution;
      matchedTokens.push({ term, contribution });
    }
  }

  for (const weightB of vecB.values()) {
    normB += weightB * weightB;
  }

  if (normA === 0 || normB === 0) {
    return {
      similarity: 0.0,
      matchedEvidence: [],
    };
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  const similarity = Math.min(1.0, Math.max(0.0, dotProduct / denominator));

  // Sort matching tokens by contribution descending
  matchedTokens.sort((a, b) => b.contribution - a.contribution);
  const matchedEvidence = matchedTokens.map((m) => m.term);

  return {
    similarity: Math.round(similarity * 1000) / 1000,
    matchedEvidence,
  };
}
