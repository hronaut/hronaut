export const PAGE_METADATA_LIMITS = {
  maxTextChars: 1_024,
  maxUrlChars: 2_048,
  maxCanonicalUrls: 5,
  maxAlternateLinks: 20,
  maxIcons: 10,
  maxSocialImages: 5,
  maxStructuredDataBlocks: 20,
  maxStructuredDataTypes: 50,
  maxStructuredDataNodes: 200
} as const

export function pageMetadataScript(): string {
  return `(() => {
    const limits = ${JSON.stringify(PAGE_METADATA_LIMITS)};
    const bounded = (value, max = limits.maxTextChars) => String(value || '').trim().slice(0, max);
    const contents = (selector, maxItems = 10) => Array.from(document.querySelectorAll(selector))
      .slice(0, maxItems)
      .map((element) => bounded(element.getAttribute('content')))
      .filter(Boolean);
    const links = (selector, maxItems) => Array.from(document.querySelectorAll(selector))
      .slice(0, maxItems)
      .map((element) => bounded(element.href || element.getAttribute('href'), limits.maxUrlChars))
      .filter(Boolean);
    const first = (selector) => contents(selector, 1)[0] || null;
    const metaName = (name) => first('meta[name="' + name + '" i]');
    const metaProperty = (property) => first('meta[property="' + property + '" i]');
    const issue = (severity, code, message) => ({ severity, code, message });
    const issues = [];

    const titleElements = document.querySelectorAll('title');
    const title = bounded(document.title, 512);
    const descriptions = contents('meta[name="description" i]', 5);
    const canonicalUrls = links('link[rel~="canonical" i]', limits.maxCanonicalUrls);
    const robots = metaName('robots');
    const language = bounded(document.documentElement.lang, 64) || null;
    const viewport = metaName('viewport');

    if (!title) issues.push(issue('error', 'missing-title', 'Add a concise, descriptive title element.'));
    if (titleElements.length > 1) issues.push(issue('warning', 'multiple-titles', 'The document contains more than one title element.'));
    if (!descriptions.length) issues.push(issue('warning', 'missing-description', 'No meta description is declared; search engines may generate a snippet from page content.'));
    if (descriptions.length > 1) issues.push(issue('warning', 'multiple-descriptions', 'The document contains more than one meta description.'));
    if (!canonicalUrls.length) issues.push(issue('info', 'missing-canonical', 'No explicit canonical link is declared.'));
    if (canonicalUrls.length > 1) issues.push(issue('warning', 'multiple-canonicals', 'The document contains more than one canonical link.'));
    if (!language) issues.push(issue('warning', 'missing-language', 'The root html element does not declare a language.'));
    if (!viewport) issues.push(issue('warning', 'missing-viewport', 'No viewport metadata is declared for responsive rendering.'));
    if (robots && /(?:^|[,\\s])noindex(?:$|[,\\s])/i.test(robots)) issues.push(issue('info', 'robots-noindex', 'The page asks compliant search engines not to index it.'));

    const headingCounts = {};
    for (let level = 1; level <= 6; level += 1) headingCounts['h' + level] = document.querySelectorAll('h' + level).length;
    if (!headingCounts.h1) issues.push(issue('warning', 'missing-h1', 'No level-one heading is present in the rendered document.'));
    if (headingCounts.h1 > 1) issues.push(issue('info', 'multiple-h1', 'Multiple level-one headings are present; make the primary page title visually unambiguous.'));

    const og = {
      title: metaProperty('og:title'),
      type: metaProperty('og:type'),
      url: metaProperty('og:url'),
      description: metaProperty('og:description'),
      siteName: metaProperty('og:site_name'),
      locale: metaProperty('og:locale'),
      images: []
    };
    const ogImageUrls = contents('meta[property="og:image" i], meta[property="og:image:url" i]', limits.maxSocialImages);
    const ogImageAlts = contents('meta[property="og:image:alt" i]', limits.maxSocialImages);
    const ogImageWidths = contents('meta[property="og:image:width" i]', limits.maxSocialImages);
    const ogImageHeights = contents('meta[property="og:image:height" i]', limits.maxSocialImages);
    for (let index = 0; index < ogImageUrls.length; index += 1) {
      og.images.push({
        url: bounded(ogImageUrls[index], limits.maxUrlChars),
        alt: ogImageAlts[index] || null,
        width: ogImageWidths[index] || null,
        height: ogImageHeights[index] || null
      });
    }
    const openGraphProperties = Array.from(document.querySelectorAll('meta[property^="og:" i]')).length;
    if (openGraphProperties) {
      for (const [field, present] of [['og:title', og.title], ['og:type', og.type], ['og:image', og.images.length], ['og:url', og.url]]) {
        if (!present) issues.push(issue('warning', 'incomplete-open-graph', 'Open Graph metadata is missing ' + field + '.'));
      }
      if (og.images.some((image) => !image.alt)) issues.push(issue('warning', 'missing-og-image-alt', 'At least one Open Graph image has no og:image:alt description.'));
    }

    const twitter = {
      card: metaName('twitter:card'),
      title: metaName('twitter:title'),
      description: metaName('twitter:description'),
      site: metaName('twitter:site'),
      creator: metaName('twitter:creator'),
      images: []
    };
    const twitterImageUrls = contents('meta[name="twitter:image" i], meta[name="twitter:image:src" i]', limits.maxSocialImages);
    const twitterImageAlts = contents('meta[name="twitter:image:alt" i]', limits.maxSocialImages);
    for (let index = 0; index < twitterImageUrls.length; index += 1) {
      twitter.images.push({ url: bounded(twitterImageUrls[index], limits.maxUrlChars), alt: twitterImageAlts[index] || null });
    }
    const twitterProperties = Array.from(document.querySelectorAll('meta[name^="twitter:" i]')).length;
    if (twitterProperties && !twitter.card) issues.push(issue('warning', 'missing-twitter-card', 'Twitter card metadata is present without twitter:card.'));

    const alternateLinks = Array.from(document.querySelectorAll('link[rel~="alternate" i][hreflang]'))
      .slice(0, limits.maxAlternateLinks)
      .map((element) => ({
        language: bounded(element.getAttribute('hreflang'), 64),
        url: bounded(element.href || element.getAttribute('href'), limits.maxUrlChars)
      }))
      .filter((entry) => entry.language && entry.url);
    const icons = Array.from(document.querySelectorAll('link[rel~="icon" i]'))
      .slice(0, limits.maxIcons)
      .map((element) => ({
        rel: bounded(element.getAttribute('rel'), 64),
        type: bounded(element.getAttribute('type'), 128) || null,
        sizes: bounded(element.getAttribute('sizes'), 128) || null,
        url: bounded(element.href || element.getAttribute('href'), limits.maxUrlChars)
      }))
      .filter((entry) => entry.url);

    const structuredDataBlocks = [];
    const structuredDataTypes = new Set();
    let structuredNodesVisited = 0;
    const collectTypes = (value) => {
      if (structuredNodesVisited >= limits.maxStructuredDataNodes || value == null) return;
      structuredNodesVisited += 1;
      if (Array.isArray(value)) {
        for (const item of value) collectTypes(item);
        return;
      }
      if (typeof value !== 'object') return;
      const declared = value['@type'];
      for (const type of Array.isArray(declared) ? declared : declared == null ? [] : [declared]) {
        if (structuredDataTypes.size >= limits.maxStructuredDataTypes) break;
        const normalized = bounded(type, 128);
        if (normalized) structuredDataTypes.add(normalized);
      }
      for (const child of Object.values(value)) collectTypes(child);
    };
    const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json" i]'));
    for (const [index, script] of jsonLdScripts.slice(0, limits.maxStructuredDataBlocks).entries()) {
      try {
        const parsed = JSON.parse(script.text || '');
        const before = new Set(structuredDataTypes);
        collectTypes(parsed);
        structuredDataBlocks.push({
          index,
          valid: true,
          types: Array.from(structuredDataTypes).filter((type) => !before.has(type)).slice(0, limits.maxStructuredDataTypes)
        });
      } catch (error) {
        structuredDataBlocks.push({
          index,
          valid: false,
          types: [],
          error: 'Invalid JSON-LD syntax'
        });
      }
    }
    const invalidStructuredDataCount = structuredDataBlocks.filter((block) => !block.valid).length;
    if (invalidStructuredDataCount) issues.push(issue('error', 'invalid-json-ld', invalidStructuredDataCount + ' JSON-LD block(s) could not be parsed.'));

    return {
      url: bounded(location.href, limits.maxUrlChars),
      title,
      capturedAt: new Date().toISOString(),
      document: {
        language,
        charset: bounded(document.characterSet, 64) || null,
        viewport,
        description: descriptions[0] || null,
        robots,
        themeColor: metaName('theme-color'),
        manifestUrl: links('link[rel~="manifest" i]', 1)[0] || null,
        titleElementCount: titleElements.length,
        descriptionCount: descriptions.length,
        canonicalUrls,
        headingCounts
      },
      openGraph: { ...og, propertyCount: openGraphProperties },
      twitter: { ...twitter, propertyCount: twitterProperties },
      alternateLinks,
      icons,
      structuredData: {
        blockCount: jsonLdScripts.length,
        validBlockCount: structuredDataBlocks.filter((block) => block.valid).length,
        invalidBlockCount: invalidStructuredDataCount,
        types: Array.from(structuredDataTypes),
        blocks: structuredDataBlocks,
        truncated: jsonLdScripts.length > limits.maxStructuredDataBlocks || structuredNodesVisited >= limits.maxStructuredDataNodes
      },
      issues,
      caveats: [
        'This report describes metadata in the currently rendered DOM; crawlers may receive or process a different response.',
        'Metadata can influence search and social presentation but does not guarantee indexing, ranking, snippets, or rich results.',
        'Only an allowlist of page metadata is returned. Arbitrary meta tags, body text, form values, and complete JSON-LD objects are excluded.'
      ]
    };
  })()`
}
